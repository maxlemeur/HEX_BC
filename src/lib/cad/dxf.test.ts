import { describe, expect, it } from "vitest";

import { aciColor, CadReadError, readDxf } from "@/lib/cad/dxf";
import { arc, circle, dxfBytes, dxfText, insert, layer, line, lwpolyline, rec, text, type DxfFixture } from "@/lib/cad/dxf.test-utils";
import { listCadPaths } from "@/lib/cad/model";

// Fictional drawings only. Each test names the rule of the DXF format the
// reader must respect: a wrong reading here is a wrong quantity in a devis.

function read(fixture: DxfFixture, limits?: Parameters<typeof readDxf>[1]) {
  return readDxf(dxfBytes(fixture), limits);
}

function reasonOf(bytes: Uint8Array, options?: Parameters<typeof readDxf>[1]) {
  try {
    readDxf(bytes, options);
  } catch (error) {
    if (error instanceof CadReadError) return error.reason;
    throw error;
  }
  return null;
}

const ascii = (value: string) => new Uint8Array(Buffer.from(value, "latin1"));

describe("readDxf: what is not a readable DXF", () => {
  it("refuses empty bytes, a binary DXF, another format and an oversized file", () => {
    expect(reasonOf(new Uint8Array())).toBe("empty");
    expect(reasonOf(ascii("AutoCAD Binary DXF\r\n\x1a\0" + "\0".repeat(40)))).toBe("binary_dxf");
    expect(reasonOf(ascii("AC1027\0\0\0\0\0" + "\x01\x02\x03".repeat(30)))).toBe("not_dxf");
    expect(reasonOf(ascii("%PDF-1.7\n1 0 obj\n"))).toBe("not_dxf");
    expect(reasonOf(dxfBytes({ entities: [line("0", 0, 0, 1, 0)] }), { limits: { maxBytes: 64 } })).toBe("too_large");
  });

  it("reads past leading comments", () => {
    const body = dxfText({ entities: [line("0", 0, 0, 3, 4)] });
    const drawing = readDxf(ascii(`999\r\nécrit par un test\r\n${body}`));
    expect(drawing.paths.count).toBe(1);
  });
});

describe("readDxf: records", () => {
  it("reads LF and CRLF files alike, and codes padded with spaces", () => {
    const fixture: DxfFixture = { layers: [layer("EF", 5)], entities: [line("EF", 0, 0, 3, 4)] };
    const crlf = read(fixture);
    const lf = read({ ...fixture, eol: "\n" });
    const padded = readDxf(ascii(dxfText(fixture).replace(/^(\d+)\r$/gm, "  $1\r")));
    for (const drawing of [crlf, lf, padded]) {
      expect(listCadPaths(drawing)).toEqual([expect.objectContaining({ layer: "EF", kind: "line", length: 5, color: 0x0000ff })]);
      expect(drawing.truncated).toBe(false);
    }
  });

  it("flags a file cut before its end and keeps the whole entities read so far", () => {
    const whole = dxfText({ entities: [line("0", 0, 0, 1, 0), line("0", 0, 0, 2, 0)] });
    const cut = whole.slice(0, whole.lastIndexOf("LINE") + 30);
    const drawing = readDxf(ascii(cut));
    expect(drawing.truncated).toBe(true);
    expect(drawing.warnings).toContainEqual({ code: "truncated_file" });
    expect(listCadPaths(drawing).map((path) => path.length)).toEqual([1]);
    expect(read({ entities: [line("0", 0, 0, 1, 0)], eof: false }).truncated).toBe(true);
  });
});

describe("readDxf: header", () => {
  it("names the release and reads the insertion unit", () => {
    const drawing = read({ header: [[9, "$ACADVER"], [1, "AC1027"], [9, "$INSUNITS"], [70, 4]] });
    expect(drawing.version).toEqual({ code: "AC1027", label: "AutoCAD 2013" });
    expect(drawing.units).toEqual({ code: 4, metresPerUnit: 0.001, name: "millimètre" });
    expect(read({ header: [[9, "$ACADVER"], [1, "AC1032"], [9, "$INSUNITS"], [70, 6]] }).units.metresPerUnit).toBe(1);
    expect(read({ header: [[9, "$INSUNITS"], [70, 5]] }).units.metresPerUnit).toBe(0.01);
    expect(read({ header: [[9, "$INSUNITS"], [70, 1]] }).units.metresPerUnit).toBe(0.0254);
  });

  it("does not guess a unit the file does not give", () => {
    expect(read({ header: [[9, "$ACADVER"], [1, "AC1009"]] }).units).toEqual({ code: 0, metresPerUnit: null, name: "sans unité" });
    expect(read({ header: [[9, "$INSUNITS"], [70, 0]] }).units.metresPerUnit).toBeNull();
    expect(read({ header: [[9, "$ACADVER"], [1, "AC1009"]] }).version.label).toBe("AutoCAD R11/R12");
  });
});

describe("readDxf: text encoding", () => {
  it("reads a code-page file, a UTF-8 file and \\U+ escapes", () => {
    const fixture: DxfFixture = {
      header: [[9, "$ACADVER"], [1, "AC1015"], [9, "$DWGCODEPAGE"], [3, "ANSI_1252"]],
      layers: [layer("Évacuation", 3)],
      entities: [text("Évacuation", 0, 0, 2.5, "Ø100 côté rue"), text("0", 0, 5, 2.5, "r\\U+00E9seau")],
    };
    for (const encoding of ["latin1", "utf8"] as const) {
      const drawing = readDxf(dxfBytes(fixture, encoding));
      expect(drawing.layers.map((entry) => entry.name)).toContain("Évacuation");
      expect(drawing.texts.map((entry) => entry.text)).toEqual(["Ø100 côté rue", "réseau"]);
    }
  });
});

describe("readDxf: layers", () => {
  it("reads colour, off, frozen and no-plot, and creates a layer an entity names without a declaration", () => {
    const drawing = read({
      layers: [
        layer("EF", 5),
        layer("ECS", -1),
        rec("LAYER", [2, "FOND"], [70, 1], [62, 8]),
        layer("VRAIE", 7, [420, 0x123456]),
        layer("NOTES", 2, [290, 0]),
      ],
      entities: [line("ef", 0, 0, 1, 0), line("ORPHELIN", 0, 0, 1, 0)],
    });
    const byName = Object.fromEntries(drawing.layers.map((entry) => [entry.name, entry]));
    expect(byName.EF).toEqual({ name: "EF", color: 0x0000ff, on: true, frozen: false, plot: true, visible: true });
    expect(byName.ECS).toMatchObject({ color: 0xff0000, on: false, visible: false });
    expect(byName.FOND).toMatchObject({ frozen: true, visible: false, color: 0x414141 });
    expect(byName.VRAIE.color).toBe(0x123456);
    expect(byName.NOTES.plot).toBe(false);
    expect(byName.ORPHELIN).toMatchObject({ color: 0xffffff, on: true, visible: true });
    // Layer names are not case sensitive.
    expect(listCadPaths(drawing).map((path) => path.layer)).toEqual(["EF", "ORPHELIN"]);
    expect(drawing.layers.map((entry) => entry.name)).toContain("0");
  });

  it("knows the AutoCAD colour index", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(aciColor)).toEqual([0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x414141, 0x808080]);
    expect([10, 11, 12, 13, 30, 250, 255].map(aciColor)).toEqual([0xff0000, 0xffaaaa, 0xbd0000, 0xbd7e7e, 0xff7f00, 0x333333, 0xffffff]);
  });
});

describe("readDxf: lines, polylines, arcs", () => {
  it("resolves the colour of an entity and skips paper space and invisible entities", () => {
    const drawing = read({
      layers: [layer("EF", 5)],
      entities: [
        line("EF", 0, 0, 3, 4),
        line("EF", 0, 0, 1, 0, [62, 3]),
        line("EF", 0, 0, 1, 0, [62, 3], [420, 0xabcdef]),
        line("EF", 0, 0, 9, 0, [67, 1]),
        line("EF", 0, 0, 9, 0, [60, 1]),
      ],
    });
    expect(listCadPaths(drawing).map((path) => path.color)).toEqual([0x0000ff, 0x00ff00, 0xabcdef]);
    expect(drawing.counts).toEqual({ entities: 5, skipped_paper_space: 1, skipped_invisible: 1 });
    expect(drawing.extents).toEqual({ x0: 0, y0: 0, x1: 3, y1: 4 });
  });

  it("measures open and closed polylines", () => {
    const square = [[0, 0], [2, 0], [2, 2], [0, 2]] as const;
    const [open, closed] = listCadPaths(read({ entities: [lwpolyline("0", [...square]), lwpolyline("0", [...square], true)] }));
    expect(open).toMatchObject({ kind: "polyline", closed: false, length: 6, area: 0 });
    expect(closed).toMatchObject({ closed: true, length: 8, area: 4 });
    expect(closed.points).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });

  it("follows bulges as arcs, exact in length and area", () => {
    const [half, shape] = listCadPaths(read({
      entities: [
        lwpolyline("0", [[0, 0, 1], [2, 0]]),
        lwpolyline("0", [[0, 0], [2, 0, 1], [2, 2], [0, 2]], true),
      ],
    }));
    expect(half.length).toBeCloseTo(Math.PI, 12);
    for (const [x, y] of half.points) expect(Math.hypot(x - 1, y)).toBeCloseTo(1, 12);
    // Counter-clockwise from (0, 0) to (2, 0): the arc passes under the chord.
    expect(half.points.some(([x, y]) => Math.abs(x - 1) < 1e-9 && Math.abs(y + 1) < 1e-9)).toBe(true);
    expect(shape.length).toBeCloseTo(6 + Math.PI, 12);
    expect(shape.area).toBeCloseTo(4 + Math.PI / 2, 12);
    // A clockwise outline with the same bulge sign bites into the square.
    const [bitten] = listCadPaths(read({ entities: [lwpolyline("0", [[0, 0], [0, 2], [2, 2, 1], [2, 0]], true)] }));
    expect(bitten.area).toBeCloseTo(4 - Math.PI / 2, 12);
  });

  it("reads old-style polylines, flattens 3D ones and counts meshes as unread", () => {
    const vertex = (x: number, y: number, ...pairs: (readonly [number, number])[]) => rec("VERTEX", [8, "0"], [10, x], [20, y], [30, 7], ...pairs);
    const drawing = read({
      entities: [
        rec("POLYLINE", [8, "EU"], [66, 1], [70, 1]), vertex(0, 0), vertex(4, 0), vertex(4, 3), rec("SEQEND"),
        rec("POLYLINE", [8, "EU"], [66, 1], [70, 8]), vertex(0, 0), vertex(3, 4), vertex(9, 9, [70, 16]), rec("SEQEND"),
        rec("POLYLINE", [8, "EU"], [66, 1], [70, 64]), vertex(0, 0), vertex(1, 1), rec("SEQEND"),
        line("EU", 0, 0, 1, 0),
      ],
    });
    const paths = listCadPaths(drawing);
    expect(paths.map((path) => [path.kind, path.closed, path.length])).toEqual([["polyline", true, 12], ["polyline", false, 5], ["line", false, 1]]);
    expect(paths[0].area).toBe(6);
    expect(drawing.unsupported).toEqual([{ type: "POLYLINE (maillage)", count: 1 }]);
  });

  it("measures arcs through 0° and circles", () => {
    const [wrapped, quarter, full] = listCadPaths(read({ entities: [arc("0", 0, 0, 10, 350, 10), arc("0", 5, 5, 2, 0, 90), circle("0", 1, 1, 3)] }));
    expect(wrapped).toMatchObject({ kind: "arc", closed: false });
    expect(wrapped.length).toBeCloseTo(10 * (20 * Math.PI) / 180, 12);
    expect(wrapped.points[0][1]).toBeCloseTo(10 * Math.sin((350 * Math.PI) / 180), 9);
    expect(wrapped.points.at(-1)?.[1]).toBeCloseTo(10 * Math.sin((10 * Math.PI) / 180), 9);
    expect(quarter.length).toBeCloseTo(Math.PI, 12);
    expect(quarter.points[0]).toEqual([7, 5]);
    expect(quarter.points.at(-1)?.[0]).toBeCloseTo(5, 9);
    expect(full).toMatchObject({ kind: "circle", closed: true });
    expect(full.length).toBeCloseTo(6 * Math.PI, 12);
    expect(full.area).toBeCloseTo(9 * Math.PI, 12);
  });

  it("mirrors entities drawn on the reversed plane (extrusion 0, 0, -1)", () => {
    const flipped = [[210, 0], [220, 0], [230, -1]] as const;
    const [round, bend] = listCadPaths(read({ entities: [circle("0", -5, 2, 1, ...flipped), arc("0", 0, 0, 1, 0, 90, ...flipped)] }));
    const xs = round.points.map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(4, 9);
    expect(Math.max(...xs)).toBeCloseTo(6, 9);
    expect(round.area).toBeCloseTo(Math.PI, 12);
    expect(bend.points[0][0]).toBeCloseTo(-1, 9);
    expect(bend.points.at(-1)).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9)]);
    expect(bend.length).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe("readDxf: ellipses and splines", () => {
  it("measures a whole ellipse and an elliptic arc", () => {
    const ellipse = (...pairs: (readonly [number, number])[]) => rec("ELLIPSE", [8, "0"], [10, 0], [20, 0], [30, 0], [11, 2], [21, 0], [31, 0], [40, 0.5], ...pairs);
    const [whole, quarter] = listCadPaths(read({ entities: [ellipse([41, 0], [42, 2 * Math.PI]), ellipse([41, 0], [42, Math.PI / 2])] }));
    expect(whole).toMatchObject({ kind: "ellipse", closed: true });
    expect(whole.area).toBeCloseTo(2 * Math.PI, 9);
    expect(whole.length).toBeCloseTo(9.688448, 3);
    expect(quarter.closed).toBe(false);
    expect(quarter.length).toBeCloseTo(9.688448 / 4, 3);
    expect(quarter.points[0]).toEqual([2, 0]);
    expect(quarter.points.at(-1)).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9)]);
  });

  it("evaluates splines from their control points, knots and weights", () => {
    const spline = (degree: number, knots: number[], control: [number, number][], weights: number[] = [], ...pairs: (readonly [number, number])[]) => rec("SPLINE",
      [8, "0"], [70, weights.length > 0 ? 12 : 8], [71, degree], [72, knots.length], [73, control.length], [74, 0],
      ...knots.map((knot) => [40, knot] as const),
      ...control.flatMap(([x, y]) => [[10, x], [20, y], [30, 0]] as const),
      ...weights.map((weight) => [41, weight] as const), ...pairs);
    const drawing = read({
      entities: [
        spline(1, [0, 0, 1, 2, 2], [[0, 0], [3, 0], [3, 4]]),
        spline(3, [0, 0, 0, 0, 1, 1, 1, 1], [[0, 0], [1, 2], [3, 2], [4, 0]]),
        spline(2, [0, 0, 0, 1, 1, 1], [[1, 0], [1, 1], [0, 1]], [1, Math.SQRT1_2, 1]),
      ],
    });
    const [broken, bezier, quarter] = listCadPaths(drawing);
    expect(broken.kind).toBe("spline");
    expect(broken.length).toBeCloseTo(7, 9);
    expect(bezier.points[0]).toEqual([0, 0]);
    expect(bezier.points.at(-1)).toEqual([expect.closeTo(4, 9), expect.closeTo(0, 9)]);
    // The middle of this Bézier is (2, 1.5).
    expect(bezier.points.some(([x, y]) => Math.abs(x - 2) < 1e-9 && Math.abs(y - 1.5) < 1e-9)).toBe(true);
    for (const [x, y] of quarter.points) expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    expect(quarter.length).toBeCloseTo(Math.PI / 2, 3);
    expect(drawing.warnings).toEqual([]);
  });

  it("joins the fit points of a spline without control points, and says so", () => {
    const drawing = read({
      entities: [rec("SPLINE", [8, "0"], [70, 8], [71, 3], [72, 0], [73, 0], [74, 3], [11, 0], [21, 0], [31, 0], [11, 3], [21, 0], [31, 0], [11, 3], [21, 4], [31, 0])],
    });
    expect(listCadPaths(drawing)[0].length).toBe(7);
    expect(drawing.warnings).toEqual([{ code: "spline_fit_points", detail: "1" }]);
  });
});

describe("readDxf: blocks", () => {
  const wc = { name: "WC", entities: [line("0", 0, 0, 1, 0), line("DETAIL", 0, 0, 0, 1, [62, 0])] };

  it("places a block reference: scale, rotation, position, layer and colour inheritance", () => {
    const drawing = read({
      layers: [layer("APPAREILS", 3), layer("DETAIL", 1)],
      blocks: [wc],
      entities: [insert("APPAREILS", "WC", 10, 5, [41, 2], [42, 2], [50, 90], [62, 5])],
    });
    const [inherited, detail] = listCadPaths(drawing);
    // Layer « 0 » in a block takes the layer of the reference; BYLAYER then reads that layer.
    expect(inherited).toMatchObject({ layer: "APPAREILS", gates: ["APPAREILS"], block: "WC", color: 0x00ff00, length: 2 });
    expect(inherited.points).toEqual([[10, 5], [expect.closeTo(10, 9), expect.closeTo(7, 9)]]);
    // Its own layer stays; BYBLOCK takes the colour of the reference.
    expect(detail).toMatchObject({ layer: "DETAIL", gates: ["APPAREILS"], block: "WC", color: 0x0000ff });
    expect(detail.points[1]).toEqual([expect.closeTo(8, 9), expect.closeTo(5, 9)]);
    expect(drawing.inserts).toEqual([{
      block: drawing.blocks.findIndex((block) => block.name === "WC"), layer: drawing.layers.findIndex((entry) => entry.name === "APPAREILS"),
      gate: 0, parent: -1, depth: 0, x: 10, y: 5, rotation: Math.PI / 2, scaleX: 2, scaleY: 2, attributes: [],
    }]);
    expect(drawing.gates).toEqual([[drawing.layers.findIndex((entry) => entry.name === "APPAREILS")]]);
    expect(drawing.blocks.find((block) => block.name === "WC")).toEqual({ name: "WC", label: "WC", anonymous: false, xref: false });
  });

  it("subtracts the base point of the block", () => {
    const [path] = listCadPaths(read({ blocks: [{ name: "B", base: [1, 1], entities: [line("0", 1, 1, 2, 1)] }], entities: [insert("0", "B", 10, 10)] }));
    expect(path.points).toEqual([[10, 10], [11, 10]]);
    expect(path.gates).toEqual(["0"]);
  });

  it("expands nested references and keeps the outermost block", () => {
    const drawing = read({
      layers: [layer("L1", 4)],
      blocks: [{ name: "B", entities: [line("0", 0, 0, 1, 0)] }, { name: "A", entities: [insert("0", "B", 5, 0)] }],
      entities: [insert("L1", "A", 100, 100)],
    });
    expect(listCadPaths(drawing)).toEqual([expect.objectContaining({ layer: "L1", gates: ["L1"], block: "A", color: 0x00ffff, points: [[105, 100], [106, 100]] })]);
    expect(drawing.inserts.map((entry) => [drawing.blocks[entry.block].name, entry.parent, entry.depth, entry.x, entry.y])).toEqual([["A", -1, 0, 100, 100], ["B", 0, 1, 105, 100]]);
  });

  it("expands rectangular arrays", () => {
    const drawing = read({ blocks: [{ name: "B", entities: [circle("0", 0, 0, 1)] }], entities: [insert("0", "B", 0, 0, [70, 3], [71, 2], [44, 10], [45, 5])] });
    expect(drawing.inserts.map((entry) => [entry.x, entry.y])).toEqual([[0, 0], [10, 0], [20, 0], [0, 5], [10, 5], [20, 5]]);
    expect(drawing.paths.count).toBe(6);
  });

  it("mirrors and stretches: areas stay exact, lengths follow the drawn shape", () => {
    const drawing = read({
      blocks: [{ name: "B", entities: [lwpolyline("0", [[0, 0], [2, 0], [2, 1], [0, 1]], true), circle("0", 0, 0, 1)] }],
      entities: [insert("0", "B", 0, 0, [41, -1]), insert("0", "B", 50, 0, [41, 2], [42, 1])],
    });
    const [mirrored, , stretched, oval] = listCadPaths(drawing);
    expect(mirrored.points).toEqual([[0, 0], [-2, 0], [-2, 1], [0, 1]]);
    expect(mirrored).toMatchObject({ length: 6, area: 2 });
    expect(stretched).toMatchObject({ length: 10, area: 4 });
    expect(oval.area).toBeCloseTo(2 * Math.PI, 12);
    expect(oval.length).toBeCloseTo(9.688448, 2);
  });

  it("reports a missing block, a block that contains itself and too deep a nesting, without looping", () => {
    const missing = read({ entities: [insert("0", "ABSENT", 0, 0), insert("0", "ABSENT", 5, 0), line("0", 0, 0, 1, 0)] });
    expect(missing.warnings).toEqual([{ code: "missing_block", detail: "ABSENT" }]);
    expect(missing.paths.count).toBe(1);
    expect(missing.inserts).toEqual([]);

    const cycle = read({
      blocks: [{ name: "A", entities: [line("0", 0, 0, 1, 0), insert("0", "B", 0, 0)] }, { name: "B", entities: [insert("0", "A", 0, 0)] }],
      entities: [insert("0", "A", 0, 0)],
    });
    expect(cycle.warnings).toEqual([{ code: "block_cycle", detail: "A" }]);
    expect(cycle.paths.count).toBe(1);

    const chain = Array.from({ length: 6 }, (_, index) => ({ name: `N${index}`, entities: [line("0", 0, 0, 1, 0), ...(index < 5 ? [insert("0", `N${index + 1}`, 0, 0)] : [])] }));
    const deep = read({ blocks: chain, entities: [insert("0", "N0", 0, 0)] }, { limits: { maxDepth: 3 } });
    expect(deep.warnings).toEqual([{ code: "depth_limit", detail: "N3" }]);
    expect(deep.paths.count).toBe(3);
    expect(deep.truncated).toBe(true);
  });

  it("reports an external reference that is not in the file", () => {
    const drawing = read({ blocks: [{ name: "ARCHI", flags: 4, entities: [] }], entities: [insert("0", "ARCHI", 0, 0)] });
    expect(drawing.warnings).toEqual([{ code: "xref_missing", detail: "ARCHI" }]);
    expect(drawing.blocks.find((block) => block.name === "ARCHI")?.xref).toBe(true);
  });

  it("names a dynamic block reference after its source block", () => {
    const drawing = read({
      blockRecords: [
        rec("BLOCK_RECORD", [5, "2A"], [2, "Lavabo"]),
        rec("BLOCK_RECORD", [5, "3F"], [2, "*U7"], [1001, "AcDbBlockRepBTag"], [1070, 1], [1005, "2A"]),
      ],
      blocks: [{ name: "Lavabo", entities: [circle("0", 0, 0, 1)] }, { name: "*U7", flags: 1, entities: [circle("0", 0, 0, 2)] }],
      entities: [insert("0", "*U7", 0, 0)],
    });
    expect(drawing.blocks.find((block) => block.name === "*U7")).toEqual({ name: "*U7", label: "Lavabo", anonymous: true, xref: false });
  });

  it("keeps the layer that hides a reference when a deeper reference sits on a frozen layer", () => {
    const drawing = read({
      layers: [layer("L1", 4), rec("LAYER", [2, "GELE"], [70, 1], [62, 2])],
      blocks: [{ name: "B", entities: [line("EF", 0, 0, 1, 0)] }, { name: "A", entities: [insert("GELE", "B", 0, 0), line("EF", 0, 0, 2, 0)] }],
      entities: [insert("L1", "A", 0, 0)],
    });
    expect(listCadPaths(drawing).map((path) => [path.length, path.gates])).toEqual([[1, ["L1", "GELE"]], [2, ["L1"]]]);
  });

  it("gates what a nested reference draws by the layer of every reference it is drawn through", () => {
    const drawing = read({
      layers: [layer("A"), layer("B"), layer("C")],
      blocks: [{ name: "INNER", entities: [line("C", 0, 0, 1000, 0)] }, { name: "OUTER", entities: [insert("B", "INNER", 0, 0), insert("A", "INNER", 0, 500), line("C", 0, 900, 1000, 900)] }],
      entities: [insert("A", "OUTER", 0, 0), line("C", 0, 1500, 1000, 1500)],
    });
    expect(listCadPaths(drawing).map((path) => path.gates)).toEqual([[], ["A", "B"], ["A"], ["A"]]);
    const named = (gate: number) => (gate < 0 ? [] : drawing.gates[gate].map((entry) => drawing.layers[entry].name));
    expect(drawing.inserts.map((entry) => [drawing.blocks[entry.block].name, named(entry.gate)])).toEqual([["OUTER", ["A"]], ["INNER", ["A", "B"]], ["INNER", ["A"]]]);
  });
});

describe("readDxf: texts", () => {
  it("reads single-line texts: alignment point, angle, special characters", () => {
    const drawing = read({
      entities: [
        text("0", 1, 2, 2.5, "DN 100", [50, 90]),
        text("0", 1, 2, 2.5, "%%c32 %%uEF%%u 45%%d %%p0.5", [72, 1], [73, 2], [11, 7], [21, 8]),
        text("0", 1, 2, 2.5, "   "),
      ],
    });
    expect(drawing.texts).toEqual([
      expect.objectContaining({ x: 1, y: 2, height: 2.5, angle: Math.PI / 2, align: 0, baseline: 0, text: "DN 100", kind: "text" }),
      expect.objectContaining({ x: 7, y: 8, align: 1, baseline: 2, text: "Ø32 EF 45° ±0.5" }),
    ]);
  });

  it("reads paragraphs: chunks, line breaks, formatting codes, attachment and direction", () => {
    const drawing = read({
      entities: [
        rec("MTEXT", [8, "0"], [10, 5], [20, 6], [40, 3], [71, 5], [3, "{\\fArial|b0|i0|c0|p34;Chute "], [1, "EU\\PDN 100} \\S1^2; \\LNGF\\l"], [11, 0], [21, 1], [31, 0]),
        rec("MTEXT", [8, "0"], [10, 0], [20, 0], [40, 3], [71, 9], [1, "a\\\\b \\{c\\}"], [50, 45]),
      ],
    });
    expect(drawing.texts[0]).toMatchObject({ x: 5, y: 6, height: 3, align: 1, baseline: 2, text: "Chute EU\nDN 100 1/2 NGF", kind: "mtext" });
    expect(drawing.texts[0].angle).toBeCloseTo(Math.PI / 2, 12);
    expect(drawing.texts[1]).toMatchObject({ align: 2, baseline: 1, text: "a\\b {c}" });
    expect(drawing.texts[1].angle).toBeCloseTo(Math.PI / 4, 12);
  });

  it("reads the attributes of a block reference", () => {
    const drawing = read({
      blocks: [{ name: "REP", entities: [circle("0", 0, 0, 1), rec("ATTDEF", [8, "0"], [10, 0], [20, 0], [40, 1], [1, "?"], [3, "Repère"], [2, "REP"])] }],
      entities: [
        insert("APP", "REP", 10, 10, [66, 1]),
        rec("ATTRIB", [8, "APP"], [10, 10], [20, 12], [40, 1], [1, "WC-01"], [2, "REP"], [70, 0]),
        rec("ATTRIB", [8, "APP"], [10, 10], [20, 14], [40, 1], [1, "caché"], [2, "LOT"], [70, 1]),
        rec("SEQEND", [8, "APP"]),
        line("APP", 0, 0, 1, 0),
      ],
    });
    expect(drawing.inserts[0].attributes).toEqual([{ tag: "REP", value: "WC-01" }, { tag: "LOT", value: "caché" }]);
    expect(drawing.texts).toEqual([expect.objectContaining({ kind: "attribute", text: "WC-01", x: 10, y: 12, layer: drawing.layers.findIndex((entry) => entry.name === "APP") })]);
    expect(drawing.paths.count).toBe(2);
    expect(drawing.unsupported).toEqual([]);
  });

  it("draws a constant attribute definition as text of its block, at each reference", () => {
    const attdef = (y: number, value: string, flags: number) => rec("ATTDEF", [8, "0"], [10, 0], [20, y], [40, 1], [1, value], [3, "Invite"], [2, "ETIQ"], [70, flags]);
    const drawing = read({
      blocks: [{ name: "CART", entities: [attdef(0, "Lot 12 plomberie", 2), attdef(2, "variable", 0), attdef(4, "constant caché", 3), attdef(6, "à vérifier", 4)] }],
      entities: [insert("APP", "CART", 10, 10, [41, 2], [42, 2]), insert("APP", "CART", 100, 0), rec("ATTDEF", [8, "0"], [10, 0], [20, 0], [40, 1], [1, "hors bloc"], [2, "T"], [70, 2])],
    });
    const app = drawing.layers.findIndex((entry) => entry.name === "APP");
    expect(drawing.texts).toEqual([
      expect.objectContaining({ kind: "attribute", text: "Lot 12 plomberie", x: 10, y: 10, height: 2, layer: app }),
      expect.objectContaining({ kind: "attribute", text: "Lot 12 plomberie", x: 100, y: 0, height: 1, layer: app }),
    ]);
    expect(drawing.inserts.map((entry) => entry.attributes)).toEqual([[], []]);
    expect(drawing.unsupported).toEqual([]);
  });

  it("moves the texts of a block with its reference", () => {
    const drawing = read({ blocks: [{ name: "B", entities: [text("0", 1, 0, 2, "A")] }], entities: [insert("0", "B", 10, 0, [41, 3], [42, 3], [50, 90])] });
    expect(drawing.texts[0]).toMatchObject({ x: expect.closeTo(10, 9), y: expect.closeTo(3, 9), height: 6, text: "A" });
    expect(drawing.texts[0].angle).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe("readDxf: dimensions, hatches, fills", () => {
  it("draws a dimension from its block without counting it as tracé or as a block", () => {
    const drawing = read({
      layers: [layer("COTES", 2)],
      blocks: [{ name: "*D1", flags: 1, entities: [line("0", 0, 0, 5, 0), rec("MTEXT", [8, "0"], [10, 2.5], [20, 0.5], [40, 0.2], [71, 8], [1, "5.00"])] }],
      entities: [rec("DIMENSION", [8, "COTES"], [2, "*D1"], [10, 0], [20, 0], [30, 0], [70, 32], [1, ""])],
    });
    expect(listCadPaths(drawing)).toEqual([expect.objectContaining({ kind: "dimension", layer: "COTES", color: 0xffff00, length: 5 })]);
    expect(drawing.texts).toEqual([expect.objectContaining({ kind: "dimension", text: "5.00" })]);
    expect(drawing.inserts).toEqual([]);
  });

  it("reads hatch boundaries: polyline loops with a hole", () => {
    const loop = (points: [number, number][]) => [[92, 2], [72, 0], [73, 1], [93, points.length], ...points.flatMap(([x, y]) => [[10, x], [20, y]] as const), [97, 0]] as const;
    const drawing = read({
      entities: [rec("HATCH", [8, "SOL"], [10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1], [2, "SOLID"], [70, 1], [71, 0], [91, 2],
        ...loop([[0, 0], [10, 0], [10, 10], [0, 10]]), ...loop([[4, 4], [6, 4], [6, 6], [4, 6]]), [75, 0], [76, 1], [98, 1], [10, 99], [20, 99])],
    });
    const [outer, hole] = listCadPaths(drawing);
    expect(outer).toMatchObject({ kind: "hatch", layer: "SOL", closed: true, filled: true, compound: false, area: 100, length: 40 });
    expect(hole).toMatchObject({ kind: "hatch", closed: true, compound: true, area: -4, length: 8 });
    expect(drawing.paths.count).toBe(2);
  });

  it("fills a hatch the way its style says: every other ring, the outer ring only, or the whole outline", () => {
    const square = (from: number, to: number) => [[92, 2], [72, 0], [73, 1], [93, 4], [10, from], [20, from], [10, to], [20, from], [10, to], [20, to], [10, from], [20, to], [97, 0]] as const;
    const areas = (style: number) => listCadPaths(read({
      entities: [rec("HATCH", [8, "SOL"], [10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1], [2, "SOLID"], [70, 1], [71, 0], [91, 3],
        ...square(0, 10), ...square(2, 8), ...square(4, 6), [75, style], [76, 1], [98, 0])],
    })).map((path) => [path.area, path.compound]);
    // Normal: the island inside the hole is filled again.
    expect(areas(0)).toEqual([[100, false], [-36, true], [4, true]]);
    // Outer: only the outermost area is filled, what lies inside its hole is left empty.
    expect(areas(1)).toEqual([[100, false], [-36, true]]);
    // Ignore: the inner boundaries do not count.
    expect(areas(2)).toEqual([[100, false]]);
  });

  it("reads hatch boundaries made of edges: lines, arcs both ways, a bulged polyline", () => {
    const upper = [[92, 1], [93, 2], [72, 1], [10, -1], [20, 0], [11, 1], [21, 0], [72, 2], [10, 0], [20, 0], [40, 1], [50, 0], [51, 180], [73, 1], [97, 0]] as const;
    // Clockwise arcs store their angles mirrored (360 - angle): 0 → 180 clockwise is the lower half.
    const lower = [[92, 1], [93, 2], [72, 1], [10, -1], [20, 10], [11, 1], [21, 10], [72, 2], [10, 0], [20, 10], [40, 1], [50, 0], [51, 180], [73, 0], [97, 0]] as const;
    const bulged = [[92, 2], [72, 1], [73, 1], [93, 2], [10, 20], [20, 0], [42, 1], [10, 22], [20, 0], [42, 1], [97, 0]] as const;
    const drawing = read({
      entities: [rec("HATCH", [8, "SOL"], [10, 0], [20, 0], [30, 0], [2, "ANSI31"], [70, 0], [71, 0], [91, 3], ...upper, ...lower, ...bulged, [75, 0], [76, 1], [52, 0], [41, 1], [77, 0], [78, 0], [98, 0])],
    });
    const [top, bottom, disc] = listCadPaths(drawing);
    expect(top.filled).toBe(false);
    expect(top.area).toBeCloseTo(Math.PI / 2, 3);
    expect(Math.min(...top.points.map(([, y]) => y))).toBeCloseTo(0, 9);
    expect(bottom.area).toBeCloseTo(Math.PI / 2, 3);
    expect(Math.max(...bottom.points.map(([, y]) => y))).toBeCloseTo(10, 9);
    expect(disc.area).toBeCloseTo(Math.PI, 12);
    expect(disc.length).toBeCloseTo(2 * Math.PI, 12);
  });

  it("reads solids, traces, 3D faces and leaders", () => {
    const corners = [[10, 0], [20, 0], [11, 2], [21, 0], [12, 0], [22, 1], [13, 2], [23, 1]] as const;
    const drawing = read({
      entities: [
        rec("SOLID", [8, "0"], ...corners),
        rec("3DFACE", [8, "0"], [10, 0], [20, 0], [11, 3], [21, 0], [12, 3], [22, 4], [13, 3], [23, 4]),
        rec("LEADER", [8, "0"], [76, 3], [10, 0], [20, 0], [10, 3], [20, 4], [10, 6], [20, 4]),
      ],
    });
    const [solid, face, leader] = listCadPaths(drawing);
    // SOLID corners go 1, 2, 4, 3 around the outline.
    expect(solid).toMatchObject({ kind: "solid", closed: true, filled: true, area: 2, points: [[0, 0], [2, 0], [2, 1], [0, 1]] });
    expect(face).toMatchObject({ kind: "solid", closed: true, filled: false, area: 6 });
    expect(face.points).toHaveLength(3);
    expect(leader).toMatchObject({ kind: "leader", closed: false, length: 8 });
  });
});

describe("readDxf: limits and unread entities", () => {
  it("counts by type what it does not read and ignores points and attribute definitions", () => {
    const drawing = read({
      entities: [rec("3DSOLID", [8, "0"], [1, "x"]), rec("IMAGE", [8, "0"]), rec("3DSOLID", [8, "0"]), rec("POINT", [8, "0"], [10, 1], [20, 1]), rec("ATTDEF", [8, "0"], [2, "T"]), line("0", 0, 0, 1, 0)],
    });
    expect(drawing.unsupported).toEqual([{ type: "3DSOLID", count: 2 }, { type: "IMAGE", count: 1 }]);
    expect(drawing.paths.count).toBe(1);
    expect(drawing.truncated).toBe(false);
  });

  it("stops at its limits and says the reading is partial", () => {
    const many = Array.from({ length: 10 }, (_, index) => line("0", 0, index, 1, index));
    const entities = read({ entities: many }, { limits: { maxEntities: 4 } });
    expect(entities.truncated).toBe(true);
    expect(entities.warnings).toEqual([{ code: "limit_entities" }]);
    expect(entities.paths.count).toBe(4);

    const points = read({ entities: many }, { limits: { maxPoints: 7 } });
    expect(points.truncated).toBe(true);
    expect(points.warnings).toEqual([{ code: "limit_points" }]);
    expect(points.paths.count).toBe(3);

    const inserts = read({ blocks: [{ name: "B", entities: [line("0", 0, 0, 1, 0)] }], entities: [insert("0", "B", 0, 0, [70, 5], [71, 5], [44, 2], [45, 2])] }, { limits: { maxInserts: 10 } });
    expect(inserts.truncated).toBe(true);
    expect(inserts.warnings).toEqual([{ code: "limit_inserts" }]);
    expect(inserts.inserts).toHaveLength(10);

    const texts = read({ entities: [text("0", 0, 0, 1, "a"), text("0", 0, 1, 1, "b"), text("0", 0, 2, 1, "c")] }, { limits: { maxTexts: 2 } });
    expect(texts.truncated).toBe(true);
    expect(texts.warnings).toEqual([{ code: "limit_texts" }]);
  });

  it("does not read the paper space layouts", () => {
    const drawing = read({
      blocks: [{ name: "*Paper_Space", entities: [line("0", 0, 0, 420, 0)] }, { name: "*Model_Space", entities: [] }],
      entities: [line("0", 0, 0, 1, 0)],
    });
    expect(drawing.paths.count).toBe(1);
    expect(drawing.blocks.map((block) => block.name)).not.toContain("*Paper_Space");
  });
});

// A file is read as it comes: a wrong number in it may cost a quantity, never the reader.
describe("readDxf: a malformed file cannot hold the reader", () => {
  const ellipse = (...pairs: (readonly [number, number])[]) => rec("ELLIPSE", [8, "0"], [10, 0], [20, 0], [30, 0], [11, 2], [21, 0], [31, 0], [40, 0.5], ...pairs);
  const finite = (drawing: ReturnType<typeof read>) => listCadPaths(drawing).every((path) => Number.isFinite(path.length) && Number.isFinite(path.area)
    && path.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));

  it("reads an arc whose angles are huge or are not numbers", () => {
    const drawing = read({ entities: [arc("0", 0, 0, 1, 1e300, 90), arc("0", 0, 0, 1, 0, Infinity), arc("0", 0, 0, 1, 1e17, 0)] });
    const [huge, endless, far] = listCadPaths(drawing);
    expect(huge.length).toBeGreaterThan(0);
    expect(huge.length).toBeLessThanOrEqual(2 * Math.PI);
    // What is not a number reads as zero: from 0° to 0° is the whole turn.
    expect(endless.length).toBeCloseTo(2 * Math.PI, 12);
    expect(far.length).toBeGreaterThan(0);
    expect(far.length).toBeLessThanOrEqual(2 * Math.PI);
    expect(finite(drawing)).toBe(true);
  });

  it("reads an ellipse and hatch edges whose angles are huge", () => {
    const arcLoop = [[92, 1], [93, 2], [72, 1], [10, -1], [20, 0], [11, 1], [21, 0], [72, 2], [10, 0], [20, 0], [40, 1], [50, 1e300], [51, 180], [73, 1], [97, 0]] as const;
    const ellipseLoop = [[92, 1], [93, 2], [72, 1], [10, -2], [20, 0], [11, 2], [21, 0], [72, 3], [10, 0], [20, 0], [11, 2], [21, 0], [40, 0.5], [50, 1e300], [51, 180], [73, 1], [97, 0]] as const;
    const drawing = read({
      entities: [
        ellipse([41, 1e300], [42, 1]),
        rec("HATCH", [8, "SOL"], [10, 0], [20, 0], [30, 0], [2, "ANSI31"], [70, 0], [71, 0], [91, 2], ...arcLoop, ...ellipseLoop, [75, 0], [76, 1], [98, 0]),
      ],
    });
    const [curve] = listCadPaths(drawing);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve.length).toBeLessThanOrEqual(4 * Math.PI);
    expect(drawing.paths.count).toBe(3);
    expect(finite(drawing)).toBe(true);
  });

  it("joins the control points of a spline whose degree no drawing has", () => {
    const count = 401, degree = 400;
    const drawing = read({
      entities: [rec("SPLINE", [8, "0"], [70, 8], [71, degree], [72, count + degree + 1], [73, count], [74, 0],
        ...Array.from({ length: count + degree + 1 }, (_, index) => [40, index < count ? 0 : 1] as const),
        ...Array.from({ length: count }, (_, index) => [[10, index], [20, index % 2], [30, 0]] as const).flat())],
    });
    expect(listCadPaths(drawing)[0].length).toBeCloseTo(400 * Math.SQRT2, 6);
  });

  it("closes an ellipse whose end angle is written with six decimals", () => {
    const [whole] = listCadPaths(read({ entities: [ellipse([41, 0], [42, 6.283185])] }));
    expect(whole.closed).toBe(true);
    expect(whole.area).toBeCloseTo(2 * Math.PI, 5);
    expect(whole.length).toBeCloseTo(9.688448, 3);
  });

  it("measures a circle and an arc whose radius is written negative", () => {
    const [round, bend] = listCadPaths(read({ entities: [circle("0", 0, 0, -2), arc("0", 0, 0, -2, 0, 90)] }));
    expect(round.length).toBeCloseTo(4 * Math.PI, 12);
    expect(round.area).toBeCloseTo(4 * Math.PI, 12);
    expect(bend.length).toBeCloseTo(Math.PI, 12);
  });

  it("counts the references a dimension holds against the limit on references", () => {
    const tenOf = (name: string) => Array.from({ length: 10 }, (_, index) => insert("0", name, index, 0));
    const dimension = rec("DIMENSION", [8, "COTES"], [2, "*D1"], [10, 0], [20, 0], [30, 0], [70, 32], [1, ""]);
    const nested = read({
      blocks: [{ name: "L0", entities: [line("0", 0, 0, 1, 0)] }, { name: "L1", entities: tenOf("L0") }, { name: "L2", entities: tenOf("L1") }, { name: "*D1", flags: 1, entities: tenOf("L2") }],
      entities: [dimension],
    }, { limits: { maxInserts: 100 } });
    expect(nested.truncated).toBe(true);
    expect(nested.warnings).toEqual([{ code: "limit_inserts" }]);
    expect(nested.paths.count).toBeLessThanOrEqual(100);

    const array = read({
      blocks: [{ name: "PETIT", entities: [line("0", 0, 0, 1, 0)] }, { name: "*D1", flags: 1, entities: [insert("0", "PETIT", 0, 0, [70, 300], [71, 300])] }],
      entities: [dimension],
    }, { limits: { maxInserts: 100 } });
    expect(array.truncated).toBe(true);
    expect(array.warnings).toEqual([{ code: "limit_inserts" }]);
    expect(array.paths.count).toBeLessThanOrEqual(100);
  });

  it("counts the references that lead nowhere against the limit on references", () => {
    const drawing = read({
      blocks: [{ name: "B", entities: Array.from({ length: 50 }, (_, index) => insert("0", "ABSENT", index, 0)) }],
      entities: Array.from({ length: 50 }, (_, index) => insert("0", "B", 0, index)),
    }, { limits: { maxInserts: 100 } });
    expect(drawing.truncated).toBe(true);
    expect(drawing.warnings.map((warning) => warning.code)).toEqual(["missing_block", "limit_inserts"]);
  });

  it("holds a block definition to the limit on points, placed or not", () => {
    const rounded = lwpolyline("0", Array.from({ length: 20 }, (_, index) => [index, 0, 1] as const));
    // 20 vertices and 19 half circles of 35 points each: 685 points, in a block that nothing places.
    const drawing = read({ blocks: [{ name: "GROS", entities: [rounded] }, { name: "PETIT", entities: [line("0", 0, 0, 1, 0)] }], entities: [insert("0", "PETIT", 0, 0)] }, { limits: { maxPoints: 100 } });
    expect(drawing.truncated).toBe(true);
    expect(drawing.warnings).toEqual([{ code: "limit_points" }]);
    // The reading goes on without the entity that does not fit.
    expect(drawing.paths.count).toBe(1);
    expect(drawing.inserts).toHaveLength(1);
  });
});

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { DWG_DATABASE_DXF_WRITER } from "@/lib/cad/dwg-conversion-script";
import { readDxf } from "@/lib/cad/dxf";
import { cadPathAt, listCadPaths } from "@/lib/cad/model";

// The program text the conversion process runs is run here as it is, on drawings written by hand in the
// shape LibreDWG's reading gives them: what the reader of src/lib/cad then draws and measures is what counts.

type Json = Record<string, unknown>;
type Writer = (database: unknown, version: string, unread: Record<string, number>, write: (text: string) => void) => boolean;

const writeDatabaseDxf = runInNewContext(`${DWG_DATABASE_DXF_WRITER}; writeDatabaseDxf;`) as Writer;

const at = (x: number, y: number, z = 0) => ({ x, y, z });
const UP = at(0, 0, 1);
const entity = (type: string, fields: Json = {}): Json => ({ type, layer: "0", colorIndex: 256, isVisible: true, ...fields });
const line = (x0: number, y0: number, x1: number, y1: number, fields: Json = {}) => entity("LINE", { startPoint: at(x0, y0), endPoint: at(x1, y1), ...fields });
const block = (name: string, entities: unknown[], fields: Json = {}): Json => ({ name, flags: 0, basePoint: at(0, 0), entities, ...fields });
const layerEntry = (name: string, fields: Json = {}): Json => ({ name, colorIndex: 7, color: 0xffffff, frozen: false, off: false, locked: false, plotFlag: 1, ...fields });

type Sketch = { model?: unknown[]; paper?: unknown[]; blocks?: Json[]; layers?: Json[]; header?: Json; version?: string; unread?: Record<string, number> };

function dxfOf(sketch: Sketch): string {
  const database = {
    header: sketch.header ?? { INSUNITS: 6 },
    tables: {
      LAYER: { entries: sketch.layers ?? [layerEntry("0")] },
      BLOCK_RECORD: { entries: [block("*Model_Space", sketch.model ?? []), block("*Paper_Space", sketch.paper ?? []), ...(sketch.blocks ?? [])] },
    },
  };
  let text = "";
  writeDatabaseDxf(database, sketch.version ?? "AC1015", sketch.unread ?? {}, (part) => {
    text += part;
  });
  return text;
}

const drawingOf = (sketch: Sketch) => readDxf(new TextEncoder().encode(dxfOf(sketch)));

describe("the DXF written from LibreDWG's reading of a DWG", () => {
  it("is a whole DXF that says the format and the units of the drawing", () => {
    const drawing = drawingOf({ version: "AC1014", header: { INSUNITS: 4 }, model: [line(0, 0, 3, 4)] });
    expect(drawing.truncated).toBe(false);
    expect(drawing.warnings).toEqual([]);
    expect(drawing.version).toEqual({ code: "AC1014", label: "AutoCAD R14" });
    expect(drawing.units.name).toBe("millimètre");
    expect(drawing.counts.entities).toBe(1);
    expect(cadPathAt(drawing, 0)).toMatchObject({ kind: "line", layer: "0", length: 5 });
    // A format that has no unit of its own leaves the choice to who reads the plan.
    expect(drawingOf({ header: {} }).units.metresPerUnit).toBeNull();
  });

  it("gives each layer its colour and its state", () => {
    const { layers } = drawingOf({
      layers: [
        layerEntry("0"), layerEntry("EU", { colorIndex: 1 }), layerEntry("Éteint", { colorIndex: 3, off: true }), layerEntry("Gelé", { colorIndex: 5, frozen: true }),
        layerEntry("Teinte", { colorIndex: 256, color: 0x123456 }), layerEntry("Hors tracé", { plotFlag: 0 }),
      ],
    });
    expect(layers.map(({ name, color, on, frozen, plot }) => [name, color, on, frozen, plot])).toEqual([
      ["0", 0xffffff, true, false, true], ["EU", 0xff0000, true, false, true], ["Éteint", 0x00ff00, false, false, true], ["Gelé", 0x0000ff, true, true, true],
      ["Teinte", 0x123456, true, false, true], ["Hors tracé", 0xffffff, true, false, false],
    ]);
  });

  it("plots every layer of a format that cannot keep one off the plot", () => {
    // LibreDWG reads « not plotted » where an R13 or R14 file has no such flag.
    for (const version of ["AC1012", "AC1014"]) expect(drawingOf({ version, layers: [layerEntry("0", { plotFlag: 0 })] }).layers[0].plot, version).toBe(true);
    expect(drawingOf({ version: "AC1015", layers: [layerEntry("0", { plotFlag: 0 })] }).layers[0].plot).toBe(false);
  });

  it("closes a light polyline on LibreDWG's own flag and keeps its arcs", () => {
    const corners = [{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0, bulge: 1 }];
    const drawing = drawingOf({
      model: [
        // Two half circles: a disc of radius 1.
        entity("LWPOLYLINE", { flag: 528, vertices: corners, extrusionDirection: at(0, 0, 0) }),
        entity("LWPOLYLINE", { flag: 0, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 3, y: 0, bulge: 0 }, { x: 3, y: 4, bulge: 0 }] }),
        // 1 is « closed » in a DXF, not in a DWG record.
        entity("LWPOLYLINE", { flag: 1, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 3, y: 0, bulge: 0 }, { x: 3, y: 4, bulge: 0 }] }),
      ],
    });
    const [disc, open, alsoOpen] = listCadPaths(drawing);
    expect(disc).toMatchObject({ kind: "polyline", closed: true });
    expect(disc.length).toBeCloseTo(2 * Math.PI, 9);
    expect(disc.area).toBeCloseTo(Math.PI, 9);
    expect(open).toMatchObject({ closed: false, length: 7, area: 0 });
    expect(alsoOpen).toMatchObject({ closed: false, length: 7, area: 0 });
  });

  it("writes the polylines of the older formats with their vertices", () => {
    const vertex = (x: number, y: number, fields: Json = {}) => ({ x, y, z: 0, bulge: 0, flag: 0, ...fields });
    const drawing = drawingOf({
      model: [
        entity("POLYLINE2D", { flag: 1, vertices: [vertex(0, 0), vertex(4, 0), vertex(4, 3)], extrusionDirection: UP }),
        // The frame of a spline-fit polyline (flag 16) is not on the curve.
        entity("POLYLINE2D", { flag: 4, vertices: [vertex(0, 0, { flag: 8 }), vertex(50, 50, { flag: 16 }), vertex(6, 8, { flag: 8 })], extrusionDirection: UP }),
        entity("POLYLINE2D", { flag: 0, vertices: [vertex(0, 0, { bulge: 1 }), vertex(2, 0)], extrusionDirection: UP }),
        entity("POLYLINE3D", { flag: 1, vertices: [{ x: 0, y: 0, z: 0, flag: 32 }, { x: 3, y: 0, z: 9, flag: 32 }, { x: 3, y: 4, z: 2, flag: 32 }] }),
        line(0, 0, 1, 0),
      ],
    });
    const paths = listCadPaths(drawing);
    expect(paths.map((path) => [path.kind, path.closed, Number(path.length.toFixed(6)), Number(path.area.toFixed(6))])).toEqual([
      ["polyline", true, 12, 6], ["polyline", false, 10, 0], ["polyline", false, Number(Math.PI.toFixed(6)), 0], ["polyline", true, 12, 6], ["line", false, 1, 0],
    ]);
    expect(drawing.counts.entities).toBe(5);
    expect(drawing.unsupported).toEqual([]);
  });

  it("turns LibreDWG's radians into the degrees a DXF holds", () => {
    const drawing = drawingOf({
      model: [
        entity("ARC", { center: at(0, 0), radius: 2, startAngle: 0, endAngle: Math.PI / 2, extrusionDirection: UP }),
        entity("ARC", { center: at(0, 0), radius: 1, startAngle: (3 * Math.PI) / 2, endAngle: Math.PI / 2, extrusionDirection: UP }),
        entity("CIRCLE", { center: at(5, 5), radius: 1, extrusionDirection: UP }),
        entity("TEXT", { text: "EU Ø100", startPoint: { x: 1, y: 2 }, endPoint: { x: 0, y: 0 }, textHeight: 0.25, rotation: Math.PI / 6, xScale: 0.8, halign: 0, valign: 0, extrusionDirection: UP }),
        entity("INSERT", { name: "WC", insertionPoint: at(10, 0), xScale: 1, yScale: 1, zScale: 1, rotation: Math.PI / 2, columnCount: 0, rowCount: 0, columnSpacing: 0, rowSpacing: 0, extrusionDirection: UP, attribs: [] }),
      ],
      blocks: [block("WC", [line(0, 0, 2, 0)])],
    });
    const [quarter, half, circle, placed] = listCadPaths(drawing);
    expect(quarter.length).toBeCloseTo(Math.PI, 9);
    expect(half.length).toBeCloseTo(Math.PI, 9);
    expect(circle).toMatchObject({ kind: "circle", closed: true });
    expect(drawing.texts[0]).toMatchObject({ text: "EU Ø100", x: 1, y: 2, height: 0.25, stretch: 0.8, align: 0, baseline: 0 });
    expect(drawing.texts[0].angle).toBeCloseTo(Math.PI / 6, 9);
    expect(drawing.inserts[0].rotation).toBeCloseTo(Math.PI / 2, 9);
    // The block's line, turned a quarter of a turn about its reference.
    expect(placed.block).toBe("WC");
    expect(placed.points[1][0]).toBeCloseTo(10, 9);
    expect(placed.points[1][1]).toBeCloseTo(2, 9);
  });

  it("draws ellipses and splines from what the DWG keeps of them", () => {
    const drawing = drawingOf({
      model: [
        entity("ELLIPSE", { center: at(0, 0), majorAxisEndPoint: at(2, 0), axisRatio: 0.5, startAngle: 0, endAngle: 2 * Math.PI, extrusionDirection: UP }),
        entity("ELLIPSE", { center: at(0, 0), majorAxisEndPoint: at(1, 0), axisRatio: 1, startAngle: 0, endAngle: Math.PI, extrusionDirection: UP }),
        // A straight spline of degree 1 through three control points.
        entity("SPLINE", { flag: 8, degree: 1, knots: [0, 0, 1, 2, 2], controlPoints: [at(0, 0), at(3, 4), at(6, 8)], fitPoints: [] }),
        entity("SPLINE", { flag: 9, degree: 3, knots: [], controlPoints: [], fitPoints: [at(0, 0), at(3, 4), at(3, 10)] }),
      ],
    });
    const [ellipse, half, spline, fitted] = listCadPaths(drawing);
    expect(ellipse).toMatchObject({ kind: "ellipse", closed: true });
    expect(ellipse.area).toBeCloseTo(2 * Math.PI, 2);
    expect(half.closed).toBe(false);
    expect(half.length).toBeCloseTo(Math.PI, 3);
    expect(spline.length).toBeCloseTo(10, 9);
    expect(fitted.length).toBeCloseTo(11, 9);
    expect(drawing.warnings).toEqual([{ code: "spline_fit_points", detail: "1" }]);
  });

  it("places block references with their attributes, and arrays of them", () => {
    const attribute = (tag: string, text: string, flags = 0) => entity("ATTRIB", {
      tag, flags, text: { text, startPoint: { x: 1, y: 1 }, endPoint: { x: 0, y: 0 }, textHeight: 0.2, rotation: 0, xScale: 1, halign: 0, valign: 0, extrusionDirection: UP },
    });
    const reference = (fields: Json) => entity("INSERT", {
      name: "Regard", insertionPoint: at(0, 0), xScale: 1, yScale: 1, zScale: 1, rotation: 0, columnCount: 0, rowCount: 0, columnSpacing: 0, rowSpacing: 0, extrusionDirection: UP, attribs: [], ...fields,
    });
    const drawing = drawingOf({
      layers: [layerEntry("0"), layerEntry("Réseau", { colorIndex: 1 })],
      model: [
        reference({ layer: "Réseau", insertionPoint: at(5, 5), xScale: 2, yScale: 2, attribs: [attribute("REPERE", "R1"), attribute("COTE", "32.10", 1)] }),
        reference({ columnCount: 3, rowCount: 2, columnSpacing: 10, rowSpacing: 10 }),
        line(0, 0, 1, 0),
      ],
      blocks: [block("Regard", [line(0, 0, 1, 0), entity("CIRCLE", { center: at(0, 0), radius: 1, colorIndex: 0, extrusionDirection: UP })], { flags: 2, basePoint: at(0, 0) }), block("*U7", [line(0, 0, 1, 1)], { flags: 1 })],
    });
    expect(drawing.blocks).toEqual([{ name: "Regard", label: "Regard", anonymous: false, xref: false }, { name: "*U7", label: "*U7", anonymous: true, xref: false }]);
    expect(drawing.inserts).toHaveLength(7);
    expect(drawing.inserts[0]).toMatchObject({ x: 5, y: 5, scaleX: 2, scaleY: 2, attributes: [{ tag: "REPERE", value: "R1" }, { tag: "COTE", value: "32.10" }] });
    // An invisible attribute is told, not written on the plan.
    expect(drawing.texts.map((text) => [text.kind, text.text])).toEqual([["attribute", "R1"]]);
    const placed = listCadPaths(drawing).filter((path) => path.block === "Regard");
    expect(placed).toHaveLength(14);
    // What is on layer « 0 » in a block takes the layer of the reference, and what is BYBLOCK its colour.
    expect(placed[0]).toMatchObject({ kind: "line", layer: "Réseau", length: 2 });
    expect(placed[1]).toMatchObject({ kind: "circle", layer: "Réseau", color: 0xff0000 });
    expect(drawing.counts.entities).toBe(3);
  });

  it("writes single lines and paragraphs where the drawing sets them", () => {
    const paragraph = `${"Réseau d'évacuation ".repeat(20)}fin`;
    const drawing = drawingOf({
      model: [
        // Centred on its second point.
        entity("TEXT", { text: "Local technique", startPoint: { x: 0, y: 0 }, endPoint: { x: 4, y: 2 }, textHeight: 0.3, rotation: 0, xScale: 1, halign: 1, valign: 2, extrusionDirection: UP }),
        entity("MTEXT", { text: "Niveau R+1\\PCuisine", insertionPoint: at(2, 3), textHeight: 0.5, rectWidth: 0, attachmentPoint: 5, direction: at(0, 1), rotation: 0, extrusionDirection: UP }),
        entity("MTEXT", { text: "Ligne 1\nLigne 2", insertionPoint: at(0, 0), textHeight: 0.5, rectWidth: 0, attachmentPoint: 1, direction: at(0, 0), rotation: Math.PI, extrusionDirection: UP }),
        entity("MTEXT", { text: paragraph, insertionPoint: at(0, 0), textHeight: 0.5, rectWidth: 0, attachmentPoint: 1, direction: at(1, 0), rotation: 0, extrusionDirection: UP }),
      ],
    });
    const [single, turned, broken, long] = drawing.texts;
    expect(single).toMatchObject({ kind: "text", text: "Local technique", x: 4, y: 2, align: 1, baseline: 2 });
    expect(turned).toMatchObject({ kind: "mtext", text: "Niveau R+1\nCuisine", x: 2, y: 3, height: 0.5, align: 1, baseline: 2 });
    expect(turned.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(broken.text).toBe("Ligne 1\nLigne 2");
    expect(broken.angle).toBeCloseTo(Math.PI, 9);
    expect(long.text).toBe(paragraph);
  });

  it("does not cut in two a character of a long paragraph", () => {
    for (const lead of [248, 249, 250, 499]) {
      const paragraph = `${"a".repeat(lead)}😀 fin ${"é".repeat(300)}`;
      const [written] = drawingOf({ model: [entity("MTEXT", { text: paragraph, insertionPoint: at(0, 0), textHeight: 0.5, rectWidth: 0, attachmentPoint: 1, direction: at(1, 0) })] }).texts;
      expect(written.text, String(lead)).toBe(paragraph);
    }
  });

  it("measures hatches from their outlines, polylines or edges", () => {
    const quarterTurn = Math.PI / 2;
    const drawing = drawingOf({
      model: [
        entity("HATCH", {
          patternName: "SOLID", solidFill: 1, hatchStyle: 0, patternType: 1, extrusionDirection: UP,
          boundaryPaths: [
            { boundaryPathTypeFlag: 3, hasBulge: false, isClosed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] },
            // A hole: a disc of radius 1 drawn as two half circles, the second clockwise.
            { boundaryPathTypeFlag: 16, edges: [
              { type: 2, center: { x: 5, y: 5 }, radius: 1, startAngle: 0, endAngle: 2 * quarterTurn, isCCW: true },
              { type: 2, center: { x: 5, y: 5 }, radius: 1, startAngle: 0, endAngle: 2 * quarterTurn, isCCW: false },
            ] },
          ],
        }),
        entity("HATCH", {
          patternName: "ANSI31", solidFill: 0, hatchStyle: 0, patternType: 1, extrusionDirection: UP,
          boundaryPaths: [{ boundaryPathTypeFlag: 1, edges: [
            { type: 1, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
            { type: 3, center: { x: 2, y: 0 }, end: { x: 2, y: 0 }, lengthOfMinorAxis: 0.5, startAngle: 0, endAngle: 2 * quarterTurn, isCCW: true },
          ] }],
        }),
        entity("HATCH", {
          patternName: "SOLID", solidFill: 1, hatchStyle: 0, patternType: 1, extrusionDirection: UP,
          boundaryPaths: [{ boundaryPathTypeFlag: 1, edges: [
            { type: 4, degree: 1, isRational: false, isPeriodic: false, knots: [0, 0, 1, 2, 2], controlPoints: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }], fitDatum: [] },
            { type: 1, start: { x: 6, y: 8 }, end: { x: 0, y: 0 } },
          ] }],
        }),
      ],
    });
    const [outline, hole, halfEllipse, triangle] = listCadPaths(drawing);
    expect(outline).toMatchObject({ kind: "hatch", closed: true, filled: true, compound: false, area: 100 });
    expect(hole).toMatchObject({ kind: "hatch", filled: true, compound: true });
    expect(hole.area).toBeCloseTo(-Math.PI, 9);
    expect(halfEllipse).toMatchObject({ kind: "hatch", filled: false });
    expect(halfEllipse.area).toBeCloseTo(Math.PI, 1);
    expect(triangle.area).toBeCloseTo(24, 9);
    expect(triangle.length).toBeCloseTo(24, 9);
    expect(drawing.counts.entities).toBe(3);
  });

  it("draws solids, faces and leaders, and the block of a dimension", () => {
    const drawing = drawingOf({
      model: [
        // A SOLID keeps its corners in a Z.
        entity("SOLID", { corner1: { x: 0, y: 0 }, corner2: { x: 2, y: 0 }, corner3: { x: 0, y: 2 }, corner4: { x: 2, y: 2 }, extrusionDirection: UP }),
        entity("3DFACE", { corner1: at(0, 0), corner2: at(3, 0), corner3: at(3, 3), corner4: at(0, 3) }),
        entity("LEADER", { vertices: [at(0, 0), at(3, 4), at(6, 4)] }),
        entity("DIMENSION", { name: "*D3", measurement: 5 }),
        entity("POINT", { position: at(1, 1) }),
      ],
      blocks: [block("*D3", [line(0, 0, 5, 0)], { flags: 1 })],
    });
    const [solid, face, leader, dimension] = listCadPaths(drawing);
    expect(solid).toMatchObject({ kind: "solid", filled: true, area: 4 });
    expect(face).toMatchObject({ kind: "solid", filled: false, area: 9 });
    expect(leader).toMatchObject({ kind: "leader", length: 8 });
    expect(dimension).toMatchObject({ kind: "dimension", length: 5 });
    expect(drawing.unsupported).toEqual([]);
    expect(drawing.counts.entities).toBe(5);
  });

  it("keeps the colour, the sheet and the visibility of each entity", () => {
    const drawing = drawingOf({
      layers: [layerEntry("0"), layerEntry("EV", { colorIndex: 3 })],
      model: [
        line(0, 0, 1, 0, { layer: "EV" }), line(0, 0, 1, 0, { layer: "EV", colorIndex: 1 }), line(0, 0, 1, 0, { layer: "EV", colorIndex: 256, color: 0x0a0b0c }),
        line(0, 0, 1, 0, { isVisible: false }),
        // LibreDWG leaves a direction at zero where the file holds none: the entity is seen from above.
        entity("CIRCLE", { center: at(1, 1), radius: 1, extrusionDirection: at(0, 0, 0) }),
        // Seen from below, a flat entity is mirrored.
        entity("CIRCLE", { center: at(1, 1), radius: 1, extrusionDirection: at(0, 0, -1) }),
      ],
      paper: [line(0, 0, 100, 0), entity("VIEWPORT")],
      blocks: [block("*Paper_Space0", [line(0, 0, 100, 0)]), block("$PAPER_SPACE1", [line(0, 0, 100, 0)])],
    });
    const paths = listCadPaths(drawing);
    expect(paths.map((path) => path.color)).toEqual([0x00ff00, 0xff0000, 0x0a0b0c, 0xffffff, 0xffffff]);
    expect(paths[3].points[0][0]).toBeGreaterThan(0);
    expect(paths[4].points[0][0]).toBeLessThan(0);
    // The sheet shown last is read past, the other sheets are not blocks to draw.
    expect(drawing.counts).toEqual({ entities: 8, skipped_paper_space: 2, skipped_invisible: 1 });
    expect(drawing.blocks).toEqual([]);
    expect(drawing.unsupported).toEqual([]);
  });

  it("takes the spaces under the names the older formats give them", () => {
    const database = { header: {}, tables: { LAYER: { entries: [] }, BLOCK_RECORD: { entries: [block("*MODEL_SPACE", [line(0, 0, 3, 4)]), block("*PAPER_SPACE", [line(0, 0, 1, 0)]), block("PORTE", [line(0, 0, 1, 0)])] } } };
    let text = "";
    writeDatabaseDxf(database, "AC1012", {}, (part) => {
      text += part;
    });
    const drawing = readDxf(new TextEncoder().encode(text));
    expect(drawing.counts).toEqual({ entities: 2, skipped_paper_space: 1, skipped_invisible: 0 });
    expect(drawing.blocks.map((entry) => entry.name)).toEqual(["PORTE"]);
    expect(listCadPaths(drawing)).toHaveLength(1);
  });

  it("names what it does not draw, and what LibreDWG's reading left out", () => {
    const drawing = drawingOf({
      model: [entity("XLINE"), entity("3DSOLID"), entity("SECTION"), entity("MULTILEADER"), line(0, 0, 1, 0)],
      blocks: [block("Détail", [entity("WIPEOUT")])],
      unread: { REGION: 2, POLYLINE_PFACE: 1, POLYLINE_MESH: 1, MINSERT: 3, SECTION: 1 },
    });
    expect(drawing.truncated).toBe(false);
    expect(Object.fromEntries(drawing.unsupported.map(({ type, count }) => [type, count]))).toEqual({
      XLINE: 1, "3DSOLID": 1, SECTIONOBJECT: 2, MULTILEADER: 1, WIPEOUT: 1, REGION: 2, "POLYLINE (maillage)": 2, MINSERT: 3,
    });
    expect(listCadPaths(drawing)).toHaveLength(1);
  });

  it("names an entity left out of a type it draws, instead of drawing it empty at the origin", () => {
    const drawing = drawingOf({
      model: [line(10, 10, 13, 14)],
      unread: { LINE: 2, CIRCLE: 1, TEXT: 3, DIMENSION: 2, INSERT: 1, HATCH: 1, POINT: 1, POLYLINE2D: 1 },
    });
    expect(Object.fromEntries(drawing.unsupported.map(({ type, count }) => [type, count]))).toEqual({
      LINE_NON_LU: 2, CIRCLE_NON_LU: 1, TEXT_NON_LU: 3, DIMENSION_NON_LU: 2, INSERT_NON_LU: 1, HATCH_NON_LU: 1, POINT_NON_LU: 1, POLYLINE2D: 1,
    });
    expect(listCadPaths(drawing)).toHaveLength(1);
    expect(drawing.extents).toEqual({ x0: 10, y0: 10, x1: 13, y1: 14 });
    expect(drawing.inserts).toEqual([]);
    expect(drawing.warnings).toEqual([]);
  });

  it("writes at each reference the text a block holds as a constant attribute", () => {
    const definition = (tag: string, text: string, flags: number) => entity("ATTDEF", {
      tag, prompt: "", flags, text: { text, startPoint: { x: 1, y: 2 }, endPoint: { x: 0, y: 0 }, textHeight: 0.2, rotation: 0, xScale: 1, halign: 0, valign: 0, extrusionDirection: UP },
    });
    const drawing = drawingOf({
      model: [0, 10].map((x) => entity("INSERT", { name: "Cartouche", insertionPoint: at(x, 0), xScale: 1, yScale: 1, zScale: 1, rotation: 0, attribs: [] })),
      // Constant (2), constant and invisible (3), and one asked for at each reference (0), which the reference then holds itself.
      blocks: [block("Cartouche", [definition("ENTREPRISE", "Hydroexpress", 2), definition("INTERNE", "caché", 3), definition("INDICE", "A", 0)], { flags: 2 })],
    });
    expect(drawing.texts.map((text) => [text.kind, text.text, text.x, text.y])).toEqual([["attribute", "Hydroexpress", 1, 2], ["attribute", "Hydroexpress", 11, 2]]);
  });

  it("lets nothing a drawing holds pass for the structure of the file", () => {
    const hostile = "x\n  0\nEOF\r\n0\nSECTION\n2\nENTITIES";
    const drawing = drawingOf({
      layers: [layerEntry("0"), layerEntry(`Calque${hostile}`)],
      model: [
        line(0, 0, 3, 4, { layer: `Calque${hostile}` }),
        entity("TEXT", { text: `Texte${hostile}`, startPoint: { x: 0, y: 0 }, textHeight: 1, rotation: 0, xScale: 1, halign: 0, valign: 0 }),
        entity("INSERT", { name: `B${hostile}`, insertionPoint: at(0, 0), xScale: 1, yScale: 1, zScale: 1, rotation: 0, attribs: [] }),
        entity(`LINE\n0\nEOF`), entity("EOF"), entity("ENDSEC"), entity("SECTION\n2\nHEADER"), entity("BLOCK"), entity("ENDBLK"), entity("SEQEND"), entity("VERTEX"), entity("ATTRIB"), entity("TABLE"),
        line(0, 0, 0, 2),
      ],
      blocks: [block(`B${hostile}`, [line(0, 0, 1, 0)])],
      unread: { EOF: 1, "ENDSEC\n0\nEOF": 2, SEQEND: 1, "": 4 },
    });
    expect(drawing.truncated).toBe(false);
    expect(drawing.unsupported).toEqual([]);
    const paths = listCadPaths(drawing);
    expect(paths.map((path) => path.length)).toEqual([5, 2, 1]);
    expect(paths[0].layer).toBe("Calquex   0 EOF 0 SECTION 2 ENTITIES");
    expect(drawing.texts.map((text) => text.text)).toEqual(["Textex   0 EOF 0 SECTION 2 ENTITIES"]);
    expect(drawing.inserts).toHaveLength(1);
  });

  it("writes a drawing whose values are missing or are not numbers, without stopping", () => {
    const drawing = drawingOf({
      layers: [layerEntry("0"), null as unknown as Json, { name: 12 }],
      header: { INSUNITS: "4" },
      model: [
        null, "LINE", 42, {}, entity("LINE"), entity("LINE", { startPoint: { x: Number.NaN, y: Infinity }, endPoint: { x: "3", y: null } }),
        entity("LWPOLYLINE", { vertices: "none" }), entity("ARC", { radius: -Infinity }), entity("HATCH", { boundaryPaths: [null, { boundaryPathTypeFlag: 2 }, { edges: [null, { type: 9 }] }] }),
        entity("INSERT", { attribs: [null, {}] }), entity("TEXT", { text: 7 }), entity("MTEXT"), entity("SPLINE", { knots: [null], controlPoints: [null] }), entity("POLYLINE2D", { vertices: [null] }),
        entity("DIMENSION"), entity("SOLID"), entity("LEADER"), entity("ELLIPSE"), line(0, 0, 3, 4, { colorIndex: 9999, color: "red" }),
      ],
      blocks: [null as unknown as Json, { name: null, entities: null }],
      unread: { REGION: Number.NaN, LIGHT: -3 },
    });
    expect(drawing.truncated).toBe(false);
    expect(drawing.units.metresPerUnit).toBeNull();
    const paths = listCadPaths(drawing);
    expect(paths[paths.length - 1]).toMatchObject({ kind: "line", length: 5, color: 0xffffff });
    expect(Number.isFinite(paths.reduce((sum, path) => sum + path.length + path.area, 0))).toBe(true);
  });

  it("writes nothing for what has no model space: LibreDWG hands that over for a file that is not a drawing", () => {
    const layers = { entries: [layerEntry("0")] };
    for (const database of [null, "x", {}, { tables: null }, { tables: { LAYER: layers } }, { tables: { LAYER: layers, BLOCK_RECORD: { entries: "x" } } }, { tables: { LAYER: layers, BLOCK_RECORD: { entries: [block("Regard", [line(0, 0, 1, 0)]), block("*Paper_Space", [])] } } }]) {
      const parts: string[] = [];
      expect(writeDatabaseDxf(database, "AC1015", { REGION: 1 }, (part) => parts.push(part))).toBe(false);
      expect(parts).toEqual([]);
    }
    const parts: string[] = [];
    expect(writeDatabaseDxf({ tables: { BLOCK_RECORD: { entries: [block("*Model_Space", [])] } } }, "AC1015", {}, (part) => parts.push(part))).toBe(true);
    expect(readDxf(new TextEncoder().encode(parts.join("")))).toMatchObject({ truncated: false, extents: null });
  });

  it("hands the DXF over in parts, so that a large drawing is never held whole", () => {
    const parts: string[] = [];
    const many = Array.from({ length: 5000 }, (_, index) => line(index, 0, index, 1));
    writeDatabaseDxf({ header: {}, tables: { LAYER: { entries: [] }, BLOCK_RECORD: { entries: [block("*Model_Space", many)] } } }, "AC1015", {}, (part) => parts.push(part));
    expect(parts.length).toBeGreaterThan(5);
    expect(Math.max(...parts.map((part) => part.length))).toBeLessThan(200_000);
    const drawing = readDxf(new TextEncoder().encode(parts.join("")));
    expect(drawing.paths.count).toBe(5000);
    expect(drawing.truncated).toBe(false);
  });
});

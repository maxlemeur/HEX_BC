import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { readDxf } from "@/lib/cad/dxf";
import { circle, dxfBytes, hatch, insert, layer, line, lwpolyline, rec, text, type DxfFixture } from "@/lib/cad/dxf.test-utils";
import { CadPlotError, plotCadDrawing } from "@/lib/cad/plot";
import { measureCadDrawing } from "@/lib/cad/quantities";
import { extractVectorPage } from "@/lib/takeoff/vectors/extraction";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";

const SPAWN = { timeout: 30_000 } as const;
const read = (fixture: DxfFixture) => readDxf(dxfBytes(fixture));
const room = (width: number, height: number) => lwpolyline("MURS", [[0, 0], [width, 0], [width, height], [0, height]], true);

/** A bathroom in millimetres: 10 m by 6 m, two networks, a valve block, a frozen layer. */
const plan: DxfFixture = {
  layers: [layer("EF", 5), layer("EU", 30), layer("MURS", 7), layer("TEXTE", 7), rec("LAYER", [2, "GELE"], [70, 1], [62, 2])],
  blocks: [{ name: "Vanne", entities: [line("0", 0, 0, 200, 0), line("0", 100, 0, 100, 100)] }],
  entities: [
    room(10000, 6000),
    line("EF", 1000, 1000, 9000, 1000), line("EF", 9000, 1000, 9000, 5000), insert("EF", "Vanne", 5000, 3000),
    line("EU", 1000, 2000, 6000, 2000), circle("EU", 7000, 3000, 500),
    line("GELE", 0, 0, 10000, 6000),
    text("TEXTE", 2000, 3000, 200, "Sdb Ø32 → EF"),
    hatch("MURS", [[0, 0], [10000, 0], [10000, 6000], [0, 6000]]),
  ],
};

async function contentOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const stream = doc.getPage(0).node.Contents();
  if (!(stream instanceof PDFRawStream)) throw new Error("one content stream expected");
  return { doc, content: Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") };
}

const reason = async (plot: Promise<unknown>) => {
  const error = await plot.then(() => null, (caught: unknown) => caught);
  return error instanceof CadPlotError ? error.reason : error;
};

describe("plotCadDrawing: sheet and scale", () => {
  it("lays the drawing on a sheet in whole millimetres, at the first scale that fits A0", async () => {
    const plot = await plotCadDrawing(read(plan));
    expect(plot).toMatchObject({ denominator: 20, scaleSource: "fit", otherScales: [], sheet_mm: [520, 332] });
    const { doc } = await contentOf(plot.bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect([width * MM_PER_POINT, height * MM_PER_POINT].map((value) => Math.round(value * 1000) / 1000)).toEqual([520, 332]);
    expect(doc.getPageCount()).toBe(1);
  });

  it("goes down the scales until the sheet fits, in either orientation", async () => {
    expect(await plotCadDrawing(read({ entities: [room(60000, 40000)] }))).toMatchObject({ denominator: 100, sheet_mm: [620, 432] });
    expect(await plotCadDrawing(read({ entities: [room(30000, 50000)] }))).toMatchObject({ denominator: 50, sheet_mm: [620, 1032] });
    expect(await plotCadDrawing(read({ entities: [room(1000, 1000)] }))).toMatchObject({ denominator: 20, sheet_mm: [210, 210] });
  });

  it("takes the scale asked for, on a sheet that may be longer than A0", async () => {
    const drawing = read({ entities: [room(60000, 40000)] });
    expect(await plotCadDrawing(drawing, { denominator: 50 })).toMatchObject({ denominator: 50, scaleSource: "requested", sheet_mm: [1220, 832] });
    expect(await reason(plotCadDrawing(drawing, { denominator: 30 }))).toBe("invalid_denominator");
    expect(await reason(plotCadDrawing(read({ entities: [room(200000, 1000)] }), { denominator: 20 }))).toBe("does_not_fit");
    expect(await reason(plotCadDrawing(read({ entities: [room(30_000_000, 1000)] })))).toBe("does_not_fit");
  });

  it("follows the scale the drawing announces when it announces one", async () => {
    const announced = (...labels: string[]) => read({ entities: [room(20000, 10000), ...labels.map((label, index) => text("TEXTE", 0, -500 - 300 * index, 150, label))] });
    expect(await plotCadDrawing(announced("Echelle : 1/100"))).toMatchObject({ denominator: 100, scaleSource: "drawing", otherScales: [] });
    expect(await plotCadDrawing(announced("1/100"))).toMatchObject({ denominator: 20, scaleSource: "fit", otherScales: [] });
    expect(await plotCadDrawing(announced("Echelle 1/100", "ECH 1/50"))).toMatchObject({ denominator: 20, scaleSource: "fit", otherScales: [50, 100] });
    expect(await plotCadDrawing(announced("Echelle 1/100"), { denominator: 50 })).toMatchObject({ denominator: 50, scaleSource: "requested", otherScales: [100] });
  });

  it("reads a scale written beside or under its label, in a text or in an attribute", async () => {
    const label = text("TEXTE", 0, -500, 150, "ECHELLE :");
    const beside = read({ entities: [room(20000, 10000), label, text("TEXTE", 1100, -500, 150, "1/100")] });
    expect(await plotCadDrawing(beside)).toMatchObject({ denominator: 100, scaleSource: "drawing", otherScales: [] });
    const under = read({ entities: [room(20000, 10000), label, text("TEXTE", 0, -800, 150, "1/100")] });
    expect(await plotCadDrawing(under)).toMatchObject({ denominator: 100, scaleSource: "drawing", otherScales: [] });
    const attribute = read({
      blocks: [{ name: "CART", entities: [line("0", 0, 0, 100, 0)] }],
      entities: [room(20000, 10000), label, insert("0", "CART", 1100, -500, [66, 1]),
        rec("ATTRIB", [8, "TEXTE"], [10, 1100], [20, -500], [40, 150], [1, "1/100"], [2, "ECH"], [70, 0]), rec("SEQEND")],
    });
    expect(await plotCadDrawing(attribute)).toMatchObject({ denominator: 100, scaleSource: "drawing", otherScales: [] });
  });

  it("reads a scale its paragraph wraps away from its label", async () => {
    const note = rec("MTEXT", [8, "TEXTE"], [10, 0], [20, -500], [40, 150], [41, 1200], [71, 1], [1, "ECHELLE : 1/100"]);
    const drawing = read({ entities: [room(20000, 10000), note] });
    expect(drawing.texts[0].text).toBe("ECHELLE :\n1/100");
    expect(await plotCadDrawing(drawing)).toMatchObject({ denominator: 100, scaleSource: "drawing", otherScales: [] });
  });

  it("reads a scale a cartouche block holds as a constant attribute", async () => {
    const drawing = read({
      blocks: [{ name: "CART", entities: [text("0", 0, 0, 150, "ECHELLE :"), rec("ATTDEF", [8, "0"], [10, 1100], [20, 0], [40, 150], [1, "1/100"], [3, ""], [2, "ECH"], [70, 2])] }],
      entities: [room(20000, 10000), insert("TEXTE", "CART", 0, -500)],
    });
    expect(await plotCadDrawing(drawing)).toMatchObject({ denominator: 100, scaleSource: "drawing", otherScales: [] });
  });

  it("leaves out of the sheet what a nested reference draws when the layer of that reference is hidden", async () => {
    const drawing = read({
      layers: [layer("A"), layer("B"), layer("C")],
      blocks: [{ name: "INNER", entities: [line("C", 0, 0, 30000, 0)] }, { name: "OUTER", entities: [insert("B", "INNER", 0, 0), lwpolyline("C", [[0, 0], [10000, 0], [10000, 6000], [0, 6000]], true)] }],
      entities: [insert("A", "OUTER", 0, 0)],
    });
    const all = await plotCadDrawing(drawing, { denominator: 50 });
    const withoutB = await plotCadDrawing(drawing, { denominator: 50, shown: drawing.layers.map((entry) => entry.name !== "B") });
    expect(all.sheet_mm[0] - withoutB.sheet_mm[0]).toBe(400);
  });

  it("leaves out of the sheet what a dimension draws on another layer when the layer of the dimension is hidden", async () => {
    const drawing = read({
      layers: [layer("COTES"), layer("TRAITS"), layer("MURS")],
      blocks: [{ name: "*D1", flags: 1, entities: [line("TRAITS", 0, -500, 30000, -500)] }],
      entities: [room(10000, 6000), rec("DIMENSION", [8, "COTES"], [2, "*D1"], [10, 0], [20, 0], [30, 0], [70, 32], [1, ""])],
    });
    const all = await plotCadDrawing(drawing, { denominator: 50 });
    const withoutCotes = await plotCadDrawing(drawing, { denominator: 50, shown: drawing.layers.map((entry) => entry.name !== "COTES") });
    expect(all.sheet_mm[0] - withoutCotes.sheet_mm[0]).toBe(400);
  });

  it("does not take for the scale a value far from the label", async () => {
    const label = text("TEXTE", 0, -500, 150, "ECHELLE :");
    const far = read({ entities: [room(20000, 10000), label, text("TEXTE", 15000, 8000, 150, "1/100")] });
    expect(await plotCadDrawing(far)).toMatchObject({ denominator: 20, scaleSource: "fit", otherScales: [] });
    const above = read({ entities: [room(20000, 10000), label, text("TEXTE", 0, -200, 150, "1/100")] });
    expect(await plotCadDrawing(above)).toMatchObject({ denominator: 20, scaleSource: "fit", otherScales: [] });
  });

  it("refuses a drawing read in part, without unit or without anything to plot", async () => {
    expect(await reason(plotCadDrawing(read({ entities: [room(1000, 1000)], eof: false })))).toBe("truncated");
    const unitless = read({ header: [[9, "$ACADVER"], [1, "AC1027"]], entities: [room(1000, 600)] });
    expect(await reason(plotCadDrawing(unitless))).toBe("unknown_unit");
    expect(await plotCadDrawing(unitless, { metresPerUnit: 0.01 })).toMatchObject({ denominator: 20, sheet_mm: [520, 332] });
    expect(await reason(plotCadDrawing(read({})))).toBe("empty");
    expect(await reason(plotCadDrawing(read(plan), { shown: [] }))).toBe("empty");
  });
});

describe("plotCadDrawing: content", () => {
  it("plots the layers shown, one PDF layer each, and leaves the hatches out", async () => {
    const drawing = read(plan);
    const plot = await plotCadDrawing(drawing);
    expect(plot.layers).toEqual(["EF", "EU", "MURS", "TEXTE"]);
    expect(plot).toMatchObject({ paths: 7, texts: 1, omitted: { hatches: 1, texts: 0 } });
    const hidden = await plotCadDrawing(drawing, { shown: drawing.layers.map((entry) => entry.visible && entry.name !== "EF") });
    expect(hidden.layers).toEqual(["EU", "MURS", "TEXTE"]);
    expect(hidden).toMatchObject({ paths: 3, sheet_mm: [520, 332] });
  });

  it("draws white in black and keeps the other colours", async () => {
    const { content } = await contentOf((await plotCadDrawing(read(plan))).bytes);
    expect(content).toContain("0 0 1 RG");
    expect(content).toContain("0 0 0 RG");
    expect(content).not.toContain("1 1 1 RG");
    expect(content).toMatch(/\/OC \/oc\d+ BDC/);
  });

  it("fills the solids and strokes the rest", async () => {
    const solid = rec("SOLID", [8, "COTES"], [10, 0], [20, 0], [11, 1000], [21, 0], [12, 0], [22, 1000], [13, 1000], [23, 1000]);
    const { content } = await contentOf((await plotCadDrawing(read({ entities: [room(5000, 5000), solid] }))).bytes);
    expect(content).toMatch(/\bh f\b/);
    expect(content).toMatch(/\bh S\b/);
  });

  it("widens a text its reference stretches, at the height the drawing gives it", async () => {
    const plotted = async (sx: number) => {
      const drawing = read({ blocks: [{ name: "B", entities: [text("T", 0, 0, 100, "Large")] }], entities: [room(20000, 10000), insert("T", "B", 19800, 1000, [41, sx], [42, 1])] });
      const plot = await plotCadDrawing(drawing, { denominator: 50 });
      // « Large », as the font encodes it.
      return { plot, text: /BT \/F1 (\S+) Tf (\S+ \S+ \S+ \S+) \S+ \S+ Tm <4C61726765> Tj/.exec((await contentOf(plot.bytes)).content) };
    };
    const plain = await plotted(1), wide = await plotted(4);
    expect(plain.text?.[2]).toBe("1 0 0 1");
    expect(wide.text?.[2]).toBe("4 0 0 1");
    expect(wide.text?.[1]).toBe(plain.text?.[1]);
    // The sheet makes room for the widened text, which runs further past the wall.
    expect(wide.plot.sheet_mm[0]).toBeGreaterThan(plain.plot.sheet_mm[0]);
  });

  it("narrows a text written with a width factor", async () => {
    const plotted = async (factor: number) => {
      const plot = await plotCadDrawing(read({ entities: [room(20000, 10000), text("T", 19800, 1000, 100, "Large", [41, factor])] }), { denominator: 50 });
      return { plot, matrix: /BT \/F1 \S+ Tf (\S+ \S+ \S+ \S+) \S+ \S+ Tm <4C61726765> Tj/.exec((await contentOf(plot.bytes)).content)?.[1] };
    };
    const plain = await plotted(1), narrow = await plotted(0.5), wide = await plotted(4);
    expect([plain.matrix, narrow.matrix, wide.matrix]).toEqual(["1 0 0 1", "0.5 0 0 1", "4 0 0 1"]);
    expect(narrow.plot.sheet_mm[0]).toBeLessThan(plain.plot.sheet_mm[0]);
    expect(wide.plot.sheet_mm[0]).toBeGreaterThan(plain.plot.sheet_mm[0]);
  });

  it("plots a paragraph on the lines its rectangle leaves it, on a sheet that is not widened for one long line", async () => {
    const NOTE = "Evacuation des eaux usees vers la colonne EU 100 en fonte";
    const plotted = async (...pairs: [number, number][]) => {
      const note = rec("MTEXT", [8, "T"], [10, 19000], [20, 5000], [40, 100], ...pairs, [71, 1], [1, NOTE]);
      const plot = await plotCadDrawing(read({ entities: [room(20000, 10000), note] }), { denominator: 50 });
      const written = Array.from((await contentOf(plot.bytes)).content.matchAll(/<([0-9A-F]+)> Tj/g), (match) => Buffer.from(match[1], "hex").toString("latin1"));
      // The stamp of the sheet is written too: only the lines of the note are looked at.
      return { plot, lines: written.filter((line) => NOTE.includes(line)) };
    };
    const whole = await plotted(), wrapped = await plotted([41, 1100]);
    expect(whole.lines).toEqual([NOTE]);
    // Eleven capital heights: two or three words a line, each line a text of the PDF.
    expect(wrapped.lines).toEqual(["Evacuation des", "eaux usees vers", "la colonne EU", "100 en fonte"]);
    expect(wrapped.plot.texts).toBe(4);
    // The note starts 1 m before the wall: whole, it runs past it by several metres.
    expect(whole.plot.sheet_mm[0] - wrapped.plot.sheet_mm[0]).toBeGreaterThan(40);
  });

  it("caps the texts and the size of the file", async () => {
    const drawing = read({ entities: [room(5000, 5000), text("T", 0, 0, 100, "a"), text("T", 0, 500, 100, "b"), text("T", 0, 1000, 100, "c")] });
    expect(await plotCadDrawing(drawing, { limits: { maxTexts: 2 } })).toMatchObject({ texts: 2, omitted: { texts: 1 } });
    expect(await reason(plotCadDrawing(drawing, { limits: { maxBytes: 200 } }))).toBe("too_large");
  });

  it("writes the same file twice, with the title given", async () => {
    const first = await plotCadDrawing(read(plan), { title: "Plan R+1" });
    const second = await plotCadDrawing(read(plan), { title: "Plan R+1" });
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect((await contentOf(first.bytes)).doc.getTitle()).toBe("Plan R+1");
  });
});

describe("plotCadDrawing: read back by the métré", () => {
  const metres = (lengthPt: number, denominator: number) => (lengthPt * MM_PER_POINT * denominator) / 1000;

  it("is a layered plan whose scale the format confirms and whose lengths are the drawing's", SPAWN, async () => {
    const drawing = read(plan);
    const plot = await plotCadDrawing(drawing);
    const extraction = await extractVectorPage(plot.bytes, 1);
    expect(extraction.texts.map((entry) => entry.str)).toEqual(["Échelle 1/20", "Format 520x332", "Sdb Ø32 ? EF"]);
    expect(extraction.layers.map((entry) => entry.name).sort()).toEqual(["EF", "EU", "MURS", "TEXTE"]);

    const reading = readVectorPage(extraction);
    expect(reading.mode).toBe("layers");
    expect(reading.scale).toMatchObject({ status: "format", denominator: 20, format: { page_mm: [520, 332], matches: true } });

    const quantities = measureCadDrawing(drawing);
    const lengthOf = (name: string) => reading.groups.filter((group) => group.layerName === name).reduce((sum, group) => sum + group.length_pt, 0);
    for (const row of quantities.layers) {
      const expected = row.length + row.blockLength;
      expect(Math.abs(metres(lengthOf(row.name), 20) - expected), row.name).toBeLessThan(expected * 1e-3);
    }
    expect(quantities.layers.map((row) => row.name)).toEqual(["EF", "EU", "MURS"]);
    expect(reading.groups.filter((group) => group.layerName === "EF").map((group) => [group.class, group.colors])).toEqual([["EF", ["#0000ff"]]]);
    const network = (reading.networks?.totals ?? []).filter((total) => total.network === "EF").reduce((sum, total) => sum + (total.length_m ?? 0), 0);
    expect(network).toBeCloseTo(12.3, 1);
  });

  it("keeps the scale the drawing announces readable", SPAWN, async () => {
    const drawing = read({ entities: [room(20000, 10000), line("EF", 0, 5000, 20000, 5000), text("TEXTE", 0, -500, 150, "Echelle : 1/100"), text("TEXTE", 0, -900, 150, "Format A1")] });
    const plot = await plotCadDrawing(drawing);
    const reading = readVectorPage(await extractVectorPage(plot.bytes, 1));
    expect(reading.scale).toMatchObject({ status: "format", denominator: 100 });
    expect(reading.scale.format.page_mm).toEqual(plot.sheet_mm);
  });
});

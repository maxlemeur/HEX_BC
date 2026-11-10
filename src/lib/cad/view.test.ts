import { describe, expect, it } from "vitest";

import { readDxf } from "@/lib/cad/dxf";
import { circle, dxfBytes, hatch, insert, layer, line, lwpolyline, rec, text, type DxfFixture } from "@/lib/cad/dxf.test-utils";
import {
  buildCadScene, cadDisplayColor, cadPointAt, cadSceneExtents, cadViewLimits, drawCadView, fitCadViewport, panCadViewport, zoomCadViewport,
  type CadViewContext, type CadViewport,
} from "@/lib/cad/view";

const read = (fixture: DxfFixture) => readDxf(dxfBytes(fixture));
const SIZE = { width: 400, height: 300 };
/** A sheet of 1 000 × 750 units seen whole: 0,4 pixel per unit, (0, 750) at the top left corner. */
const VIEW: CadViewport = { scale: 0.4, x: 0, y: 750 };

type Call = (string | number)[];
const round = (value: number) => Math.round(value * 1000) / 1000;

/** A canvas context that writes down what it is asked, with the style in force at that moment. */
function recorder() {
  const calls: Call[] = [];
  const ctx: CadViewContext = {
    strokeStyle: "", fillStyle: "", lineWidth: 0, lineJoin: "miter", lineCap: "butt", globalAlpha: 1, font: "", textAlign: "start", textBaseline: "top",
    beginPath: () => { calls.push(["beginPath"]); },
    moveTo: (x, y) => { calls.push(["moveTo", round(x), round(y)]); },
    lineTo: (x, y) => { calls.push(["lineTo", round(x), round(y)]); },
    closePath: () => { calls.push(["closePath"]); },
    stroke: () => { calls.push(["stroke", String(ctx.strokeStyle), ctx.lineWidth]); },
    fill: (rule) => { calls.push(["fill", String(ctx.fillStyle), rule ?? "nonzero", ctx.globalAlpha]); },
    fillRect: (x, y, width, height) => { calls.push(["fillRect", x, y, width, height, String(ctx.fillStyle), ctx.globalAlpha]); },
    fillText: (value, x, y) => { calls.push(["fillText", value, round(x), round(y), String(ctx.fillStyle), ctx.font, ctx.textAlign, ctx.textBaseline]); },
    save: () => { calls.push(["save"]); },
    restore: () => { calls.push(["restore"]); },
    translate: (x, y) => { calls.push(["translate", round(x), round(y)]); },
    rotate: (angle) => { calls.push(["rotate", round(angle)]); },
  };
  return { ctx, calls, named: (...names: string[]) => calls.filter((call) => names.includes(call[0] as string)) };
}

function draw(fixture: DxfFixture, options: { viewport?: CadViewport; shown?: boolean[]; maxTexts?: number } = {}) {
  const drawing = read(fixture), record = recorder();
  const stats = drawCadView(record.ctx, buildCadScene(drawing), options.viewport ?? VIEW, { ...SIZE, shown: options.shown, maxTexts: options.maxTexts });
  return { ...record, stats, drawing };
}

describe("viewport", () => {
  it("fits the drawing in the canvas, centred, y up", () => {
    const fit = fitCadViewport({ x0: 0, y0: 0, x1: 1000, y1: 500 }, 400, 300, 0);
    expect(fit.scale).toBeCloseTo(0.4, 12);
    expect(fit.x).toBeCloseTo(0, 9);
    expect(fit.y).toBeCloseTo(625, 9);
    expect(cadPointAt(fit, 0, 250).map(round)).toEqual([0, 0]);
    expect(cadPointAt(fit, 400, 50).map(round)).toEqual([1000, 500]);
  });

  it("leaves the padding around the drawing", () => {
    const fit = fitCadViewport({ x0: 0, y0: 0, x1: 1000, y1: 500 }, 400, 300, 20);
    expect(fit.scale).toBeCloseTo(0.36, 12);
    expect(cadPointAt(fit, 20, 150).map(round)).toEqual([0, 250]);
  });

  it.each([
    ["a vertical line", { x0: 5, y0: 0, x1: 5, y1: 100 }, 3],
    ["a single point", { x0: 5, y0: 7, x1: 5, y1: 7 }, 1],
  ])("stays finite for %s", (_name, extents, scale) => {
    const fit = fitCadViewport(extents, 400, 300, 0);
    expect(fit.scale).toBeCloseTo(scale, 12);
    expect(cadPointAt(fit, 200, 150).map(round)).toEqual([5, (extents.y0 + extents.y1) / 2]);
  });

  it("gives a usable view of an empty drawing and of a canvas without size", () => {
    expect(fitCadViewport(null, 400, 300)).toEqual({ scale: 1, x: -200, y: 150 });
    const fit = fitCadViewport({ x0: 0, y0: 0, x1: 1000, y1: 500 }, 0, 0);
    expect(Number.isFinite(fit.scale) && fit.scale > 0 && Number.isFinite(fit.x) && Number.isFinite(fit.y)).toBe(true);
  });

  it("zooms around the cursor and stops at its limits", () => {
    const limits = cadViewLimits(VIEW);
    expect(limits.min).toBeLessThan(VIEW.scale);
    expect(limits.max).toBeGreaterThan(VIEW.scale * 1000);
    const before = cadPointAt(VIEW, 120, 80), closer = zoomCadViewport(VIEW, 2.5, 120, 80, limits);
    expect(closer.scale).toBeCloseTo(1, 12);
    expect(cadPointAt(closer, 120, 80).map(round)).toEqual(before.map(round));
    expect(zoomCadViewport(VIEW, 1e9, 120, 80, limits).scale).toBe(limits.max);
    expect(zoomCadViewport(VIEW, 1e-9, 120, 80, limits).scale).toBe(limits.min);
    expect(cadPointAt(zoomCadViewport(VIEW, 1e9, 120, 80, limits), 120, 80).map(round)).toEqual(before.map(round));
    expect(zoomCadViewport(VIEW, Number.NaN, 120, 80, limits)).toEqual(VIEW);
    expect(zoomCadViewport(VIEW, 0, 120, 80, limits)).toEqual(VIEW);
  });

  it("pans with the pointer", () => {
    const before = cadPointAt(VIEW, 100, 100), moved = panCadViewport(VIEW, 30, -12);
    expect(moved.scale).toBe(VIEW.scale);
    expect(cadPointAt(moved, 130, 88).map(round)).toEqual(before.map(round));
  });
});

describe("buildCadScene", () => {
  it("boxes each path and draws the fills first, then the tracé colour by colour", () => {
    const drawing = read({
      layers: [layer("EU", 1), layer("EF", 5), layer("H", 8)],
      entities: [line("EU", 0, 0, 1000, 500), hatch("H", [[0, 0], [10, 0], [10, 10], [0, 10]]), line("EF", 5, 50, -5, 20), line("EU", 0, 0, 1, 1)],
    });
    const scene = buildCadScene(drawing);
    expect([...scene.boxes.slice(0, 4)]).toEqual([0, 0, 1000, 500]);
    expect([...scene.boxes.slice(8, 12)]).toEqual([-5, 20, 5, 50]);
    expect(scene.fills).toBe(1);
    // Blue (0x0000ff) comes before red (0xff0000); paths of one colour keep the order of the file.
    expect([...scene.order]).toEqual([1, 2, 0, 3]);
  });

  it("gives a hatch the box of all its loops, whichever comes first", () => {
    const drawing = read({ entities: [hatch("H", [[100, 100], [300, 100], [300, 300], [100, 300]], [[0, 0], [400, 0], [400, 400], [0, 400]])] });
    const scene = buildCadScene(drawing);
    expect(scene.fills).toBe(2);
    expect([...scene.boxes.slice(0, 4)]).toEqual([0, 0, 400, 400]);
  });

  it("measures what is shown, so that the view fits it", () => {
    const drawing = read({
      layers: [layer("EF", 5), rec("LAYER", [2, "LOIN"], [70, 1], [62, 1])],
      entities: [line("EF", 0, 0, 1000, 500), line("LOIN", 900000, 0, 900100, 0), text("EF", 1200, 100, 50, "DN 100")],
    });
    const scene = buildCadScene(drawing);
    const shown = cadSceneExtents(scene);
    expect(shown).toMatchObject({ x0: 0, y0: 0 });
    expect(shown?.x1).toBeGreaterThanOrEqual(1200);
    expect(shown?.x1).toBeLessThan(5000);
    expect(cadSceneExtents(scene, [false, false, true])).toEqual({ x0: 900000, y0: 0, x1: 900100, y1: 0 });
    expect(cadSceneExtents(scene, [false, false, false])).toBeNull();
  });

  it("leaves out of the view what a nested reference draws when the layer of that reference is hidden", () => {
    const drawing = read({
      layers: [layer("A"), layer("B"), layer("C")],
      blocks: [{ name: "INNER", entities: [line("C", 0, 0, 9000, 0)] }, { name: "OUTER", entities: [insert("B", "INNER", 0, 0), line("C", 0, 0, 1000, 0)] }],
      entities: [insert("A", "OUTER", 0, 0)],
    });
    const scene = buildCadScene(drawing);
    expect(cadSceneExtents(scene)).toEqual({ x0: 0, y0: 0, x1: 9000, y1: 0 });
    expect(cadSceneExtents(scene, drawing.layers.map((entry) => entry.name !== "B"))).toEqual({ x0: 0, y0: 0, x1: 1000, y1: 0 });
    const { ctx, calls } = recorder();
    drawCadView(ctx, scene, { scale: 0.04, x: 0, y: 150 }, { ...SIZE, shown: drawing.layers.map((entry) => entry.name !== "B") });
    expect(calls.filter((call) => call[0] === "lineTo")).toEqual([["lineTo", 40, 6]]);
  });
});

describe("cadDisplayColor", () => {
  it("draws white as ink and darkens what a white sheet would wash out", () => {
    expect(cadDisplayColor(0xffffff)).toBe("#1a1a1a");
    expect(cadDisplayColor(0xff0000)).toBe("#ff0000");
    expect(cadDisplayColor(0x0000ff)).toBe("#0000ff");
    expect(cadDisplayColor(0x000000)).toBe("#000000");
    const yellow = /^#([0-9a-f]{2})([0-9a-f]{2})00$/.exec(cadDisplayColor(0xffff00));
    expect(yellow?.[1]).toBe(yellow?.[2]);
    expect(Number.parseInt(yellow?.[1] ?? "ff", 16)).toBeLessThan(140);
    expect(Number.parseInt(yellow?.[1] ?? "00", 16)).toBeGreaterThan(100);
  });
});

describe("drawCadView", () => {
  it("clears the sheet, then draws a line where the viewport puts it, in the colour of its layer", () => {
    const { calls, named, stats } = draw({ layers: [layer("EF", 5)], entities: [line("EF", 0, 0, 1000, 500)] });
    expect(calls[0]).toEqual(["fillRect", 0, 0, 400, 300, "#ffffff", 1]);
    expect(named("beginPath", "moveTo", "lineTo", "closePath", "stroke")).toEqual([["beginPath"], ["moveTo", 0, 300], ["lineTo", 400, 100], ["stroke", "#0000ff", 1]]);
    expect(stats).toEqual({ paths: 1, texts: 0, textsOverLimit: 0 });
  });

  it("closes a closed outline", () => {
    const { named } = draw({ entities: [lwpolyline("0", [[0, 0], [100, 0], [100, 100]], true)] });
    expect(named("moveTo", "lineTo", "closePath", "stroke")).toEqual([["moveTo", 0, 300], ["lineTo", 40, 300], ["lineTo", 40, 260], ["closePath"], ["stroke", "#1a1a1a", 1]]);
  });

  it("strokes all the paths of a colour at once", () => {
    const { named } = draw({
      layers: [layer("EF", 5), layer("EU", 1)],
      entities: [line("EF", 0, 0, 100, 0), line("EU", 0, 100, 100, 100), line("EF", 0, 200, 100, 200), line("EF", 0, 300, 100, 300)],
    });
    expect(named("beginPath", "stroke")).toEqual([["beginPath"], ["stroke", "#0000ff", 1], ["beginPath"], ["stroke", "#ff0000", 1]]);
    expect(named("moveTo")).toHaveLength(4);
  });

  it("draws the layers the file shows, or the ones asked for", () => {
    const fixture: DxfFixture = {
      layers: [layer("EF", 5), rec("LAYER", [2, "GELE"], [70, 1], [62, 1])],
      entities: [line("EF", 0, 0, 100, 0), line("GELE", 0, 100, 100, 100)],
    };
    expect(draw(fixture).named("stroke")).toEqual([["stroke", "#0000ff", 1]]);
    expect(draw(fixture, { shown: [true, false, true] }).named("stroke")).toEqual([["stroke", "#ff0000", 1]]);
    expect(draw(fixture, { shown: [true, false, false] }).stats.paths).toBe(0);
  });

  it("hides a block with the layer of its reference", () => {
    const fixture: DxfFixture = {
      layers: [layer("EF", 5), layer("BLOCS", 3)],
      blocks: [{ name: "Vanne", entities: [line("EF", 0, 0, 50, 0)] }],
      entities: [insert("BLOCS", "Vanne", 100, 100)],
    };
    expect(draw(fixture).stats.paths).toBe(1);
    expect(draw(fixture, { shown: [true, true, false] }).stats.paths).toBe(0);
    expect(draw(fixture, { shown: [true, false, true] }).stats.paths).toBe(0);
  });

  it("sends nothing of what lies outside the canvas", () => {
    const { named, stats } = draw({ entities: [line("0", 0, 0, 100, 100), line("0", 5000, 0, 5100, 100), line("0", 0, -900, 100, -800), line("0", -100, 700, 2000, 720)] });
    expect(named("moveTo")).toEqual([["moveTo", 0, 300], ["moveTo", -40, 20]]);
    expect(stats.paths).toBe(2);
  });

  it("draws a mark for a path of about a pixel and nothing below", () => {
    const { named, stats } = draw({ entities: [circle("0", 500, 500, 1.5), circle("0", 700, 500, 0.25)] });
    expect(named("moveTo", "lineTo", "closePath")).toEqual([["moveTo", 199.4, 100.6], ["lineTo", 200.6, 99.4]]);
    expect(stats.paths).toBe(1);
  });

  it("drops the points the screen cannot tell apart, never the last one", () => {
    const vertices = Array.from({ length: 2001 }, (_, index): [number, number] => [index * 0.05, 100]);
    const { named } = draw({ entities: [lwpolyline("0", vertices)] });
    const lines = named("lineTo");
    expect(lines.length).toBeLessThan(200);
    expect(lines.length).toBeGreaterThan(50);
    expect(lines[lines.length - 1]).toEqual(["lineTo", 40, 260]);
  });

  it("fills a hatch under the tracé, its holes left empty, without stroking its outline", () => {
    const { calls } = draw({
      layers: [layer("EF", 5), layer("H", 1)],
      entities: [line("EF", 0, 0, 100, 0), hatch("H", [[0, 0], [400, 0], [400, 400], [0, 400]], [[100, 100], [300, 100], [300, 300], [100, 300]])],
    });
    expect(calls.slice(1).filter((call) => call[0] !== "moveTo" && call[0] !== "lineTo")).toEqual([
      ["beginPath"], ["closePath"], ["closePath"], ["fill", "#ff0000", "evenodd", 0.45],
      ["beginPath"], ["stroke", "#0000ff", 1],
    ]);
    expect(calls.filter((call) => call[0] === "moveTo").slice(0, 2)).toEqual([["moveTo", 0, 300], ["moveTo", 40, 260]]);
  });

  it("fills each hatch on its own: two that overlap do not cancel out", () => {
    const square = (x: number): [number, number][] => [[x, 0], [x + 200, 0], [x + 200, 200], [x, 200]];
    const { named } = draw({ entities: [hatch("H", square(0)), hatch("H", square(100))] });
    expect(named("beginPath", "fill")).toEqual([["beginPath"], ["fill", "#1a1a1a", "evenodd", 0.45], ["beginPath"], ["fill", "#1a1a1a", "evenodd", 0.45]]);
  });

  it("tints a patterned hatch lightly and fills a solid plainly", () => {
    const pattern = rec("HATCH", [8, "H"], [10, 0], [20, 0], [30, 0], [2, "ANSI31"], [70, 0], [71, 0], [91, 1],
      [92, 2], [72, 0], [73, 1], [93, 3], [10, 0], [20, 0], [10, 200], [20, 0], [10, 0], [20, 200], [97, 0], [75, 0], [76, 1], [98, 0]);
    const solid = rec("SOLID", [8, "H"], [10, 500], [20, 0], [11, 600], [21, 0], [12, 500], [22, 100], [13, 600], [23, 100]);
    const { named } = draw({ layers: [layer("H", 1)], entities: [pattern, solid] });
    expect(named("fill", "stroke")).toEqual([["fill", "#ff0000", "evenodd", 0.14], ["fill", "#ff0000", "evenodd", 1]]);
  });

  it("writes the texts tall enough to be read, where the drawing anchors them", () => {
    const { named, stats, calls } = draw({
      layers: [layer("TXT", 5)],
      entities: [text("TXT", 100, 100, 50, "DN 100"), text("TXT", 100, 300, 5, "trop petit")],
    });
    expect(named("fillText")).toEqual([["fillText", "DN 100", 40, 260, "#0000ff", "28px Helvetica, Arial, sans-serif", "left", "alphabetic"]]);
    expect(stats).toEqual({ paths: 0, texts: 1, textsOverLimit: 0 });
    expect(calls.some((call) => call[0] === "rotate")).toBe(false);
  });

  it("turns a text with its angle", () => {
    const { named } = draw({ entities: [text("0", 100, 100, 50, "Colonne", [50, 90])] });
    expect(named("save", "translate", "rotate", "fillText", "restore").map((call) => call.slice(0, 4))).toEqual([
      ["save"], ["translate", 40, 260], ["rotate", round(-Math.PI / 2)], ["fillText", "Colonne", 0, 0], ["restore"],
    ]);
  });

  it("stacks the lines of a paragraph below its anchor", () => {
    const { named, drawing } = draw({ entities: [rec("MTEXT", [8, "0"], [10, 100], [20, 500], [30, 0], [40, 30], [71, 1], [1, "Gaine\\PEU"])] });
    expect(drawing.texts[0]).toMatchObject({ text: "Gaine\nEU", baseline: 3, height: 30 });
    // Top of the capitals at the anchor (y = 100 on screen): baselines 12 px below, then every 20 px.
    expect(named("fillText").map((call) => call.slice(0, 4))).toEqual([["fillText", "Gaine", 40, 112], ["fillText", "EU", 40, 132]]);
  });

  it("centres and right-aligns on the anchor", () => {
    const { named } = draw({ entities: [text("0", 0, 0, 50, "Axe", [72, 1], [11, 500], [21, 100]), text("0", 0, 0, 50, "Fin", [72, 2], [11, 800], [21, 100])] });
    expect(named("fillText").map((call) => [call[1], call[2], call[3], call[6]])).toEqual([["Axe", 200, 260, "center"], ["Fin", 320, 260, "right"]]);
  });

  it("stops at the number of texts it is allowed and says how many are left", () => {
    const { named, stats } = draw({ entities: [text("0", 0, 0, 50, "A"), text("0", 0, 100, 50, "B"), text("0", 0, 200, 50, "C")] }, { maxTexts: 2 });
    expect(named("fillText")).toHaveLength(2);
    expect(stats).toEqual({ paths: 0, texts: 2, textsOverLimit: 1 });
  });

  it("leaves out the texts outside the canvas", () => {
    const { named } = draw({ entities: [text("0", 100, 100, 50, "Ici"), text("0", 9000, 100, 50, "Ailleurs"), text("0", 100, -4000, 50, "Plus bas")] });
    expect(named("fillText").map((call) => call[1])).toEqual(["Ici"]);
  });
});

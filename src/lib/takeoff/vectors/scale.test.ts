import { describe, expect, it } from "vitest";

import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { SegmentIndex, type Point, type Segment } from "@/lib/takeoff/vectors/geometry";
import { findCotes, parseCote, readPageScale, type PageCalibration } from "@/lib/takeoff/vectors/scale";

// Ways the page scale could mislead every length of a plan, written before the
// fixtures (TI-662 step 2):
// - Cartouche: a view scale (« 1 : 25 » beside a section title) taken as the
//   page scale while an « Echelle » label names 1/50; two labelled scales that
//   differ, in two texts or in one cartouche cell (« ECHELLES : 1/50 - 1/20 »),
//   resolved to one of them instead of « ambiguous_scale »; two unlabelled
//   values resolved to one; a date « 06/01/2026 », « 06/01/25 » or
//   « 1/10/2026 », a time « 11:50 » or a reference « 1/2026 » read as a scale,
//   or making a labelled 1/50 ambiguous.
// - Cote value: « 5,00 » not in metres, « 4500 » not in millimetres, « 450 cm »
//   not in centimetres; the rounding unit not taken from the decimals (« 1,5 »
//   and « 1,50 » given the same tolerance); a date, a scale or a DN read as a
//   number.
// - Cote detection: a framed number read as a cote (the frame's corners are
//   joints, not crossings); a line with a tick at one end only accepted; a
//   number over a short cross-hatch stroke or over a table rule crossed by the
//   column borders accepted; a candidate drawn more than 4 times, or less than a
//   quarter of, its value accepted, or a print reduction of A0 on A3 (within
//   that ratio) dropped instead of reported inconsistent; a vertical cote with
//   its text turned a quarter left not found, or its text centre put on the
//   wrong side so that a parallel wall line takes the cote's place.
// - Tolerance max(2 %, half the rounding unit): either term ignored, or the
//   exact bound rejected.
// - Status: a consistent cote not giving « verified » with the cartouche
//   denominator; an inconsistent cote (alone or beside a consistent one) not
//   giving « unverified / dimension_mismatch » with a null denominator and the
//   cotes listed; without cote, an A0 page (landscape or portrait, « A0 » or
//   « 1398x841ht » by « Format ») not giving « format », a different or unknown
//   format giving a denominator; no scale not giving « no_scale ».
// - A dimension line running past its ticks (CAD extension of 1.25 mm on each
//   side) measured end to end instead of between its ticks, so a true cote
//   reads long and blocks the page; a sheet number (« Page 1/2 »,
//   « Planche 1/5 ») taken as an unlabelled scale.
// - Calibration: {denominator} or {from, to, distance_m} not lifting an
//   ambiguous or absent cartouche, the distance read along one axis only, or an
//   empty calibration (from = to) giving an infinite denominator.

const PT_PER_MM = 72 / 25.4;
const A0_LANDSCAPE = { width: 3370.39, height: 2383.94 }; // 1189 x 841 mm
const A0_PORTRAIT = { width: 2383.94, height: 3370.39 };
const H = 8; // text height in points (2.8 mm)

type Sheet = { width: number; height: number; texts: VectorText[]; segments: Segment[] };

function sheet(size: { width: number; height: number } = A0_LANDSCAPE): Sheet {
  return { ...size, texts: [], segments: [] };
}

function text(target: Sheet, str: string, x: number, y: number, height = H): VectorText {
  const entry = { str, x, y, width: str.length * 0.6 * height, height, angle: 0 };
  target.texts.push(entry);
  return entry;
}

/** A value right after a label on its baseline, as a cartouche cell. */
function after(target: Sheet, label: VectorText, str: string) {
  return text(target, str, label.x + label.width + 4, label.y);
}

function cartouche(target: Sheet, cells: { scale?: string; format?: string }) {
  const x = target.width - 370, y = target.height - 80;
  if (cells.scale) after(target, text(target, "Echelle :", x, y), cells.scale);
  if (cells.format) after(target, text(target, "Format", x, y + 40), cells.format);
}

/** Sheet points of a site length drawn at 1/denominator. */
function sheetPoints(metres: number, denominator: number) {
  return ((metres * 1000) / denominator) * PT_PER_MM;
}

/** A 45° stroke 8.5 pt long whose middle is the point. */
function tick({ x, y }: Point): Segment {
  return { x0: x - 3, y0: y + 3, x1: x + 3, y1: y - 3 };
}

/** A horizontal cote line of `drawn_m` at 1/denominator, a tick crossing each end, the text centred 2 pt above. */
function horizontalCote(target: Sheet, str: string, drawn_m: number, origin: Point, options: { denominator?: number; ticks?: "both" | "start" } = {}) {
  const length = sheetPoints(drawn_m, options.denominator ?? 50);
  const start = origin, end = { x: origin.x + length, y: origin.y };
  target.segments.push({ x0: start.x, y0: start.y, x1: end.x, y1: end.y }, tick(start));
  if ((options.ticks ?? "both") === "both") target.segments.push(tick(end));
  const entry = text(target, str, 0, origin.y - 2);
  entry.x = origin.x + length / 2 - entry.width / 2;
}

function read(target: Sheet, calibration?: PageCalibration) {
  return readPageScale({ texts: target.texts, index: new SegmentIndex(target.segments, target.width), width: target.width, height: target.height, calibration });
}

function cotesOf(target: Sheet, denominator = 50) {
  return findCotes(target.texts, new SegmentIndex(target.segments, target.width), denominator);
}

describe("parseCote", () => {
  it.each([
    ["5,00", 5, 0.01],
    ["5.00", 5, 0.01],
    ["1,5", 1.5, 0.1],
    ["5 m", 5, 1],
    ["4500", 4.5, 0.001],
    ["4500 mm", 4.5, 0.001],
    ["450 cm", 4.5, 0.01],
    ["450cm", 4.5, 0.01],
    ["12,5 cm", 0.125, 0.001],
  ])("reads « %s » as %s m with a rounding unit of %s m", (str, value, unit) => {
    const parsed = parseCote(str);
    expect(parsed?.value_m).toBeCloseTo(value, 9);
    expect(parsed?.unit_m).toBeCloseTo(unit, 9);
  });

  it.each(["06/01/2026", "1/2026", "1/50", "DN 50", "A0", "0,00", "5,0000", "-5,00", ""])("reads no cote in « %s »", (str) => {
    expect(parseCote(str)).toBeNull();
  });
});

describe("cartouche scale", () => {
  it("takes the 1/50 labelled by « Echelle », not the 1 : 25 beside a section title", () => {
    const page = sheet();
    after(page, text(page, "COUPE A-A", 600, 1500), "1 : 25");
    cartouche(page, { scale: "1/50", format: "A0" });
    const scale = read(page);
    expect(scale.cartouche).toEqual({ denominator: 50, text: "1/50", labelled: true });
    expect(scale.candidates).toEqual([25, 50]);
    expect(scale).toMatchObject({ status: "format", reason: null, denominator: 50 });
  });

  it("calls two labelled scales that differ ambiguous, with no denominator", () => {
    const page = sheet();
    text(page, "COUPE A-A - Échelle 1:25", 600, 1500);
    cartouche(page, { scale: "1/50", format: "A0" });
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 });
    expect(read(page)).toMatchObject({ status: "unverified", reason: "ambiguous_scale", denominator: null, cartouche: null, candidates: [25, 50] });
  });

  it("calls a cartouche cell naming two scales ambiguous", () => {
    const page = sheet();
    text(page, "ECHELLES : 1/50 - 1/20", 3000, 2300);
    text(page, "Format A0", 3000, 2340);
    expect(read(page)).toMatchObject({ status: "unverified", reason: "ambiguous_scale", denominator: null, cartouche: null });
  });

  it("takes a single unlabelled value, and calls two unlabelled values ambiguous", () => {
    const single = sheet();
    text(single, "1/50", 3000, 2300);
    cartouche(single, { format: "A0" });
    expect(read(single)).toMatchObject({ status: "format", denominator: 50, cartouche: { denominator: 50, labelled: false } });

    const two = sheet();
    text(two, "1/50", 3000, 2300);
    text(two, "1:100", 600, 1500);
    cartouche(two, { format: "A0" });
    expect(read(two)).toMatchObject({ status: "unverified", reason: "ambiguous_scale", denominator: null, candidates: [50, 100] });
  });

  it("reads no scale in a date (« 06/01/2026 », « 06/01/25 », « 1/10/2026 »), a time or a reference « 1/2026 »", () => {
    const page = sheet();
    after(page, text(page, "Date :", 3000, 2260), "06/01/2026");
    after(page, text(page, "Réf.", 3000, 2280), "1/2026");
    text(page, "Indice B du 01/05/2026", 3000, 2220);
    text(page, "Indice A du 06/01/25 à 11:50", 3000, 2200);
    text(page, "1/10/2026", 3000, 2180);
    cartouche(page, { format: "A0" });
    expect(read(page)).toMatchObject({ status: "unverified", reason: "no_scale", denominator: null, candidates: [] });

    cartouche(page, { scale: "1/50" });
    expect(read(page)).toMatchObject({ status: "format", denominator: 50, candidates: [50] });
  });
});

describe("findCotes", () => {
  it("reads « 5,00 » in metres, « 4500 » in millimetres and « 450 cm » in centimetres", () => {
    const page = sheet();
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 });
    horizontalCote(page, "4500", 4.5, { x: 400, y: 800 });
    horizontalCote(page, "450 cm", 4.5, { x: 400, y: 1000 });
    expect(cotesOf(page)).toEqual([
      { text: "5,00", value_m: 5, measured_m: 5, deviation: 0, tolerance: 0.1, consistent: true },
      { text: "4500", value_m: 4.5, measured_m: 4.5, deviation: 0, tolerance: 0.09, consistent: true },
      { text: "450 cm", value_m: 4.5, measured_m: 4.5, deviation: 0, tolerance: 0.09, consistent: true },
    ]);
  });

  it("reads a vertical cote whose text is turned a quarter left, beside a wall line on the other side", () => {
    const page = sheet();
    const length = sheetPoints(3.2, 50), x = 900, y0 = 400, y1 = 400 + length;
    page.segments.push({ x0: x, y0, x1: x, y1 }, tick({ x, y: y0 }), tick({ x, y: y1 }), { x0: x + 12, y0: y0 - 40, x1: x + 12, y1: y1 + 40 });
    const width = 4 * 0.6 * H;
    // Reading bottom to top: the baseline starts low and its glyphs rise towards -x.
    page.texts.push({ str: "3,20", x: x - 2, y: (y0 + y1) / 2 + width / 2, width, height: H, angle: -Math.PI / 2 });
    expect(cotesOf(page)).toEqual([{ text: "3,20", value_m: 3.2, measured_m: 3.2, deviation: 0, tolerance: 0.064, consistent: true }]);
  });

  it("reads no cote in a framed number, whose corners are joints", () => {
    const frame = (target: Sheet) => {
      const x0 = 400, x1 = 400 + sheetPoints(1.5, 50), bottom = 600, top = 586;
      target.segments.push(
        { x0, y0: bottom, x1, y1: bottom }, { x0: x1, y0: bottom, x1, y1: top },
        { x0: x1, y0: top, x1: x0, y1: top }, { x0, y0: top, x1: x0, y1: bottom },
      );
      const entry = text(target, "1,50", 0, bottom - 2);
      entry.x = (x0 + x1) / 2 - entry.width / 2;
      return { x0, x1, bottom };
    };
    const framed = sheet();
    frame(framed);
    cartouche(framed, { scale: "1/50", format: "A0" });
    expect(cotesOf(framed)).toEqual([]);
    expect(read(framed)).toMatchObject({ status: "format", denominator: 50, cotes: [] });

    // Control: the same frame with a tick crossing each bottom corner is a cote.
    const ticked = sheet();
    const { x0, x1, bottom } = frame(ticked);
    ticked.segments.push(tick({ x: x0, y: bottom }), tick({ x: x1, y: bottom }));
    expect(cotesOf(ticked)).toMatchObject([{ text: "1,50", measured_m: 1.5, consistent: true }]);
  });

  it("reads no cote in a line ticked at one end only", () => {
    const page = sheet();
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 }, { ticks: "start" });
    expect(cotesOf(page)).toEqual([]);
  });

  it("reads no cote in a number over a short cross-hatch stroke", () => {
    const hatch = (length: number) => {
      const target = sheet();
      const x0 = 400, x1 = 400 + length, y = 600;
      target.segments.push({ x0, y0: y, x1, y1: y }, tick({ x: x0, y }), tick({ x: x1, y }));
      const entry = text(target, "0,20", 0, y - 2);
      entry.x = (x0 + x1) / 2 - entry.width / 2;
      return target;
    };
    // 28 pt: under 4 text heights (32 pt), though within 4 times the value at 1/50 (0.49 m for 0.20 m).
    expect(cotesOf(hatch(28))).toEqual([]);
    // Control: the same stroke at 40 pt (0.71 m) passes the length rule and is reported inconsistent.
    expect(cotesOf(hatch(40))).toMatchObject([{ text: "0,20", value_m: 0.2, measured_m: 0.7056, consistent: false }]);
  });

  it("reads no cote in the quantities of a table whose rule is crossed by the column borders", () => {
    const table = (cells: [string, string]) => {
      const target = sheet();
      const x0 = 400, x1 = 550, y = 600;
      target.segments.push(
        { x0, y0: y - 14, x1, y1: y - 14 }, { x0, y0: y, x1, y1: y }, { x0, y0: y + 14, x1, y1: y + 14 },
        { x0, y0: y - 14, x1: x0, y1: y + 14 }, { x0: 475, y0: y - 14, x1: 475, y1: y + 14 }, { x0: x1, y0: y - 14, x1, y1: y + 14 },
      );
      cells.forEach((str, column) => {
        const entry = text(target, str, 0, y - 2);
        entry.x = x0 + 37.5 + 75 * column - entry.width / 2;
      });
      return target;
    };
    expect(cotesOf(table(["12", "250"]))).toEqual([]);
    // Control: the rule (150 pt, 2.65 m at 1/50) is ticked; a plausible value over it is read.
    expect(cotesOf(table(["12", "2,65"]))).toMatchObject([{ text: "2,65", measured_m: 2.6458, consistent: true }]);
  });

  it("reads no cote drawn more than 4 times or less than a quarter of its value, and keeps an A3 print of an A0 sheet as inconsistent", () => {
    const page = sheet();
    horizontalCote(page, "20,50", 5, { x: 400, y: 600 });
    horizontalCote(page, "1,20", 5, { x: 400, y: 800 });
    expect(cotesOf(page)).toEqual([]);

    const reduced = sheet();
    horizontalCote(reduced, "5,00", 5 / Math.SQRT2 ** 3, { x: 400, y: 600 });
    expect(cotesOf(reduced)).toEqual([{ text: "5,00", value_m: 5, measured_m: 1.7678, deviation: 3.2322, tolerance: 0.1, consistent: false }]);
  });

  it.each([
    ["5,00", 5.08, 0.1, true],
    ["5,00", 5.1, 0.1, true],
    ["5,00", 5.11, 0.1, false],
    ["5,00", 4.88, 0.1, false],
    ["5 m", 5.09, 0.5, true],
    ["5 m", 5.5, 0.5, true],
    ["5 m", 5.51, 0.5, false],
    ["1,5", 1.54, 0.05, true],
    ["1,50", 1.54, 0.03, false],
  ])("tolerates the larger of 2 per cent and half the rounding unit: « %s » drawn %s m (tolerance %s m) consistent: %s", (str, drawn, tolerance, consistent) => {
    const page = sheet();
    horizontalCote(page, str, drawn, { x: 400, y: 600 });
    expect(cotesOf(page)).toMatchObject([{ text: str, measured_m: drawn, tolerance, consistent }]);
  });
});

describe("readPageScale status", () => {
  it("verifies the cartouche denominator with a consistent cote", () => {
    const page = sheet();
    cartouche(page, { scale: "1/50" });
    horizontalCote(page, "5,00", 5.03, { x: 400, y: 600 });
    expect(read(page)).toMatchObject({
      status: "verified", reason: null, denominator: 50, calibration: null,
      cotes: [{ text: "5,00", value_m: 5, measured_m: 5.03, deviation: 0.03, consistent: true }],
    });
  });

  it("leaves a page whose cartouche says 1/50 but whose drawing is at 1/100 unverified, with its cotes", () => {
    const page = sheet();
    cartouche(page, { scale: "1/50", format: "A0" });
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 }, { denominator: 100 });
    expect(read(page)).toMatchObject({
      status: "unverified", reason: "dimension_mismatch", denominator: null, cartouche: { denominator: 50 },
      cotes: [{ text: "5,00", measured_m: 2.5, consistent: false }],
    });
  });

  it("leaves a page unverified when one cote of two is inconsistent", () => {
    const page = sheet();
    cartouche(page, { scale: "1/50", format: "A0" });
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 });
    horizontalCote(page, "3,00", 3.4, { x: 400, y: 800 });
    const scale = read(page);
    expect(scale).toMatchObject({ status: "unverified", reason: "dimension_mismatch", denominator: null });
    expect(scale.cotes.map((cote) => [cote.text, cote.measured_m, cote.consistent])).toEqual([["5,00", 5, true], ["3,00", 3.4, false]]);
  });

  it.each([
    ["A0 landscape", A0_LANDSCAPE, "A0", [1189, 841]],
    ["A0 portrait", A0_PORTRAIT, "A0", [841, 1189]],
    ["1398x841ht landscape", { width: 1398 * PT_PER_MM, height: 841 * PT_PER_MM }, "1398x841ht", [1398, 841]],
    ["1398x841ht portrait", { width: 841 * PT_PER_MM, height: 1398 * PT_PER_MM }, "1398x841ht", [841, 1398]],
  ])("measures a %s page without cote by its cartouche format", (_name, size, format, pageMm) => {
    const page = sheet(size);
    cartouche(page, { scale: "1/50", format });
    expect(read(page)).toMatchObject({ status: "format", reason: null, denominator: 50, cotes: [],
      format: { cartouche: format, page_mm: pageMm, matches: true } });
  });

  it("reads a format written with its label in one text", () => {
    const page = sheet();
    cartouche(page, { scale: "1/50" });
    text(page, "FORMAT : A0", 3000, 2340);
    expect(read(page)).toMatchObject({ status: "format", denominator: 50, format: { cartouche: "FORMAT : A0", cartouche_mm: [1189, 841] } });
  });

  it("leaves a page without cote unverified when its cartouche format differs from the page", () => {
    const page = sheet();
    cartouche(page, { scale: "1/50", format: "A1" });
    expect(read(page)).toMatchObject({ status: "unverified", reason: "no_dimension_format_differs", denominator: null,
      format: { cartouche: "A1", cartouche_mm: [841, 594], page_mm: [1189, 841], matches: false } });
  });

  it("leaves a page without cote unverified when its format is unknown", () => {
    const none = sheet();
    cartouche(none, { scale: "1/50" });
    expect(read(none)).toMatchObject({ status: "unverified", reason: "no_dimension_format_unknown", denominator: null,
      format: { cartouche: null, matches: null } });

    // An « A0 » that no « Format » label names (a grid reference) is no format.
    const unlabelled = sheet();
    cartouche(unlabelled, { scale: "1/50" });
    text(unlabelled, "A0", 1200, 900);
    expect(read(unlabelled)).toMatchObject({ status: "unverified", reason: "no_dimension_format_unknown", format: { cartouche: null } });
  });

  it("leaves a page without scale unverified even with its format and a cote", () => {
    const page = sheet();
    cartouche(page, { format: "A0" });
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 });
    expect(read(page)).toMatchObject({ status: "unverified", reason: "no_scale", denominator: null, cartouche: null, candidates: [] });
  });
});

describe("readPageScale calibration", () => {
  it("lifts an ambiguous cartouche with a denominator calibration", () => {
    const page = sheet();
    text(page, "COUPE A-A - Échelle 1:25", 600, 1500);
    cartouche(page, { scale: "1/50", format: "A0" });
    horizontalCote(page, "5,00", 5, { x: 400, y: 600 });
    expect(read(page, { page: 1, denominator: 50, source: "user" })).toMatchObject({
      status: "calibrated", reason: null, denominator: 50, cartouche: null, candidates: [25, 50],
      calibration: { denominator: 50, source: "user" }, cotes: [{ text: "5,00", measured_m: 5, consistent: true }],
    });
  });

  it("derives the denominator of a two-point calibration: 100 mm on the sheet for 5 m is 1/50", () => {
    const page = sheet();
    horizontalCote(page, "2,40", 2.4, { x: 400, y: 600 });
    // 60 mm across and 80 mm down: 100 mm on the diagonal.
    const from = { x: 1000, y: 1000 }, to = { x: 1000 + 60 * PT_PER_MM, y: 1000 + 80 * PT_PER_MM };
    const scale = read(page, { page: 1, from, to, distance_m: 5, source: "user" });
    expect(scale).toMatchObject({ status: "calibrated", reason: null, cartouche: null, calibration: { denominator: 50, source: "user" },
      cotes: [{ text: "2,40", measured_m: 2.4, consistent: true }] });
    expect(scale.denominator).toBeCloseTo(50, 6);
  });

  it("ignores a calibration whose two points are the same and keeps the cartouche reading", () => {
    const page = sheet();
    cartouche(page, { scale: "1/50", format: "A0" });
    const point = { x: 1000, y: 1000 };
    expect(read(page, { page: 1, from: point, to: point, distance_m: 5, source: "user" })).toMatchObject({
      status: "format", denominator: 50, calibration: null,
    });
  });
});

describe("cote span and sheet numbers", () => {
  it("measures a cote between its ticks when the line runs past them", () => {
    const page = sheet();
    const length = sheetPoints(5, 50);
    const overrun = 1.25 * PT_PER_MM;
    const start = { x: 400, y: 600 }, end = { x: 400 + length, y: 600 };
    page.segments.push({ x0: start.x - overrun, y0: start.y, x1: end.x + overrun, y1: end.y }, tick(start), tick(end));
    const entry = text(page, "5,00", 0, start.y - 2);
    entry.x = start.x + length / 2 - entry.width / 2;
    const [cote] = cotesOf(page);
    expect(cote).toMatchObject({ text: "5,00", value_m: 5, consistent: true });
    expect(cote.measured_m).toBeCloseTo(5, 3);
  });

  it("never takes a sheet number for an unlabelled scale", () => {
    const page = sheet();
    text(page, "Page 1/2", 200, 200);
    text(page, "Planche 1/5", 200, 260);
    expect(read(page)).toMatchObject({ status: "unverified", reason: "no_scale", cartouche: null });
    text(page, "1/50", 200, 320);
    expect(read(page).cartouche).toEqual({ denominator: 50, text: "1/50", labelled: false });
  });
});

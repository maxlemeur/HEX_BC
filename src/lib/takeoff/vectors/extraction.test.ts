// Ways extractVectorPage (real child process, real pdfjs-dist, no mock) could
// misread a page, each checked below on a fictional PDF built here with pdf-lib.
// Lengths are read back through buildPageModel and converted to site metres
// with pointsToMetres, as the measure pass does.
// 1. A stroke inside q … cm … Q measured without the CTM (wrong length and
//    position, line width not scaled), or the CTM kept after Q.
// 2. A stroke inside a Form XObject measured without its /Matrix, or the colour,
//    width or cm set inside the form leaking to the strokes after Do.
// 3. /UserUnit 2 ignored (sheet size and lengths off by 2), the MediaBox origin
//    kept, or the texts left in another space than the strokes.
// 4. /Rotate 90 changing a length, width and height not swapped, strokes and
//    texts not rotated together.
// 5. Fill-only (f) and clipping (W n) paths counted as strokes, or a
//    fill-and-stroke path (B) not measured.
// 6. A Bezier curve (c) measured by its chord: a quarter circle of radius r
//    must measure pi * r / 2 within 1 %.
// 7. The closing segment of h, s or re not counted (a square of side a must
//    measure 4a), the closed flag lost, or two subpaths of one path joined by a
//    phantom segment.
// 8. Gray (G) and CMYK (K) stroke colours not read as #rrggbb, the fill colour
//    taken for the stroke colour, the line width of an ExtGState /LW (gs) or
//    its dash /D ignored in the group key, a d dash or its reset ignored, the
//    width not restored by Q.
// 9. Layers: a stroke inside /OC /oc1 BDC … EMC not attached to its OCG, a BMC
//    nested inside it popping the layer, an inner OC not winning, a stroke
//    after the EMC still attached, a Form XObject /OC ignored, a hidden OCG
//    reported visible.
// 10. Texts: an « ECHELLE 1/50 » cartouche text without its string, page-space
//     position (y down), height or width, or a text under a cm left unscaled.
// 11. An empty or oversized input, a page beyond the document or bytes that
//     are not a PDF returning a page instead of VectorExtractionError (too_large
//     or failed); a deadline not enforced (reason timeout).
// 12. A page past the text budget returned with its texts truncated instead of
//     failing as too_large, or a page at the budget refused.
// 13. Raster: a page painted by an image over its whole surface not reported
//     as covered (imageCoverage), so a scanned plan reads as vectors.
// 14. A malformed content stream (an operator with too many arguments, a Do
//     of a missing form) recovered by pdfjs and returned as a partial page; a
//     coordinate out of range returned as a page whose lengths are NaN.

import {
  degrees, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts, type PDFFont, type PDFObject, type PDFPage,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { parseHexColor } from "@/lib/takeoff/vectors/colors";
import {
  extractVectorPage, VECTOR_EXTRACTION_LIMITS, VectorExtractionError, type VectorPageExtraction,
} from "@/lib/takeoff/vectors/extraction";
import { pointsToMetres, polylineLength } from "@/lib/takeoff/vectors/geometry";
import { buildPageModel, type GroupStats } from "@/lib/takeoff/vectors/page-model";

const SPAWN = { timeout: 30_000 } as const;

async function buildPdf(build: (doc: PDFDocument) => Promise<void> | void) {
  const doc = await PDFDocument.create();
  await build(doc);
  return doc.save();
}

/** A page whose content stream is written verbatim, with its own resources. */
function addRawPage(doc: PDFDocument, size: [number, number], content: string[], resources: Record<string, PDFObject> = {}): PDFPage {
  const page = doc.addPage(size);
  page.node.set(PDFName.of("Resources"), doc.context.obj(resources));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content.join("\n"))));
  return page;
}

function fontResources(doc: PDFDocument, font: PDFFont) {
  return { Font: doc.context.obj({ F1: font.ref }) };
}

function single(groups: GroupStats[], predicate: (group: GroupStats) => boolean) {
  const found = groups.filter(predicate);
  expect(found).toHaveLength(1);
  return found[0];
}

function byColour(groups: GroupStats[], color: string) {
  return single(groups, (group) => group.colors.includes(color));
}

/** Points of every stroked subpath, in extraction order. */
function subpaths(extraction: VectorPageExtraction) {
  return extraction.paths.map((path) => Array.from({ length: path.count }, (_, index) => [
    extraction.points[2 * (path.start + index)], extraction.points[2 * (path.start + index) + 1],
  ]));
}

function expectBox(group: GroupStats, box: { x0: number; y0: number; x1: number; y1: number }) {
  expect(group.bbox.x0).toBeCloseTo(box.x0, 2);
  expect(group.bbox.y0).toBeCloseTo(box.y0, 2);
  expect(group.bbox.x1).toBeCloseTo(box.x1, 2);
  expect(group.bbox.y1).toBeCloseTo(box.y1, 2);
}

describe("extractVectorPage", () => {
  it("measures a stroke inside q … cm … Q with the CTM and drops it after Q", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [200, 200], [
        "q 2 0 0 2 10 20 cm",
        "0 0 m 36 0 l S",
        "Q",
        "0 0 m 36 0 l S",
      ]);
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    expect(extraction.counts.strokePaths).toBe(2);
    expect(groups).toHaveLength(2);
    const scaled = single(groups, (group) => group.width === 2);
    expect(scaled.length_pt).toBeCloseTo(72, 2);
    expect(pointsToMetres(scaled.length_pt, 50)).toBeCloseTo(1.27, 4);
    expectBox(scaled, { x0: 10, y0: 180, x1: 82, y1: 180 });
    const plain = single(groups, (group) => group.width === 1);
    expect(plain.length_pt).toBeCloseTo(36, 2);
    expect(pointsToMetres(plain.length_pt, 50)).toBeCloseTo(0.635, 4);
    expectBox(plain, { x0: 0, y0: 200, x1: 36, y1: 200 });
  });

  it("applies a Form XObject /Matrix over the CTM and restores the state after Do", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      const form = doc.context.register(doc.context.stream(
        ["1 0 0 RG 3 w", "0 0 m 0 25 l S", "5 0 0 5 0 0 cm"].join("\n"),
        { Type: "XObject", Subtype: "Form", BBox: [0, 0, 100, 100], Matrix: [1, 0, 0, 1, 30, 40] },
      ));
      addRawPage(doc, [200, 200], [
        "q 2 0 0 2 0 0 cm",
        "/Fm1 Do",
        "0 0 m 5 0 l S",
        "Q",
        "10 10 m 30 10 l S",
      ], { XObject: doc.context.obj({ Fm1: form }) });
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    expect(groups).toHaveLength(3);
    // Form space (0,0)-(0,25) → Matrix (30,40)-(30,65) → CTM ×2 (60,80)-(60,130) → y down.
    const inForm = byColour(groups, "#ff0000");
    expect(inForm.width).toBe(6);
    expect(inForm.length_pt).toBeCloseTo(50, 2);
    expectBox(inForm, { x0: 60, y0: 70, x1: 60, y1: 120 });
    // After Do, still inside the page's ×2: neither the form's red, 3 w nor ×5 cm.
    const afterDo = single(groups, (group) => group.colors.includes("#000000") && group.width === 2);
    expect(afterDo.length_pt).toBeCloseTo(10, 2);
    expectBox(afterDo, { x0: 0, y0: 200, x1: 10, y1: 200 });
    const afterQ = single(groups, (group) => group.colors.includes("#000000") && group.width === 1);
    expect(afterQ.length_pt).toBeCloseTo(20, 2);
    expectBox(afterQ, { x0: 10, y0: 190, x1: 30, y1: 190 });
  });

  it("applies /UserUnit 2 and the MediaBox origin to strokes and texts alike", SPAWN, async () => {
    let font: PDFFont | undefined;
    const bytes = await buildPdf(async (doc) => {
      font = await doc.embedFont(StandardFonts.Helvetica);
      const page = addRawPage(doc, [200, 100], [
        "110 110 m 182 110 l S",
        "BT /F1 10 Tf 120 150 Td (ECHELLE 1/50) Tj ET",
      ], fontResources(doc, font));
      page.setMediaBox(100, 100, 200, 100);
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    expect(extraction.userUnit).toBe(2);
    expect(extraction.width).toBeCloseTo(400, 6);
    expect(extraction.height).toBeCloseTo(200, 6);
    expect(groups).toHaveLength(1);
    expect(groups[0].width).toBe(2);
    expect(groups[0].length_pt).toBeCloseTo(144, 2);
    expect(pointsToMetres(groups[0].length_pt, 50)).toBeCloseTo(2.54, 4);
    expectBox(groups[0], { x0: 20, y0: 180, x1: 164, y1: 180 });
    expect(extraction.texts).toHaveLength(1);
    const [text] = extraction.texts;
    expect(text.str).toBe("ECHELLE 1/50");
    expect(text.x).toBeCloseTo(40, 2);
    expect(text.y).toBeCloseTo(100, 2);
    expect(text.height).toBeCloseTo(20, 2);
    expect(text.width).toBeCloseTo(2 * font!.widthOfTextAtSize("ECHELLE 1/50", 10), 1);
  });

  it("keeps lengths under /Rotate 90, swaps width and height and rotates texts with the strokes", SPAWN, async () => {
    const bytes = await buildPdf(async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = addRawPage(doc, [200, 100], [
        "10 10 m 60 10 l S",
        "BT /F1 10 Tf 20 30 Td (ECHELLE 1/50) Tj ET",
      ], fontResources(doc, font));
      page.setRotation(degrees(90));
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    expect(extraction.rotate).toBe(90);
    expect(extraction.width).toBeCloseTo(100, 6);
    expect(extraction.height).toBeCloseTo(200, 6);
    expect(groups).toHaveLength(1);
    expect(groups[0].length_pt).toBeCloseTo(50, 2);
    expect(groups[0].width).toBe(1);
    // Turned clockwise: the sheet's x runs down the page, its y to the right.
    expect(subpaths(extraction)).toEqual([[[10, 10], [10, 60]]]);
    const [text] = extraction.texts;
    expect(text.str).toBe("ECHELLE 1/50");
    expect(text.x).toBeCloseTo(30, 2);
    expect(text.y).toBeCloseTo(20, 2);
    expect(text.height).toBeCloseTo(10, 2);
    expect(text.angle).toBeCloseTo(Math.PI / 2, 3);
  });

  it("counts fill-only and clipping paths apart and measures only the stroked ones", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [200, 200], [
        "0 0 1 rg",
        "20 20 m 60 20 l 60 60 l h f",
        "q 0 0 100 100 re W n",
        "10 10 m 46 10 l S",
        "Q",
        "120 120 50 50 re B",
      ]);
    });

    const extraction = await extractVectorPage(bytes, 1);
    const model = buildPageModel(extraction);

    expect(extraction.counts.fillPaths).toBe(1);
    expect(extraction.counts.clipPaths).toBe(1);
    expect(extraction.counts.strokePaths).toBe(2);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].length_pt).toBeCloseTo(36 + 200, 2);
    expect(model.groups[0].closed).toBe(1);
    expect(model.visibleLength_pt).toBeCloseTo(236, 2);
    // Only the line and the B square: neither the filled triangle (136.57) nor the clip box (400).
    const lengths = extraction.paths.map((path) => polylineLength(extraction.points, path.start, path.count)).sort((a, b) => a - b);
    expect(lengths).toHaveLength(2);
    expect(lengths[0]).toBeCloseTo(36, 2);
    expect(lengths[1]).toBeCloseTo(200, 2);
  });

  it("measures a Bezier quarter circle along its arc, not its chord", SPAWN, async () => {
    const k = 0.5522847498;
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [300, 300], [
        `200 100 m 200 ${100 + 100 * k} ${100 + 100 * k} 200 100 200 c S`,
        `1 0 0 RG 260 250 m 260 ${250 + 10 * k} ${250 + 10 * k} 260 250 260 c S`,
      ]);
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    const large = byColour(groups, "#000000");
    expect(Math.abs(large.length_pt - (Math.PI * 100) / 2) / ((Math.PI * 100) / 2)).toBeLessThan(0.01);
    expect(pointsToMetres(large.length_pt, 50)).toBeCloseTo(pointsToMetres((Math.PI * 100) / 2, 50), 1);
    expectBox(large, { x0: 100, y0: 100, x1: 200, y1: 200 });
    const small = byColour(groups, "#ff0000");
    expect(Math.abs(small.length_pt - (Math.PI * 10) / 2) / ((Math.PI * 10) / 2)).toBeLessThan(0.01);
  });

  it("counts the closing segment of h, s and re, keeps the closed flag and never joins two subpaths", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [300, 300], [
        "1 0 0 RG 10 10 m 60 10 l 60 60 l 10 60 l h S",
        "0 1 0 RG 100 10 m 150 10 l 150 60 l 100 60 l s",
        "0 0 1 RG 200 10 50 50 re S",
        "0 0 0 RG 10 100 m 60 100 l 60 150 l 10 150 l S",
        "1 0 1 RG 10 200 m 46 200 l 100 200 m 136 200 l S",
      ]);
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    for (const color of ["#ff0000", "#00ff00", "#0000ff"]) {
      const square = byColour(groups, color);
      expect(square.length_pt).toBeCloseTo(4 * 50, 2);
      expect(pointsToMetres(square.length_pt, 100)).toBeCloseTo(7.0556, 3);
      expect(square.closed).toBe(1);
    }
    const open = byColour(groups, "#000000");
    expect(open.length_pt).toBeCloseTo(150, 2);
    expect(open.closed).toBe(0);
    const twoRuns = byColour(groups, "#ff00ff");
    expect(twoRuns.paths).toBe(2);
    expect(twoRuns.length_pt).toBeCloseTo(72, 2);
    expect(extraction.paths.filter((path) => path.closed)).toHaveLength(3);
  });

  it("reads gray and CMYK colours as #rrggbb and keys groups on ExtGState and d widths and dashes", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [300, 300], [
        "0.5 G 10 10 m 46 10 l S",
        "0 1 1 0 K 10 20 m 46 20 l S",
        "0 0 1 RG 0 1 0 rg 10 30 m 46 30 l S",
        "q /GS1 gs 10 40 m 46 40 l S Q",
        "q /GS2 gs 10 50 m 46 50 l S Q",
        "q [4 2] 1 d 10 60 m 46 60 l S [] 0 d 10 70 m 82 70 l S Q",
      ], {
        ExtGState: doc.context.obj({
          GS1: doc.context.obj({ Type: "ExtGState", LW: 3 }),
          GS2: doc.context.obj({ Type: "ExtGState", D: [[6, 3], 0] }),
        }),
      });
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    expect(groups).toHaveLength(6);
    for (const group of groups) expect(group.colors[0]).toMatch(/^#[0-9a-f]{6}$/);
    const grey = byColour(groups, "#808080");
    expect(grey.length_pt).toBeCloseTo(36, 2);
    expect(grey.grey).toBe(true);
    const cmyk = single(groups, (group) => group.colors.every((color) => !["#808080", "#0000ff"].includes(color)));
    const red = parseHexColor(cmyk.colors[0])!;
    expect(red.r).toBeGreaterThan(200);
    expect(red.g).toBeLessThan(80);
    expect(red.b).toBeLessThan(80);
    expect(cmyk.grey).toBe(false);
    const blue = (width: number, dash: string | null) => single(groups, (group) => group.colors.includes("#0000ff") && group.width === width && group.dash === dash);
    // The fill colour set after RG is not the stroke colour; the dash reset joins the plain blue group.
    expect(blue(1, null).length_pt).toBeCloseTo(36 + 72, 2);
    expect(blue(3, null).length_pt).toBeCloseTo(36, 2);
    expect(blue(1, "6,3@0").length_pt).toBeCloseTo(36, 2);
    expect(blue(1, "4,2@1").length_pt).toBeCloseTo(36, 2);
  });

  it("attaches strokes to the innermost OCG through nested BMC, inner OC and Form /OC, and none after EMC", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      const ef = doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of("EF") }));
      const eu = doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of("EU") }));
      doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: [ef, eu], D: { Order: [ef, eu], ON: [ef], OFF: [eu] } }));
      const form = doc.context.register(doc.context.stream("100 100 m 100 104 l S", {
        Type: "XObject", Subtype: "Form", BBox: [0, 0, 200, 200], OC: eu,
      }));
      addRawPage(doc, [200, 200], [
        "1 0 0 RG",
        "/OC /oc1 BDC",
        "10 10 m 82 10 l S",
        "/Span BMC",
        "10 20 m 46 20 l S",
        "EMC",
        "/OC /oc2 BDC",
        "10 30 m 28 30 l S",
        "EMC",
        "10 40 m 19 40 l S",
        "EMC",
        "10 50 m 110 50 l S",
        "/Fm1 Do",
      ], { Properties: doc.context.obj({ oc1: ef, oc2: eu }), XObject: doc.context.obj({ Fm1: form }) });
    });

    const extraction = await extractVectorPage(bytes, 1);
    const { groups } = buildPageModel(extraction);

    expect(extraction.layers.map(({ name, visible }) => ({ name, visible })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "EF", visible: true },
      { name: "EU", visible: false },
    ]);
    expect(groups).toHaveLength(3);
    const efLayer = single(groups, (group) => group.layerName === "EF");
    expect(efLayer.layer).toBe(extraction.layers.find((layer) => layer.name === "EF")!.id);
    expect(efLayer.length_pt).toBeCloseTo(72 + 36 + 9, 2);
    expect(pointsToMetres(efLayer.length_pt, 50)).toBeCloseTo(2.0638, 3);
    const euLayer = single(groups, (group) => group.layerName === "EU");
    expect(euLayer.layer).toBe(extraction.layers.find((layer) => layer.name === "EU")!.id);
    expect(euLayer.length_pt).toBeCloseTo(18 + 4, 2);
    const noLayer = single(groups, (group) => group.layer === null);
    expect(noLayer.length_pt).toBeCloseTo(100, 2);
    expect(noLayer.colors).toEqual(["#ff0000"]);
  });

  it("extracts a cartouche text with its string, page-space position, height and width, a cm included", SPAWN, async () => {
    let font: PDFFont | undefined;
    const bytes = await buildPdf(async (doc) => {
      font = await doc.embedFont(StandardFonts.Helvetica);
      addRawPage(doc, [400, 300], [
        "BT /F1 10 Tf 100 50 Td (ECHELLE 1/50) Tj ET",
        "q 0.5 0 0 0.5 200 100 cm BT /F1 20 Tf 0 0 Td (DN 50) Tj ET Q",
      ], fontResources(doc, font));
    });

    const extraction = await extractVectorPage(bytes, 1);

    expect(extraction.texts).toHaveLength(2);
    const scale = extraction.texts.find((text) => text.str === "ECHELLE 1/50");
    expect(scale).toBeDefined();
    expect(scale!.x).toBeCloseTo(100, 2);
    expect(scale!.y).toBeCloseTo(250, 2);
    expect(scale!.height).toBeCloseTo(10, 2);
    expect(scale!.angle).toBeCloseTo(0, 4);
    expect(scale!.width).toBeCloseTo(font!.widthOfTextAtSize("ECHELLE 1/50", 10), 1);
    const label = extraction.texts.find((text) => text.str === "DN 50");
    expect(label).toBeDefined();
    expect(label!.x).toBeCloseTo(200, 2);
    expect(label!.y).toBeCloseTo(200, 2);
    expect(label!.height).toBeCloseTo(10, 2);
    expect(label!.width).toBeCloseTo(font!.widthOfTextAtSize("DN 50", 10), 1);
    expect(extraction.paths).toHaveLength(0);
  });

  it("rejects an empty or oversized input as too_large before reading it", async () => {
    await expect(extractVectorPage(new Uint8Array(0), 1)).rejects.toMatchObject({ name: "VectorExtractionError", reason: "too_large" });
    const oversized = new Uint8Array(VECTOR_EXTRACTION_LIMITS.maxInputBytes + 1);
    await expect(extractVectorPage(oversized, 1)).rejects.toBeInstanceOf(VectorExtractionError);
    await expect(extractVectorPage(oversized, 1)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("fails a page beyond the document and bytes that are not a PDF, never returning a page", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [200, 200], ["10 10 m 46 10 l S"]);
    });

    const outcomes = await Promise.allSettled([
      extractVectorPage(bytes, 2),
      extractVectorPage(bytes, 0),
      extractVectorPage(new TextEncoder().encode("not a plan, only text"), 1),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(VectorExtractionError);
        expect(outcome.reason).toMatchObject({ reason: "failed" });
      }
    }
  });

  it("stops at the deadline with reason timeout on a valid PDF", SPAWN, async () => {
    const bytes = await buildPdf((doc) => {
      addRawPage(doc, [200, 200], ["10 10 m 46 10 l S"]);
    });

    await expect(extractVectorPage(bytes, 1, { timeoutMs: 1 })).rejects.toMatchObject({ name: "VectorExtractionError", reason: "timeout" });
    // The same bytes read within the default deadline: the timeout came from the deadline, not the PDF.
    const extraction = await extractVectorPage(bytes, 1);
    expect(buildPageModel(extraction).groups[0].length_pt).toBeCloseTo(36, 2);
  });

  it("reads a page at the text budget whole and fails one text past it as too_large", SPAWN, async () => {
    const textsPdf = (count: number) => buildPdf(async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const content = Array.from({ length: count }, (_, index) => `BT /F1 1 Tf ${(index % 200) * 10} ${Math.floor(index / 200) * 4 + 1} Td (a) Tj ET`);
      addRawPage(doc, [2000, 2000], content, fontResources(doc, font));
    });
    const [atBudget, pastBudget] = await Promise.all([
      textsPdf(VECTOR_EXTRACTION_LIMITS.maxTexts), textsPdf(VECTOR_EXTRACTION_LIMITS.maxTexts + 1),
    ]);

    const [whole, refused] = await Promise.allSettled([extractVectorPage(atBudget, 1), extractVectorPage(pastBudget, 1)]);

    expect(whole.status).toBe("fulfilled");
    if (whole.status === "fulfilled") expect(whole.value.texts).toHaveLength(VECTOR_EXTRACTION_LIMITS.maxTexts);
    expect(refused.status).toBe("rejected");
    if (refused.status === "rejected") expect(refused.reason).toMatchObject({ name: "VectorExtractionError", reason: "too_large" });
  });
});

describe("raster coverage", () => {
  it("reports a page covered by an image, and half of it for an image on half the page", SPAWN, async () => {
    // A 1 x 1 white PNG, stretched by the image matrix.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
    const bytes = await buildPdf(async (doc) => {
      const image = await doc.embedPng(png);
      doc.addPage([200, 100]).drawImage(image, { x: 0, y: 0, width: 200, height: 100 });
      doc.addPage([200, 100]).drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
    });
    const full = await extractVectorPage(new Uint8Array(bytes), 1);
    const half = await extractVectorPage(new Uint8Array(bytes), 2);
    expect(full.counts).toMatchObject({ images: 1 });
    expect(full.counts.imageCoverage).toBeCloseTo(1, 3);
    expect(half.counts.imageCoverage).toBeCloseTo(0.5, 3);
  });
});

/** A one-page PDF written byte by byte, so that its content may be malformed. */
function rawPdf(content: string, extra: string[] = [], resources = "<< >>") {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources ${resources} >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, ...extra,
  ];
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

describe("malformed pages", () => {
  it("fails a page whose content pdfjs would only read in part, and a page with out-of-range coordinates", SPAWN, async () => {
    const control = await extractVectorPage(rawPdf("0 0 m 100 0 l S\n0 50 m 100 50 l S\n0 90 m 100 90 l S"), 1);
    expect(control.counts.strokePaths).toBe(3);
    const many = Array.from({ length: 34 }, (_, index) => String(index)).join(" ");
    for (const bytes of [
      rawPdf(`0 0 m 100 0 l S\n${many} w\n0 50 m 100 50 l S`),
      rawPdf("0 0 m 100 0 l S\n/Fm1 Do\n0 90 m 100 90 l S", [], "<< /XObject << /Fm1 99 0 R >> >>"),
      rawPdf("1000000000000 0 0 1000000000000 0 0 cm\n0 0 m 100 0 l S"),
    ]) {
      await expect(extractVectorPage(bytes, 1)).rejects.toMatchObject({ name: "VectorExtractionError", reason: "failed" });
    }
  });
});

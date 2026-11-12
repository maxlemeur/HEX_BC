import { loadImage, createCanvas } from "@napi-rs/canvas";
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  type PDFRef,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { extractVectorPage } from "@/lib/takeoff/vectors/extraction";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";

// Ways the page crop of renderPdfPages (TI-662 L3c: the legend extract sent to
// Decisions, cut in the page space of the vector extraction) could show
// another part of the page, written before the code. Real child process, real
// pdfjs and canvas, a fictional PDF built here with pdf-lib.
// - the crop is ignored and the whole page is rendered (wrong size, the red
//   legend sample lost in a thumbnail);
// - the offset has the wrong sign or the PDF's y-up axis, so the crop shows
//   another corner of the page (the blue square instead of the red one);
// - on a page turned by /Rotate 90 the crop is applied before the rotation,
//   so the page-space box of the extraction misses what it names;
// - a small crop is not enlarged up to its maximum scale (an unreadable
//   legend), or is enlarged past it;
// - without a crop the thumbnail changes (its historical behaviour).

const SPAWN = { timeout: 60_000 } as const;

async function twoSquares(rotate: number) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  page.setRotation(degrees(rotate));
  // PDF space, y up: red square stroked at x 100-200, y 250-350; blue at x 400-500, y 50-150.
  page.drawRectangle({ x: 100, y: 250, width: 100, height: 100, color: rgb(1, 0, 0), borderColor: rgb(1, 0, 0), borderWidth: 2 });
  page.drawRectangle({ x: 400, y: 50, width: 100, height: 100, color: rgb(0, 0, 1), borderColor: rgb(0, 0, 1), borderWidth: 2 });
  return doc.save();
}

async function pixel(data: string, x: number, y: number) {
  const image = await loadImage(Buffer.from(data, "base64"));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const [r, g, b] = context.getImageData(x, y, 1, 1).data;
  return { r, g, b, width: image.width, height: image.height };
}

describe("page crop of renderPdfPages", () => {
  for (const rotate of [0, 90]) {
    it(`renders the page-space box the extraction gives the red square (rotate ${rotate}), enlarged up to its maximum scale`, SPAWN, async () => {
      const bytes = await twoSquares(rotate);
      const model = buildPageModel(await extractVectorPage(bytes, 1));
      const red = model.groups.find((group) => group.key.color === "#ff0000");
      if (!red) throw new Error("red square not extracted");
      const crop = { x0: red.bbox.x0 - 10, y0: red.bbox.y0 - 10, x1: red.bbox.x1 + 10, y1: red.bbox.y1 + 10 };
      const result = await renderPdfPages(bytes, { pages: [1], image: { mode: "each", maxEdgePx: 1600, crop, maxScale: 4 } });
      expect(result.status).toBe("complete");
      const image = result.pages[0].image;
      if (!image) throw new Error(`no image: ${result.pages[0].imageIssue}`);
      // 120 pt square at the maximum scale of 4.
      expect([image.width, image.height]).toEqual([480, 480]);
      const centre = await pixel(image.data, 240, 240);
      expect(centre.r).toBeGreaterThan(200);
      expect(centre.b).toBeLessThan(80);
      const corner = await pixel(image.data, 5, 5);
      expect(Math.min(corner.r, corner.g, corner.b)).toBeGreaterThan(230);
    });
  }

  it("fits a large crop within the maximum edge, and keeps the whole-page thumbnail without a crop", SPAWN, async () => {
    const bytes = await twoSquares(0);
    const wide = await renderPdfPages(bytes, { pages: [1], image: { mode: "each", maxEdgePx: 300, crop: { x0: 0, y0: 0, x1: 600, y1: 200 }, maxScale: 4 } });
    expect([wide.pages[0].image?.width, wide.pages[0].image?.height]).toEqual([300, 100]);
    // Page space, y down: the red square lies at y 50-150, so it shows in the top half of the page.
    const red = await pixel(wide.pages[0].image!.data, 75, 50);
    expect(red.r).toBeGreaterThan(200);
    expect(red.b).toBeLessThan(80);
    const whole = await renderPdfPages(bytes, { pages: [1], image: { mode: "each", maxEdgePx: 300 } });
    expect([whole.pages[0].image?.width, whole.pages[0].image?.height]).toEqual([300, 200]);
  });
});

// Ways a page that embeds a raster above maxEmbeddedImagePixels (TI-715) could
// be misread, written before the fix. Under stopAtErrors PDF.js throws on the
// oversize image, and the render resolves with the operators read so far:
// - the text and strokes drawn after the image are missing from the picture
//   (legend codes, labels, title block), with no issue reported;
// - the picture lacks the raster and nothing tells the caller so;
// - a scan (nothing but the raster) is no longer flagged blank, or a plain
//   page is reported as missing an image;
// - letting PDF.js continue past the image also lets another error of the
//   page's drawing (here a shading the page does not define) give a partial
//   picture instead of no picture;
// - the text pass changes.
// Found in review, before their fix: errors that stopAtErrors itself absorbs
// must not fail the picture: an annotation whose appearance is broken (PDF.js
// drops that annotation), a font whose file cannot be read (drawn without it);
// the annotation must not excuse a content error either; a page that fails
// closed must stop at its error, not cost a whole drawing (or two) first.

/** Declared 4 000 × 4 000 px (16 MP, above the default 8 MP), stored in a few kilobytes: white, 1 bit, deflated. */
function oversizeImage(doc: PDFDocument) {
  const side = 4000;
  return doc.context.register(doc.context.flateStream(new Uint8Array((side / 8) * side).fill(0xff), {
    Type: "XObject", Subtype: "Image", Width: side, Height: side, ColorSpace: "DeviceGray", BitsPerComponent: 1,
  }));
}

/** Square annotations from their appearance streams. */
function annotate(doc: PDFDocument, page: PDFPage, annotations: Array<{ appearance: string; rect: number[] }>) {
  page.node.set(PDFName.of("Annots"), doc.context.obj(annotations.map(({ appearance, rect }) => doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Square", Rect: rect,
    AP: { N: doc.context.register(doc.context.stream(appearance, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 100, 100] })) },
  })))));
}

/** Its appearance shows text without selecting a font (no Tf). */
const BROKEN_ANNOTATION = { appearance: "BT 10 10 Td (X) Tj ET", rect: [400, 250, 500, 350] };
/** A black square drawn at x 400-500, y 250-350 of the 600 × 400 render (page space, y down). */
const MARKUP = { appearance: "0 0 0 rg 0 0 100 100 re f", rect: [400, 50, 500, 150] };
const MARKUP_BOX = { x0: 410, y0: 260, x1: 490, y1: 340 };

/** A TrueType font whose FontFile2 is a number instead of a stream. */
function fontWithoutFile(doc: PDFDocument) {
  const descriptor = doc.context.obj({ Type: "FontDescriptor", FontName: "Fictive-Bold", Flags: 32, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0,
    Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: 5 });
  return doc.context.register(doc.context.obj({ Type: "Font", Subtype: "TrueType", BaseFont: "Fictive-Bold", FirstChar: 32, LastChar: 126,
    Widths: Array.from({ length: 95 }, () => 600), Encoding: "WinAnsiEncoding", FontDescriptor: descriptor }));
}

function paintImage(page: PDFPage, image: PDFRef) {
  page.node.setXObject(PDFName.of("Im0"), image);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(100, 0, 0, 100, 450, 250), drawObject("Im0"), popGraphicsState());
}

const LEGEND = "LEGENDE EG VC";
/** The legend text box in the 600 × 400 render (page space, y down): Helvetica 40 on the baseline y = 100. */
const LEGEND_BOX = { x0: 50, y0: 272, x1: 330, y1: 300 };

async function rasterPages() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = oversizeImage(doc);
  const legend = (page: PDFPage) => page.drawText(LEGEND, { x: 50, y: 100, size: 40, font, color: rgb(0, 0, 0) });
  // 1. A plan over a background raster: red stroke, the raster, then the legend and a blue stroke.
  const plan = doc.addPage([600, 400]);
  plan.drawLine({ start: { x: 20, y: 380 }, end: { x: 580, y: 380 }, thickness: 6, color: rgb(1, 0, 0) });
  paintImage(plan, image);
  legend(plan);
  plan.drawLine({ start: { x: 20, y: 20 }, end: { x: 580, y: 20 }, thickness: 6, color: rgb(0, 0, 1) });
  // 2. A scan: nothing but the raster.
  paintImage(doc.addPage([600, 400]), image);
  // 3. The plan without any raster.
  const vector = doc.addPage([600, 400]);
  legend(vector);
  vector.drawLine({ start: { x: 20, y: 20 }, end: { x: 580, y: 20 }, thickness: 6, color: rgb(0, 0, 1) });
  // 4. A shading the page does not define, then the legend; 5. the same after the raster, with a broken annotation.
  for (const withImage of [false, true]) {
    const broken = doc.addPage([600, 400]);
    if (withImage) {
      paintImage(broken, image);
      annotate(doc, broken, [BROKEN_ANNOTATION]);
    }
    broken.pushOperators(PDFOperator.of(PDFOperatorNames.ShadingFill, [PDFName.of("Sh9")]));
    legend(broken);
  }
  // 6. The plan with a broken annotation and a markup.
  const annotated = doc.addPage([600, 400]);
  legend(annotated);
  annotate(doc, annotated, [BROKEN_ANNOTATION, MARKUP]);
  // 7. A label in a font whose file cannot be read, then the blue stroke.
  const unreadableFont = doc.addPage([600, 400]);
  unreadableFont.node.setFontDictionary(PDFName.of("F9"), fontWithoutFile(doc));
  unreadableFont.pushOperators(PDFOperator.of(PDFOperatorNames.BeginText), PDFOperator.of(PDFOperatorNames.SetFontAndSize, [PDFName.of("F9"), doc.context.obj(40)]),
    PDFOperator.of(PDFOperatorNames.MoveText, [doc.context.obj(50), doc.context.obj(100)]),
    PDFOperator.of(PDFOperatorNames.ShowText, [PDFString.of(LEGEND)]), PDFOperator.of(PDFOperatorNames.EndText));
  unreadableFont.drawLine({ start: { x: 20, y: 20 }, end: { x: 580, y: 20 }, thickness: 6, color: rgb(0, 0, 1) });
  return doc.save();
}

async function pixels(data: string) {
  const image = await loadImage(Buffer.from(data, "base64"));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

/** Share of dark pixels in a box of the decoded JPEG. */
async function inkShare(data: string, box: { x0: number; y0: number; x1: number; y1: number }) {
  const image = await pixels(data);
  let ink = 0;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const index = (y * image.width + x) * 4;
      if (Math.max(image.data[index], image.data[index + 1], image.data[index + 2]) < 128) ink += 1;
    }
  }
  return ink / ((box.x1 - box.x0) * (box.y1 - box.y0));
}

describe("embedded images above maxEmbeddedImagePixels in renderPdfPages", () => {
  it("draws what the page paints after the image, reports the image left out, and fails closed on another error", SPAWN, async () => {
    const result = await renderPdfPages(await rasterPages(), { pages: [1, 2, 3, 4, 5], image: { mode: "each", maxEdgePx: 600 } });
    expect(result.status).toBe("complete");
    const [plan, scan, vector, broken, brokenAfterImage] = result.pages;
    expect(result.pages.map((page) => [page.page, page.text.includes(LEGEND), page.failed])).toEqual([
      [1, true, false], [2, false, false], [3, true, false], [4, true, false], [5, true, false],
    ]);

    if (!plan.image) throw new Error(`no image: ${plan.imageIssue}`);
    expect(plan).toMatchObject({ imageIssue: null, droppedImages: 1, image: { width: 600, height: 400, blank: false } });
    expect(await inkShare(plan.image.data, LEGEND_BOX)).toBeGreaterThan(0.1);
    const { data, width } = await pixels(plan.image.data);
    const at = (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    const [redR, , redB] = at(300, 20);
    const [blueR, , blueB] = at(300, 380);
    expect([redR > 200, redB < 80, blueR < 80, blueB > 200]).toEqual([true, true, true, true]);

    expect(scan).toMatchObject({ imageIssue: null, droppedImages: 1, image: { blank: true } });
    expect(vector).toMatchObject({ imageIssue: null, droppedImages: 0, image: { blank: false } });
    for (const page of [broken, brokenAfterImage]) expect(page).toMatchObject({ image: null, imageIssue: "render_failed", droppedImages: 0 });
  });

  it("still draws a page, its other annotations included, when PDF.js absorbs a broken annotation or an unreadable font file", SPAWN, async () => {
    const result = await renderPdfPages(await rasterPages(), { pages: [6, 7], image: { mode: "each", maxEdgePx: 600 } });
    const [annotated, unreadableFont] = result.pages;
    expect([annotated.imageIssue, unreadableFont.imageIssue, annotated.failed, unreadableFont.failed]).toEqual([null, null, false, false]);
    expect(await inkShare(annotated.image!.data, LEGEND_BOX)).toBeGreaterThan(0.1);
    expect(await inkShare(annotated.image!.data, MARKUP_BOX)).toBeGreaterThan(0.9);
    const { data, width } = await pixels(unreadableFont.image!.data);
    const [blueR, , blueB] = Array.from(data.slice((380 * width + 300) * 4, (380 * width + 300) * 4 + 3));
    expect([blueR < 80, blueB > 200]).toEqual([true, true]);
  });

  it("stops drawing a page at its first content error", SPAWN, async () => {
    const doc = await PDFDocument.create();
    const strokes = Array.from({ length: 150_000 }, (_, index) => `${index % 600} 0 m ${index % 600} 400 l S`).join("\n");
    for (const content of [`/Sh9 sh\n${strokes}`, strokes]) {
      const page = doc.addPage([600, 400]);
      page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(content)));
    }
    const result = await renderPdfPages(await doc.save(), { pages: [1, 2], image: { mode: "each", maxEdgePx: 600 } });
    const [failing, drawn] = result.pages;
    expect([failing.imageIssue, drawn.imageIssue]).toEqual(["render_failed", null]);
    // Both pages read the same 150 000 strokes for their text; only the second one draws them.
    expect(failing.renderMs).toBeLessThan(drawn.renderMs / 2);
  });

  it("reports the image left out of a thumbnail rendered only for a page without enough text", SPAWN, async () => {
    const result = await renderPdfPages(await rasterPages(), { pages: [2], image: { mode: "if_text_below", minTextChars: 80, page: 2, maxEdgePx: 600 } });
    expect(result.pages[0]).toMatchObject({ page: 2, imageIssue: null, droppedImages: 1, image: { blank: true } });
  });
});

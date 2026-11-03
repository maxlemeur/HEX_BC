import { loadImage, createCanvas } from "@napi-rs/canvas";
import { degrees, PDFDocument, rgb } from "pdf-lib";
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

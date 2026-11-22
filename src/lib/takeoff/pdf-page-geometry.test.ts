import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  PDF_MAX_CANVAS_PIXELS,
  normalizePdfRotation,
  pdfCanvasPixels,
  pdfCanvasScale,
  pdfPointToVisible,
  screenPointToVisible,
  visiblePointToScreen,
  type PdfPageRotation,
} from "@/lib/takeoff/pdf-page-geometry";

// The page reader of the review (lot 5) places what it draws on the visible page: the view box after the page's own
// rotation. Written before the reader was extracted, against pdf.js itself: a fictional plan of four pages, each with an
// off-centre CropBox and its own /Rotate, read by pdf.js's viewport at scale 1. A conversion that forgets the CropBox
// origin, turns the wrong way or swaps width and height puts a point on another part of the sheet.

async function fictionalPlan() {
  const document = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = document.addPage([600, 400]);
    page.setCropBox(10, 20, 500, 300);
    page.setRotation(degrees(rotation));
  }
  // A page turned by -90 (pdf.js reads it as 270).
  document.addPage([600, 400]).setRotation(degrees(-90));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: await document.save(), useSystemFonts: true });
}

describe("pdfPointToVisible", () => {
  it("places a point of the PDF's user space where pdf.js draws it, for each rotation and an off-centre CropBox", async () => {
    const task = await fictionalPlan();
    const pdf = await task.promise;
    const points = [{ x: 10, y: 320 }, { x: 510, y: 20 }, { x: 110, y: 220 }, { x: 400, y: 50 }];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const rotation = normalizePdfRotation(page.rotate);
      const viewBox = page.view as [number, number, number, number];
      for (const point of points) {
        const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
        const visible = pdfPointToVisible(point, { viewBox, rotation });
        expect(visible.x * viewport.width).toBeCloseTo(x, 6);
        expect(visible.y * viewport.height).toBeCloseTo(y, 6);
      }
    }
    await task.destroy();
  });

  it("reads a negative or a full turn as pdf.js does", () => {
    const cases: Array<[number, PdfPageRotation]> = [[-90, 270], [450, 90], [360, 0], [-180, 180], [0, 0]];
    for (const [rotate, expected] of cases) expect(normalizePdfRotation(rotate)).toBe(expected);
    expect(normalizePdfRotation(undefined)).toBe(0);
  });
});

describe("pdfCanvasScale", () => {
  const a0 = { width: 3370, height: 2384 };

  it("draws at the screen's scale times the device's sharpness, at most twice", () => {
    expect(pdfCanvasScale({ width: 842, height: 595 }, 0.5, 1)).toBe(0.5);
    expect(pdfCanvasScale({ width: 842, height: 595 }, 0.5, 3)).toBe(1);
  });

  it("never asks for more pixels than the ceiling: a zoomed A0 is drawn smaller and stretched", () => {
    const scale = pdfCanvasScale(a0, 8, 2);
    expect(scale).toBeLessThan(16);
    expect(Math.floor(a0.width * scale) * Math.floor(a0.height * scale)).toBeLessThanOrEqual(PDF_MAX_CANVAS_PIXELS);
  });

  it("draws nothing for a page without area or a zero scale", () => {
    expect(pdfCanvasScale({ width: 0, height: 500 }, 1, 1)).toBe(0);
    expect(pdfCanvasScale(a0, 0, 1)).toBe(0);
  });
});

describe("pdfCanvasPixels", () => {
  // Review of PR 2 (written before the fix): the short side of a sliver floored to zero and raised to one let the long
  // side pass the ceiling.
  it("never gives a canvas over the ceiling, for any finite viewport, and says how much to scale down", () => {
    for (const [width, height] of [[0.0005, 18_317_868], [18_317_868, 0.4], [4_870.9, 3_444.6], [0.2, 0.3], [5_000, 5_000],
      [1, 16_777_217], [Number.NaN, 10], [Number.POSITIVE_INFINITY, 1]]) {
      const pixels = pdfCanvasPixels(width, height);
      expect(pixels.width * pixels.height, `${width} × ${height}`).toBeLessThanOrEqual(PDF_MAX_CANVAS_PIXELS);
      expect(pixels.width).toBeGreaterThanOrEqual(1);
      expect(pixels.height).toBeGreaterThanOrEqual(1);
    }
    expect(pdfCanvasPixels(4_870.9, 3_444.6)).toEqual({ width: 4_870, height: 3_444, ratio: 1 });
    expect(pdfCanvasPixels(0.0005, 18_317_868)).toEqual({ width: 1, height: PDF_MAX_CANVAS_PIXELS, ratio: PDF_MAX_CANVAS_PIXELS / 18_317_868 });
  });
});

describe("visiblePointToScreen and screenPointToVisible", () => {
  const size = { width: 300, height: 500 };
  const view = { scale: 2, offset: { x: -40, y: 25 } };

  it("go one way and back at a zoom and a pan", () => {
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.25, y: 0.8 }]) {
      const screen = visiblePointToScreen(point, size, view);
      const back = screenPointToVisible(screen, size, view)!;
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
    expect(visiblePointToScreen({ x: 0.5, y: 0.5 }, size, view)).toEqual({ x: 260, y: 525 });
  });

  it("finds no point of the page outside it", () => {
    expect(screenPointToVisible({ x: -41, y: 30 }, size, view)).toBeNull();
    expect(screenPointToVisible({ x: 100, y: 25 + 1001 }, size, view)).toBeNull();
    expect(screenPointToVisible({ x: 100, y: 100 }, size, { ...view, scale: 0 })).toBeNull();
  });
});

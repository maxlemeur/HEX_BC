"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import type { NormalizedBox } from "@/lib/takeoff/lab/geometry";

/** Loads a lab document with pdf.js, as IntakePdfPreview does (same worker and assets). */
export async function loadLabPdf(url: string): Promise<{ task: PDFDocumentLoadingTask; pdf: Promise<PDFDocumentProxy> }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const assetRoot = new URL("/assets/pdfjs/", window.location.origin).href;
  const task = pdfjs.getDocument({
    url, useSystemFonts: true, cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`, iccUrl: `${assetRoot}iccs/`,
  });
  return { task, pdf: task.promise };
}

/** Largest canvas side and area browsers render reliably. */
const MAX_SIDE = 8192;
const MAX_AREA = 36_000_000;

export function cappedScale(width: number, height: number, scale: number) {
  const side = Math.max(width, height) * scale;
  const area = width * height * scale * scale;
  return Math.min(scale, side > MAX_SIDE ? (scale * MAX_SIDE) / side : scale, area > MAX_AREA ? scale * Math.sqrt(MAX_AREA / area) : scale);
}

/** Renders `region` (or the whole page) of a page displayed with its /Rotate, `scale` pixels per point. */
export function renderRegion(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, region: NormalizedBox | null) {
  const full = page.getViewport({ scale });
  const box = region ?? { x: 0, y: 0, width: 1, height: 1 };
  canvas.width = Math.max(1, Math.ceil(full.width * box.width));
  canvas.height = Math.max(1, Math.ceil(full.height * box.height));
  return page.render({ canvas, viewport: full, transform: [1, 0, 0, 1, -box.x * full.width, -box.y * full.height] });
}

/** JPEG base64 (without data: prefix) of the page or region for Decisions, within 3 Mio. */
export async function renderDecisionsImage(pdf: PDFDocumentProxy, pageNumber: number, region: NormalizedBox | null) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const box = region ?? { x: 0, y: 0, width: 1, height: 1 };
  for (const side of [2000, 1600, 1200, 900]) {
    const scale = side / Math.max(base.width * box.width, base.height * box.height);
    const canvas = document.createElement("canvas");
    await renderRegion(page, canvas, scale, region).promise;
    const data = canvas.toDataURL("image/jpeg", 0.85).replace(/^data:image\/jpeg;base64,/, "");
    if (data.length <= 3 * 1024 * 1024) return { mimeType: "image/jpeg" as const, data };
  }
  throw new Error("L’image de la page dépasse 3 Mio même réduite : recadrez une zone.");
}

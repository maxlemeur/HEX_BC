/**
 * The geometry of one page of a plan as the review draws it, shared by the vector viewer and the detail of an item
 * (lot 5): the size of the visible page at scale 1, the canvas's backing scale under the pixel ceiling, and the
 * conversions between a point of the PDF's user space, the visible page and the screen.
 *
 * The visible page is the page as a reader sees it: its view box (CropBox) after the page's own rotation (/Rotate), with
 * its origin at the top left. A point of it is normalised to [0, 1] on each axis, so that it does not depend on the zoom,
 * the screen or the size of the canvas; pdf.js's viewport at scale 1 gives the same width and height in points.
 */

/** Pixels of a rendered page at most: Safari refuses larger canvases, and an A0 at zoom 8 would be hundreds of MB. */
export const PDF_MAX_CANVAS_PIXELS = 16_777_216;
/** The sharpest backing store the review asks for, whatever the device (a 3× screen would triple the memory). */
export const PDF_MAX_DEVICE_PIXEL_RATIO = 2;

export type PdfPageRotation = 0 | 90 | 180 | 270;
/** Why a page is not drawn. unavailable: no address for its bytes; load_failed: the PDF could not be opened; page_missing: no such page; render_failed. */
export type PdfPageFailure = "unavailable" | "load_failed" | "page_missing" | "render_failed";
/** The visible page at scale 1, in points: pdf.js's viewport at scale 1 (rotation applied). */
export type PdfPageSize = { width: number; height: number };
export type PdfPoint = { x: number; y: number };
/** What the screen shows of a page: its scale in screen pixels per point, and the pan of its top-left corner. */
export type PdfPageView = { scale: number; offset: PdfPoint };

/** The rotation pdf.js applies to a page (its /Rotate, a multiple of 90, in either direction). */
export function normalizePdfRotation(rotate: number | null | undefined): PdfPageRotation {
  const quarter = Math.round((rotate ?? 0) / 90);
  return ((((quarter % 4) + 4) % 4) * 90) as PdfPageRotation;
}

/**
 * The scale at which the page's canvas is drawn: the screen's scale times the device's sharpness (at most twice), never
 * past the pixel ceiling. Beyond the ceiling the canvas is drawn smaller and stretched to the screen's size.
 */
export function pdfCanvasScale(size: PdfPageSize, screenScale: number, devicePixelRatio: number): number {
  const wanted = screenScale * Math.min(devicePixelRatio || 1, PDF_MAX_DEVICE_PIXEL_RATIO);
  const area = size.width * size.height;
  if (!(area > 0) || !(wanted > 0)) return 0;
  return Math.min(wanted, Math.sqrt(PDF_MAX_CANVAS_PIXELS / area));
}

/**
 * A point of the page's PDF user space (y upwards from its view box's bottom) on the visible page, normalised: the view
 * box's top-left corner after the page's rotation is (0, 0). `viewBox` is pdf.js's `page.view` ([x0, y0, x1, y1]).
 */
export function pdfPointToVisible(point: PdfPoint, page: { viewBox: readonly [number, number, number, number]; rotation: PdfPageRotation }): PdfPoint {
  const [x0, y0, x1, y1] = page.viewBox;
  const width = x1 - x0;
  const height = y1 - y0;
  // The unrotated page from its top-left corner, normalised.
  const u = (point.x - x0) / width;
  const v = (y1 - point.y) / height;
  switch (page.rotation) {
    case 90: return { x: 1 - v, y: u };
    case 180: return { x: 1 - u, y: 1 - v };
    case 270: return { x: v, y: 1 - u };
    default: return { x: u, y: v };
  }
}

/** A point of the visible page (normalised) on the screen, at the page's scale and pan. */
export function visiblePointToScreen(point: PdfPoint, size: PdfPageSize, view: PdfPageView): PdfPoint {
  return { x: view.offset.x + point.x * size.width * view.scale, y: view.offset.y + point.y * size.height * view.scale };
}

/** The point of the visible page (normalised) under a point of the screen; null outside the page. */
export function screenPointToVisible(point: PdfPoint, size: PdfPageSize, view: PdfPageView): PdfPoint | null {
  const width = size.width * view.scale;
  const height = size.height * view.scale;
  if (!(width > 0) || !(height > 0)) return null;
  const x = (point.x - view.offset.x) / width;
  const y = (point.y - view.offset.y) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

/** The zoom of a page over its fitted width, kept between a quarter and eight times. */
export function zoomedBy(zoom: number, factor: number): number {
  return Math.min(8, Math.max(0.25, zoom * factor));
}

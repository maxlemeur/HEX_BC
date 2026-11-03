// Pure geometry of the takeoff lab (TI-661): the crop box of a region drawn on
// the displayed page, the Pareto frontier of judged configurations and the zone
// of interest of the stats chart.

/** A region of the page as displayed (pdf.js applies /Rotate), top-left origin, fractions of the displayed size. */
export type NormalizedBox = { x: number; y: number; width: number; height: number };
/** A rectangle in PDF user space (bottom-left origin). */
export type PdfBox = { left: number; bottom: number; right: number; top: number };

function fraction(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function assertNormalizedBox(box: NormalizedBox) {
  const { x, y, width, height } = box;
  if (![x, y, width, height].every(fraction) || width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
    throw new Error("La zone de recadrage doit tenir dans la page.");
  }
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Maps a corner (u, v) of the displayed page to the unrotated page, both as
 * fractions with a top-left origin. /Rotate turns the page clockwise.
 */
function unrotate(u: number, v: number, rotation: 0 | 90 | 180 | 270) {
  if (rotation === 90) return { ux: v, uy: 1 - u };
  if (rotation === 180) return { ux: 1 - u, uy: 1 - v };
  if (rotation === 270) return { ux: 1 - v, uy: u };
  return { ux: u, uy: v };
}

export function normalizeRotation(degrees: number): 0 | 90 | 180 | 270 {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new Error("Rotation de page non prise en charge.");
  }
  return normalized;
}

/** The CropBox of `box`, drawn on the page displayed with `rotation`, in the user space of the page's `view` box. */
export function cropBoxFor(view: PdfBox, rotation: number, box: NormalizedBox): PdfBox {
  assertNormalizedBox(box);
  const turn = normalizeRotation(rotation);
  const width = view.right - view.left;
  const height = view.top - view.bottom;
  const corners = [unrotate(box.x, box.y, turn), unrotate(box.x + box.width, box.y + box.height, turn)]
    .map(({ ux, uy }) => ({ x: view.left + ux * width, y: view.top - uy * height }));
  return {
    left: round(Math.min(corners[0].x, corners[1].x)),
    bottom: round(Math.min(corners[0].y, corners[1].y)),
    right: round(Math.max(corners[0].x, corners[1].x)),
    top: round(Math.max(corners[0].y, corners[1].y)),
  };
}

/** x: tokens or latency (lower is better); y: share judged good (higher is better). */
export type ChartPoint = { id: string; x: number; y: number };

/** The points no other point beats on both axes (ties kept), cheapest first. */
export function paretoFrontier<T extends ChartPoint>(points: readonly T[]): T[] {
  const kept = points.filter((point) => !points.some((other) =>
    other.x <= point.x && other.y >= point.y && (other.x < point.x || other.y > point.y)));
  return kept.map((point, index) => ({ point, index }))
    .sort((left, right) => left.point.x - right.point.x || right.point.y - left.point.y || left.index - right.index)
    .map(({ point }) => point);
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Fewer tokens (or less latency) and better judged than the median configuration; null without points. */
export function interestZone(points: readonly ChartPoint[]): { maxX: number; minY: number } | null {
  if (points.length === 0) return null;
  return { maxX: median(points.map((point) => point.x)), minY: median(points.map((point) => point.y)) };
}

// Room surface rules (TI-664 step 1): a room's polygon area agrees with the
// surface printed in it, rooms of one page do not overlap, and a bathtub, a
// cupboard or a shaft drawn as a closed box is no room.
// - Area: |area − printed| ≤ max(AREA_PRINTED.relative × printed,
//   AREA_PRINTED.absolute_m2). The line's quantity is read as it is now: a
//   quantity the user corrected to the printed surface settles it.
// - Overlap: the area two room polygons share, sampled on a grid over their
//   common box: ROOM_OVERLAP.step_m, finer when that box is narrow (a twentieth
//   of its smaller side, so that a sliver of a few centimetres is measured),
//   coarser only when it would take more than ROOM_OVERLAP.maxSamples points;
//   above max(ROOM_OVERLAP.relative × the smaller room, ROOM_OVERLAP
//   .absolute_m2). Rooms sharing a wall only touch: no area.
// - Closed box: a room labelled as a bathtub, cupboard or shaft, or a
//   four-cornered polygon under CLOSED_BOX.maxShare of the printed surface
//   (the outline around the label is a box drawn in the room, not the room).

export const ROOM_RULES_VERSION = 1;

/**
 * Starting values (3/11/2026), provisional: the bench gives two closed room polygons only (D RDC, outside the
 * reserve), one read right at −0.1 % of its printed surface, one a box at −69.8 %. 2 % is an outline drawn
 * 1.5 cm off the walls of a 10 m² room; 0.1 m² keeps a 1 m² cupboard from failing on rounding.
 */
export const AREA_PRINTED = { relative: 0.02, absolute_m2: 0.1 } as const;
export const ROOM_OVERLAP = { relative: 0.02, absolute_m2: 0.1, step_m: 0.05, maxSamples: 250_000 } as const;
export const CLOSED_BOX = { maxShare: 0.5 } as const;

const BOX_LABEL = /\b(?:baignoires?|placards?|gaines?(?:\s+techniques?)?|GT[ADL]?)\b/i;

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** A room label naming a bathtub, a cupboard or a shaft (« Placard », « Gaine technique », « GTL »). */
export function isBoxLabel(room: string) {
  return BOX_LABEL.test(stripAccents(room));
}

export function areaTolerance(printed: number) {
  return Math.max(AREA_PRINTED.relative * printed, AREA_PRINTED.absolute_m2);
}

export function areaAgrees(area: number, printed: number) {
  return Math.abs(area - printed) <= areaTolerance(printed) + 1e-9;
}

/**
 * Points of a polygon given as x, y pairs: a point repeating the one before it is dropped, and the closing points
 * repeating the first (a box drawn back to its start then closed holds it twice).
 */
export function polygonPoints(flat: readonly number[]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    const point: [number, number] = [flat[index], flat[index + 1]];
    const last = points[points.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
  while (points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop();
  return points;
}

/** Distinct corners of a polygon (collinear and repeated points dropped). */
export function cornerCount(points: ReadonlyArray<[number, number]>) {
  let corners = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [px, py] = points[(index + points.length - 1) % points.length];
    const [x, y] = points[index];
    const [nx, ny] = points[(index + 1) % points.length];
    const cross = (x - px) * (ny - y) - (y - py) * (nx - x);
    const scale = Math.hypot(x - px, y - py) * Math.hypot(nx - x, ny - y);
    if (scale > 0 && Math.abs(cross) / scale > 1e-3) corners += 1;
  }
  return corners;
}

/** A four-cornered polygon much smaller than the printed surface: a box drawn around the label, not the room. */
export function isBoxShape(points: ReadonlyArray<[number, number]>, area: number, printed: number) {
  return cornerCount(points) === 4 && printed > 0 && area < CLOSED_BOX.maxShare * printed;
}

function inside(points: ReadonlyArray<[number, number]>, x: number, y: number) {
  let result = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) result = !result;
  }
  return result;
}

function bounds(points: ReadonlyArray<[number, number]>) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** Area two polygons share, sampled at the centres of a grid over their common box (m²). */
export function sharedArea(left: ReadonlyArray<[number, number]>, right: ReadonlyArray<[number, number]>) {
  if (left.length < 3 || right.length < 3) return 0;
  const a = bounds(left), b = bounds(right);
  const box = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  const width = box.x1 - box.x0, height = box.y1 - box.y0;
  if (width <= 0 || height <= 0) return 0;
  // Finer on a narrow common box (a sliver along a wall), coarser only past maxSamples point tests.
  const step = Math.max(Math.min(ROOM_OVERLAP.step_m, Math.min(width, height) / 20), Math.sqrt((width * height) / ROOM_OVERLAP.maxSamples));
  let count = 0;
  for (let y = box.y0 + step / 2; y < box.y1; y += step) {
    for (let x = box.x0 + step / 2; x < box.x1; x += step) {
      if (inside(left, x, y) && inside(right, x, y)) count += 1;
    }
  }
  return Math.round(count * step * step * 1000) / 1000;
}

/** Whether a shared area is an overlap of the two rooms (not a touch along a wall). */
export function roomsOverlap(shared: number, leftArea: number, rightArea: number) {
  return shared > Math.max(ROOM_OVERLAP.relative * Math.min(leftArea, rightArea), ROOM_OVERLAP.absolute_m2);
}

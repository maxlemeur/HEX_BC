// Page-space geometry of the vector reading (TI-662). Page space is in sheet
// points (1/72 in, userUnit applied), y down. A real length is the sheet length
// in millimetres times the scale denominator.

export type Point = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Segment = { x0: number; y0: number; x1: number; y1: number };

export const MM_PER_POINT = 25.4 / 72;

/** Metres on site for a sheet length in points at 1/denominator. */
export function pointsToMetres(points: number, denominator: number) {
  return (points * MM_PER_POINT * denominator) / 1000;
}

/** Square metres on site for a sheet area in square points at 1/denominator. */
export function squarePointsToSquareMetres(area: number, denominator: number) {
  const metresPerPoint = (MM_PER_POINT * denominator) / 1000;
  return area * metresPerPoint * metresPerPoint;
}

export function segmentLength(segment: Segment) {
  return Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0);
}

/** Polyline length of points[start .. start + count) (x, y pairs). */
export function polylineLength(points: ArrayLike<number>, start: number, count: number) {
  let length = 0;
  for (let index = start + 1; index < start + count; index += 1) {
    length += Math.hypot(points[2 * index] - points[2 * index - 2], points[2 * index + 1] - points[2 * index - 1]);
  }
  return length;
}

/** Shoelace area of a closed ring points[start .. start + count) (the closing point may repeat the first). */
export function ringArea(points: ArrayLike<number>, start: number, count: number) {
  let twice = 0;
  for (let index = start; index < start + count; index += 1) {
    const next = index + 1 < start + count ? index + 1 : start;
    twice += points[2 * index] * points[2 * next + 1] - points[2 * next] * points[2 * index + 1];
  }
  return Math.abs(twice) / 2;
}

export function pointInRing(point: Point, points: ArrayLike<number>, start: number, count: number) {
  let inside = false;
  for (let index = start, previous = start + count - 1; index < start + count; previous = index, index += 1) {
    const xi = points[2 * index], yi = points[2 * index + 1], xj = points[2 * previous], yj = points[2 * previous + 1];
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: Point, segment: Segment) {
  const dx = segment.x1 - segment.x0, dy = segment.y1 - segment.y0;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - segment.x0) * dx + (point.y - segment.y0) * dy) / length2));
  return Math.hypot(point.x - (segment.x0 + t * dx), point.y - (segment.y0 + t * dy));
}

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function extendBox(box: Box, x: number, y: number) {
  if (x < box.x0) box.x0 = x;
  if (y < box.y0) box.y0 = y;
  if (x > box.x1) box.x1 = x;
  if (y > box.y1) box.y1 = y;
}

export function boxContains(box: Box, point: Point, margin = 0) {
  return point.x >= box.x0 - margin && point.x <= box.x1 + margin && point.y >= box.y0 - margin && point.y <= box.y1 + margin;
}

export function boxesOverlap(left: Box, right: Box, margin = 0) {
  return left.x0 - margin <= right.x1 && right.x0 - margin <= left.x1 && left.y0 - margin <= right.y1 && right.y0 - margin <= left.y1;
}

export function boxArea(box: Box) {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

/**
 * Uniform grid over segments for proximity queries (cotes, labels, legend):
 * a segment is listed in every cell its box touches.
 */
export class SegmentIndex {
  readonly cell: number;
  private readonly cells = new Map<number, number[]>();

  // `width` is kept for callers; cells are keyed on a fixed grid that also holds coordinates off the page.
  constructor(readonly segments: readonly Segment[], width: number, cell = 24) {
    void width;
    this.cell = cell;
    segments.forEach((segment, id) => {
      if (![segment.x0, segment.y0, segment.x1, segment.y1].every(Number.isFinite)) return;
      const [cx0, cx1] = [Math.floor(Math.min(segment.x0, segment.x1) / cell), Math.floor(Math.max(segment.x0, segment.x1) / cell)];
      const [cy0, cy1] = [Math.floor(Math.min(segment.y0, segment.y1) / cell), Math.floor(Math.max(segment.y0, segment.y1) / cell)];
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return; // a page-long stroke is never a cote, tick or label leader
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const key = SegmentIndex.key(cx, cy);
          const list = this.cells.get(key);
          if (list) list.push(id);
          else this.cells.set(key, [id]);
        }
      }
    });
  }

  /** One key per cell for |cx|, |cy| < 2^20 (24 pt cells: far beyond any sheet). */
  private static key(cx: number, cy: number) {
    return (cy + 1048576) * 2097152 + (cx + 1048576);
  }

  /** Ids of the segments whose cells meet the box around point within radius (each once). */
  near(point: Point, radius: number): number[] {
    const found = new Set<number>();
    for (let cx = Math.floor((point.x - radius) / this.cell); cx <= Math.floor((point.x + radius) / this.cell); cx += 1) {
      for (let cy = Math.floor((point.y - radius) / this.cell); cy <= Math.floor((point.y + radius) / this.cell); cy += 1) {
        for (const id of this.cells.get(SegmentIndex.key(cx, cy)) ?? []) found.add(id);
      }
    }
    return [...found];
  }
}

/** Direction of a segment folded to [0, π). */
export function orientation(segment: Segment) {
  const angle = Math.atan2(segment.y1 - segment.y0, segment.x1 - segment.x0);
  return angle < 0 ? angle + Math.PI : angle >= Math.PI ? angle - Math.PI : angle;
}

/** Smallest difference between two orientations in [0, π). */
export function orientationGap(left: number, right: number) {
  const gap = Math.abs(left - right) % Math.PI;
  return Math.min(gap, Math.PI - gap);
}

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

/** A subpath whose last point lies within this distance of its first is a ring, closePath (h, s) or not (CAD exports round). */
export const RING_CLOSURE_PT = 0.5;

/** Whether points[start .. start + count) ends where it began (within RING_CLOSURE_PT): drawn back to its start, stroked without closePath. */
export function returnsToStart(points: ArrayLike<number>, start: number, count: number) {
  const last = start + count - 1;
  return Math.hypot(points[2 * last] - points[2 * start], points[2 * last + 1] - points[2 * start + 1]) < RING_CLOSURE_PT;
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
 * Uniform grid over segments for proximity queries (cotes, labels, legend, network runs): a segment is listed in
 * every cell its box touches. A long oblique segment, whose box would hold more than SEGMENT_INDEX_BOX_CELLS cells
 * (a pipe on the diagonal of an A0 sheet), is listed in the cells it crosses instead; one crossing more than
 * SEGMENT_INDEX_CROSSED_CELLS (far off any sheet) is returned by every query. No finite segment is left out.
 */
export const SEGMENT_INDEX_BOX_CELLS = 4096;
export const SEGMENT_INDEX_CROSSED_CELLS = 65_536;

export class SegmentIndex {
  readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly everywhere: number[] = [];

  // `width` is kept for callers; cells are keyed on a fixed grid that also holds coordinates off the page.
  constructor(readonly segments: readonly Segment[], width: number, cell = 24) {
    void width;
    this.cell = cell;
    const add = (cx: number, cy: number, id: number) => {
      const key = SegmentIndex.key(cx, cy);
      const list = this.cells.get(key);
      if (list) list.push(id);
      else this.cells.set(key, [id]);
    };
    segments.forEach((segment, id) => {
      const { x0, y0, x1, y1 } = segment;
      if (![x0, y0, x1, y1].every(Number.isFinite)) return;
      const [cx0, cx1] = [Math.floor(Math.min(x0, x1) / cell), Math.floor(Math.max(x0, x1) / cell)];
      const [cy0, cy1] = [Math.floor(Math.min(y0, y1) / cell), Math.floor(Math.max(y0, y1) / cell)];
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= SEGMENT_INDEX_BOX_CELLS) {
        for (let cx = cx0; cx <= cx1; cx += 1) for (let cy = cy0; cy <= cy1; cy += 1) add(cx, cy, id);
        return;
      }
      if (cx1 - cx0 + cy1 - cy0 + 2 > SEGMENT_INDEX_CROSSED_CELLS) {
        this.everywhere.push(id);
        return;
      }
      // The cells it crosses: in each column, the rows between the segment's heights at the column's edges.
      const dx = x1 - x0;
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const left = Math.max(Math.min(x0, x1), cx * cell), right = Math.min(Math.max(x0, x1), (cx + 1) * cell);
        const ya = dx === 0 ? y0 : y0 + ((left - x0) / dx) * (y1 - y0);
        const yb = dx === 0 ? y1 : y0 + ((right - x0) / dx) * (y1 - y0);
        for (let cy = Math.floor(Math.min(ya, yb) / cell); cy <= Math.floor(Math.max(ya, yb) / cell); cy += 1) add(cx, cy, id);
      }
    });
  }

  /** One key per cell for |cx|, |cy| < 2^20 (24 pt cells: far beyond any sheet). */
  private static key(cx: number, cy: number) {
    return (cy + 1048576) * 2097152 + (cx + 1048576);
  }

  /** Ids of the segments whose cells meet the box around point within radius (each once). */
  near(point: Point, radius: number): number[] {
    const found = new Set<number>(this.everywhere);
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

/** Smallest difference between two directions (radians), across ±π: 3.1416 and −3.1364 are 0.0052 apart. */
export function angleGap(left: number, right: number) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

/** Smallest difference between two orientations in [0, π). */
export function orientationGap(left: number, right: number) {
  const gap = Math.abs(left - right) % Math.PI;
  return Math.min(gap, Math.PI - gap);
}

/**
 * The frame of a text whose baseline runs at `angle` (radians, page space, y down): the baseline runs along
 * (cos, sin) in its reading direction and the glyphs rise along (sin, −cos). `along` and `up` project a page
 * point, or an offset, on them; read so, a page turned by /Rotate reads as drawn. At angle 0 they are exactly
 * x and −y, so a horizontal text reads as before.
 */
export function textFrame(angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { cos, sin, along: (x: number, y: number) => x * cos + y * sin, up: (x: number, y: number) => x * sin - y * cos };
}

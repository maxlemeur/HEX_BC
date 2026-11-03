import { applyTransform } from "@/lib/takeoff/rules/registration";
import type { TakeoffFrameTransform } from "@/lib/takeoff/rules/types";

// Duplicate runs between plans of one level (TI-664 step 1, Z1/Z2): two
// lines of the same network and DN on two pages, brought into one frame,
// whose centrelines run within ZONE_OVERLAP.distance_m of each other along a
// common length of at least ZONE_OVERLAP.minLength_m. That common length is
// counted twice by the version: the rule fails both lines until one of them
// is reduced by it (corrected quantity ≤ measured length − common length), or
// excluded, or the user accepts it.
// - Common length: along each centreline of a line, the union of the
//   stretches a centreline of the other line covers (parallel within
//   ZONE_OVERLAP.angle_deg, within the distance at both ends of the stretch),
//   so that two runs of the other line over one stretch count it once; the
//   smaller of both directions.
// - Lines of one page are never compared with each other (the reading already
//   merges a run drawn twice on a page); pages of different levels never.

export const ZONE_OVERLAP_VERSION = 1;

export const ZONE_OVERLAP = {
  /**
   * Two centrelines further apart than this are two pipes. Measured on the bench (B R+4 Z1/Z2, outside the
   * reserve, 3/11/2026): every run drawn on both sheets lies within 2 cm of its twin, the first two distinct
   * parallel pipes of one network 8.6 cm apart; 5 cm sits in that gap, above the registration residual.
   */
  distance_m: 0.05,
  /**
   * A common length under this is a crossing or two runs abutting at the zone limit (they overlap by at most a
   * band, 7 pt: 12 cm at 1/50, 25 cm at 1/100), never a duplicate; the smallest duplicate measured was 42 cm.
   */
  minLength_m: 0.3,
  /** Two centrelines more than this angle apart are not one run. */
  angle_deg: 2,
  /** A reduction this close to the common length settles it (quantities are rounded to the centimetre). */
  settle_m: 0.01,
} as const;

export type Centreline = [number, number, number, number];

export type OverlapLine = {
  id: string;
  /** Centrelines in page metres. */
  segments: readonly Centreline[];
};

function transformed(segments: readonly Centreline[], transform: TakeoffFrameTransform): Centreline[] {
  return segments.map(([x0, y0, x1, y1]) => {
    const [ax, ay] = applyTransform(transform, x0, y0);
    const [bx, by] = applyTransform(transform, x1, y1);
    return [ax, ay, bx, by];
  });
}

class SegmentGrid {
  private readonly cells = new Map<string, number[]>();
  constructor(readonly segments: readonly Centreline[], private readonly cell: number) {
    segments.forEach(([x0, y0, x1, y1], id) => {
      const [cx0, cx1] = [Math.floor(Math.min(x0, x1) / cell), Math.floor(Math.max(x0, x1) / cell)];
      const [cy0, cy1] = [Math.floor(Math.min(y0, y1) / cell), Math.floor(Math.max(y0, y1) / cell)];
      // A long run is listed in every cell of its box: centrelines of a floor are at most tens of metres.
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const key = `${cx},${cy}`;
          const list = this.cells.get(key);
          if (list) list.push(id);
          else this.cells.set(key, [id]);
        }
      }
    });
  }

  near(segment: Centreline, margin: number): number[] {
    const [x0, y0, x1, y1] = segment;
    const found = new Set<number>();
    for (let cx = Math.floor((Math.min(x0, x1) - margin) / this.cell); cx <= Math.floor((Math.max(x0, x1) + margin) / this.cell); cx += 1) {
      for (let cy = Math.floor((Math.min(y0, y1) - margin) / this.cell); cy <= Math.floor((Math.max(y0, y1) + margin) / this.cell); cy += 1) {
        for (const id of this.cells.get(`${cx},${cy}`) ?? []) found.add(id);
      }
    }
    return [...found];
  }
}

/** Length of the union of [start, end] intervals. */
function unionLength(intervals: Array<[number, number]>) {
  intervals.sort((left, right) => left[0] - right[0]);
  let total = 0, start = -Infinity, end = -Infinity;
  for (const [a, b] of intervals) {
    if (a > end) {
      if (end > start) total += end - start;
      start = a;
      end = b;
    } else if (b > end) {
      end = b;
    }
  }
  if (end > start) total += end - start;
  return total;
}

/** Common length of `line` covered by `other` (one direction), both already in one frame. */
function coveredLength(line: readonly Centreline[], other: SegmentGrid): number {
  const { distance_m: distance, angle_deg: angle } = ZONE_OVERLAP;
  const sinMax = Math.sin((angle * Math.PI) / 180);
  let total = 0;
  for (const segment of line) {
    const [x0, y0, x1, y1] = segment;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) continue;
    const ux = (x1 - x0) / length, uy = (y1 - y0) / length;
    const intervals: Array<[number, number]> = [];
    for (const id of other.near(segment, distance)) {
      const [ox0, oy0, ox1, oy1] = other.segments[id];
      const otherLength = Math.hypot(ox1 - ox0, oy1 - oy0);
      if (otherLength === 0) continue;
      // Parallel: the sine of the angle between both directions.
      if (Math.abs(ux * (oy1 - oy0) - uy * (ox1 - ox0)) / otherLength > sinMax) continue;
      // Projections of the other's ends on this centreline, and their distances to it.
      const t0 = (ox0 - x0) * ux + (oy0 - y0) * uy, t1 = (ox1 - x0) * ux + (oy1 - y0) * uy;
      const d0 = (ox0 - x0) * uy - (oy0 - y0) * ux, d1 = (ox1 - x0) * uy - (oy1 - y0) * ux;
      const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(length, Math.max(t0, t1));
      if (hi <= lo) continue;
      // The other's distance to this line at both ends of the common stretch (linear along it).
      const at = (t: number) => (t1 === t0 ? d0 : d0 + ((t - t0) / (t1 - t0)) * (d1 - d0));
      if (Math.abs(at(lo)) > distance || Math.abs(at(hi)) > distance) continue;
      intervals.push([lo, hi]);
    }
    total += unionLength(intervals);
  }
  return total;
}

/** Common length of two lines of two pages, each brought into the common frame by its page transform. */
export function commonLength(left: OverlapLine, leftTransform: TakeoffFrameTransform, right: OverlapLine,
  rightTransform: TakeoffFrameTransform): number {
  const a = transformed(left.segments, leftTransform);
  const b = transformed(right.segments, rightTransform);
  if (a.length === 0 || b.length === 0) return 0;
  const cell = 1;
  const forward = coveredLength(a, new SegmentGrid(b, cell));
  if (forward === 0) return 0;
  const backward = coveredLength(b, new SegmentGrid(a, cell));
  return Math.round(Math.min(forward, backward) * 1000) / 1000;
}

export type DuplicateLine = {
  id: string;
  /** Measured length of the line's centrelines (the quantity the reading proposed). */
  measured_m: number;
  quantity: number;
  /** Item of an applied job: its quantity can no longer change. */
  frozen: boolean;
};

export type DuplicatePair = { left: string; right: string; overlap_m: number };

/**
 * Which pairs are settled: each line's reduction (measured − quantity) pays for the common lengths of its pairs,
 * largest pairs first; a frozen line (applied job) pays first when its reduction covers the pair, since it can no
 * longer change, then the other. A reduction pays once: a line reduced by 1 m against two partners of 1 m settles
 * one pair.
 */
export function settlePairs(pairs: readonly DuplicatePair[], lines: ReadonlyMap<string, DuplicateLine>): Set<DuplicatePair> {
  const remaining = new Map([...lines.values()].map((line) => [line.id, Math.max(0, line.measured_m - line.quantity)]));
  const settled = new Set<DuplicatePair>();
  const ordered = [...pairs].sort((left, right) => right.overlap_m - left.overlap_m
    || (left.left < right.left ? -1 : left.left > right.left ? 1 : 0) || (left.right < right.right ? -1 : left.right > right.right ? 1 : 0));
  for (const pair of ordered) {
    const need = pair.overlap_m - ZONE_OVERLAP.settle_m;
    // A frozen line already counted its quantity: its reduction is its own, spent before the other's.
    const sides = [pair.left, pair.right].sort((a, b) => Number(lines.get(b)?.frozen ?? false) - Number(lines.get(a)?.frozen ?? false));
    const payer = sides.find((id) => (remaining.get(id) ?? 0) >= need);
    if (payer === undefined) continue;
    remaining.set(payer, (remaining.get(payer) ?? 0) - pair.overlap_m);
    settled.add(pair);
  }
  return settled;
}

import { applyTransform } from "@/lib/takeoff/rules/registration";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { BAND_MAX_PT } from "@/lib/takeoff/vectors/measure";
import type { TakeoffFrameTransform } from "@/lib/takeoff/rules/types";

// Duplicate runs between plans of one level (TI-664 step 1, Z1/Z2): two
// lines of the same network and DN on two pages, brought into one frame,
// whose centrelines run within ZONE_OVERLAP.distance_m of each other along a
// common length of at least ZONE_OVERLAP.minLength_m. That common length is
// counted twice by the version: the rule fails the lines until it is removed
// (settleDuplicates: a group of duplicates is settled when the lines'
// reductions cover what it counts k − 1 times too many), or a line excluded,
// or the user accepts it.
// - Common length: along each centreline of a line, the union of the
//   stretches a centreline of the other line covers (parallel within
//   ZONE_OVERLAP.angle_deg, within the distance at both ends of the stretch),
//   so that two runs of the other line over one stretch count it once; the
//   smaller of both directions. Covered stretches meeting end to end (within
//   the distance) form one continuous stretch; one shorter than the minimum
//   common length is a touch and counts nothing, however many touches a line
//   has.
// - Lines of one page are never compared with each other (the reading already
//   merges a run drawn twice on a page); pages of different levels never.
// - Two runs abutting at the zone limit overlap by at most one band of the
//   drawing (BAND_MAX_PT on the sheet): the minimum common length is the larger
//   of ZONE_OVERLAP.minLength_m and that band at the coarser page scale.

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
   * At a coarser scale the band itself is the floor (minCommonLength).
   */
  minLength_m: 0.3,
  /** Two centrelines more than this angle apart are not one run. */
  angle_deg: 2,
  /**
   * A reduction this close to the common length settles it: quantities are rounded to the centimetre, so a group
   * settles within this much per line reduced.
   */
  settle_m: 0.01,
} as const;

export type Centreline = [number, number, number, number];

/**
 * The common length two pages must share for a duplicate: ZONE_OVERLAP.minLength_m, or more than one band of the
 * drawing at the coarser of their scales (49 cm at 1/200), since runs abutting at the zone limit overlap by a band.
 */
export function minCommonLength(denominators: ReadonlyArray<number | null | undefined>) {
  const coarser = Math.max(0, ...denominators.filter((value): value is number => typeof value === "number" && value > 0));
  const band = (BAND_MAX_PT * MM_PER_POINT * coarser) / 1000;
  return Math.max(ZONE_OVERLAP.minLength_m, band + ZONE_OVERLAP.settle_m);
}

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

/**
 * Centrelines indexed by pieces of at most one cell, each listed in the cells of its own box: a long diagonal run
 * costs its length in cells, never the area of its box (a levelled site plan holds runs of hundreds of metres).
 */
class SegmentGrid {
  private readonly cells = new Map<string, number[]>();
  constructor(readonly segments: readonly Centreline[], private readonly cell: number) {
    segments.forEach((segment, id) => {
      for (const [x0, y0, x1, y1] of pieces(segment, cell)) {
        for (let cx = Math.floor(Math.min(x0, x1) / cell); cx <= Math.floor(Math.max(x0, x1) / cell); cx += 1) {
          for (let cy = Math.floor(Math.min(y0, y1) / cell); cy <= Math.floor(Math.max(y0, y1) / cell); cy += 1) {
            const key = `${cx},${cy}`;
            const list = this.cells.get(key);
            if (!list) this.cells.set(key, [id]);
            else if (list[list.length - 1] !== id) list.push(id);
          }
        }
      }
    });
  }

  near(segment: Centreline, margin: number): number[] {
    const found = new Set<number>();
    for (const [x0, y0, x1, y1] of pieces(segment, this.cell)) {
      for (let cx = Math.floor((Math.min(x0, x1) - margin) / this.cell); cx <= Math.floor((Math.max(x0, x1) + margin) / this.cell); cx += 1) {
        for (let cy = Math.floor((Math.min(y0, y1) - margin) / this.cell); cy <= Math.floor((Math.max(y0, y1) + margin) / this.cell); cy += 1) {
          for (const id of this.cells.get(`${cx},${cy}`) ?? []) found.add(id);
        }
      }
    }
    return [...found];
  }
}

/** A centreline cut into pieces of at most `size` (finite coordinates only). */
function pieces([x0, y0, x1, y1]: Centreline, size: number): Centreline[] {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return [];
  const count = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / size));
  return Array.from({ length: count }, (_, index): Centreline => [
    x0 + ((x1 - x0) * index) / count, y0 + ((y1 - y0) * index) / count,
    x0 + ((x1 - x0) * (index + 1)) / count, y0 + ((y1 - y0) * (index + 1)) / count,
  ]);
}

/** The union of [start, end] intervals, as disjoint intervals in order. */
function union(intervals: Array<[number, number]>) {
  intervals.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of intervals) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.filter(([a, b]) => b > a);
}

/**
 * Total length of the continuous stretches at least `minimum` long: covered stretches meeting end to end (an end
 * within ZONE_OVERLAP.distance_m of another's) are one stretch, so a run drawn in short legs keeps its length and
 * touches at the zone limit never add up.
 */
function continuousLength(stretches: readonly Centreline[], minimum: number) {
  const lengths = stretches.map(([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0));
  if (minimum <= 0) return lengths.reduce((sum, length) => sum + length, 0);
  const parent = stretches.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]];
    return index;
  };
  const cell = 1;
  const ends = new Map<string, Array<[number, number, number]>>();
  const reach = ZONE_OVERLAP.distance_m;
  stretches.forEach(([x0, y0, x1, y1], index) => {
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      for (let cx = Math.floor((x - reach) / cell); cx <= Math.floor((x + reach) / cell); cx += 1) {
        for (let cy = Math.floor((y - reach) / cell); cy <= Math.floor((y + reach) / cell); cy += 1) {
          for (const [other, ox, oy] of ends.get(`${cx},${cy}`) ?? []) {
            if (Math.hypot(ox - x, oy - y) <= reach) parent[find(other)] = find(index);
          }
        }
      }
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      ends.set(key, [...(ends.get(key) ?? []), [index, x, y]]);
    }
  });
  const totals = new Map<number, number>();
  lengths.forEach((length, index) => totals.set(find(index), (totals.get(find(index)) ?? 0) + length));
  return [...totals.values()].filter((length) => Math.round(length * 1000) / 1000 >= minimum).reduce((sum, length) => sum + length, 0);
}

/** Stretches of `line` covered by `other` (one direction), both already in one frame. */
function coveredStretches(line: readonly Centreline[], other: SegmentGrid): Centreline[] {
  const { distance_m: distance, angle_deg: angle } = ZONE_OVERLAP;
  const sinMax = Math.sin((angle * Math.PI) / 180);
  const stretches: Centreline[] = [];
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
    for (const [lo, hi] of union(intervals)) stretches.push([x0 + ux * lo, y0 + uy * lo, x0 + ux * hi, y0 + uy * hi]);
  }
  return stretches;
}

/**
 * Common length of two lines of two pages, each brought into the common frame by its page transform: the continuous
 * stretches of at least `minimum` (minCommonLength), the smaller of both directions.
 */
export function commonLength(left: OverlapLine, leftTransform: TakeoffFrameTransform, right: OverlapLine,
  rightTransform: TakeoffFrameTransform, minimum = 0): number {
  const a = transformed(left.segments, leftTransform);
  const b = transformed(right.segments, rightTransform);
  if (a.length === 0 || b.length === 0) return 0;
  const cell = 1;
  const forward = continuousLength(coveredStretches(a, new SegmentGrid(b, cell)), minimum);
  if (forward === 0) return 0;
  const backward = continuousLength(coveredStretches(b, new SegmentGrid(a, cell)), minimum);
  return Math.round(Math.min(forward, backward) * 1000) / 1000;
}

export type DuplicatePair = { left: string; right: string; overlap_m: number };

/**
 * Length of `line` covered by any of `others`, all brought into the common frame by their page transforms: the
 * continuous stretches of at least `minimum`.
 */
export function coveredBy(line: OverlapLine, transform: TakeoffFrameTransform,
  others: ReadonlyArray<{ line: OverlapLine; transform: TakeoffFrameTransform }>, minimum = 0): number {
  const own = transformed(line.segments, transform);
  const segments = others.flatMap((other) => transformed(other.line.segments, other.transform));
  if (own.length === 0 || segments.length === 0) return 0;
  return Math.round(continuousLength(coveredStretches(own, new SegmentGrid(segments, 1)), minimum) * 1000) / 1000;
}

/**
 * A line of a group of duplicates (the lines joined by pairs): its reduction (measured − quantity), the length of it
 * other lines of the group cover, and the length of it lines before it in the group's order cover (lines of applied
 * jobs first): the length it counts again.
 */
export type SettleLine = { id: string; frozen: boolean; reduction_m: number; covered_m: number; duplicated_m: number };

/**
 * Whether a group of duplicates is counted once: a stretch drawn on k pages is counted k − 1 times too many, the sum
 * of the lines' duplicated lengths. A line's reduction removes at most what other lines cover of it. The lines of
 * applied jobs (frozen) first pay what they count twice among themselves, which only they could remove; what their
 * reductions leave over, and the reductions of the lines that can still change, pay the rest. Each reduced line may
 * leave its centimetre of rounding (ZONE_OVERLAP.settle_m). `deficit_m`: what the version still counts twice.
 */
export function settleDuplicates(lines: readonly SettleLine[]): { settled: boolean; deficit_m: number } {
  const useful = (line: SettleLine) => Math.max(0, Math.min(line.reduction_m, line.covered_m));
  const frozen = lines.filter((line) => line.frozen);
  const current = lines.filter((line) => !line.frozen);
  const spare = Math.max(0, frozen.reduce((sum, line) => sum + useful(line), 0) - frozen.reduce((sum, line) => sum + line.duplicated_m, 0));
  const owed = current.reduce((sum, line) => sum + line.duplicated_m, 0);
  const paid = current.reduce((sum, line) => sum + useful(line), 0) + spare;
  const deficit = Math.max(0, Math.round((owed - paid) * 1000) / 1000);
  const tolerance = ZONE_OVERLAP.settle_m * Math.max(1, lines.filter((line) => useful(line) > 0).length);
  return { settled: deficit <= tolerance + 1e-9, deficit_m: deficit <= tolerance + 1e-9 ? 0 : deficit };
}

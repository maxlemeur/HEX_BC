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
//   smaller of both directions. Covered stretches that continue one another
//   form one continuous stretch: ends within the distance (a corner of the
//   run), or along the run (parallel, within the distance of its line) with a
//   gap under the minimum common length (the dashes of a dashed run, 5 cm
//   apart on B R+4). One shorter than the minimum common length is a touch and
//   counts nothing, however many touches a line has.
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

/** Tolerance on lengths compared with a threshold (coordinates are floating metres). */
const EPSILON_M = 1e-9;

/**
 * Whether two covered stretches continue one another: an end of one within ZONE_OVERLAP.distance_m of an end of the
 * other (a corner of the run), or, up to `gap` apart, along the run: parallel within ZONE_OVERLAP.angle_deg and both
 * ends of the second within the distance of the first's line (the dashes of a dashed run). Two parallel pipes side
 * by side never continue one another.
 */
function continues(a: Centreline, b: Centreline, gap: number) {
  const { distance_m: distance, angle_deg: angle } = ZONE_OVERLAP;
  const ends = [[a[0], a[1]], [a[2], a[3]]];
  const nearest = Math.min(...ends.flatMap(([x, y]) => [Math.hypot(b[0] - x, b[1] - y), Math.hypot(b[2] - x, b[3] - y)]));
  if (nearest <= distance + EPSILON_M) return true;
  if (nearest > gap + EPSILON_M) return false;
  const length = Math.hypot(a[2] - a[0], a[3] - a[1]), other = Math.hypot(b[2] - b[0], b[3] - b[1]);
  if (length === 0 || other === 0) return false;
  const ux = (a[2] - a[0]) / length, uy = (a[3] - a[1]) / length;
  if (Math.abs(ux * (b[3] - b[1]) - uy * (b[2] - b[0])) / other > Math.sin((angle * Math.PI) / 180)) return false;
  const lateral = (x: number, y: number) => Math.abs((x - a[0]) * uy - (y - a[1]) * ux);
  return lateral(b[0], b[1]) <= distance + EPSILON_M && lateral(b[2], b[3]) <= distance + EPSILON_M;
}

/** A covered stretch: on centreline `segment` of the line, from `lo` to `hi` metres along it, and its ends. */
type Stretch = { segment: number; lo: number; hi: number; at: Centreline };

/**
 * The covered stretches that belong to a continuous stretch at least `minimum` long: covered stretches that continue
 * one another (continues, with a gap under `minimum`) are one stretch, so a run drawn in short legs or dashes keeps
 * its length and touches at the zone limit never add up.
 */
function continuous(covered: readonly Stretch[], minimum: number): Stretch[] {
  if (minimum <= 0) return [...covered];
  const stretches = covered.map((entry) => entry.at);
  const lengths = covered.map((entry) => entry.hi - entry.lo);
  const parent = stretches.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]];
    return index;
  };
  const cell = 1;
  const ends = new Map<string, number[]>();
  const reach = Math.max(minimum, ZONE_OVERLAP.distance_m);
  stretches.forEach((stretch, index) => {
    const [x0, y0, x1, y1] = stretch;
    const near = new Set<number>();
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      for (let cx = Math.floor((x - reach) / cell); cx <= Math.floor((x + reach) / cell); cx += 1) {
        for (let cy = Math.floor((y - reach) / cell); cy <= Math.floor((y + reach) / cell); cy += 1) {
          for (const other of ends.get(`${cx},${cy}`) ?? []) near.add(other);
        }
      }
    }
    for (const other of near) {
      if (find(other) !== find(index) && (continues(stretches[other], stretch, minimum) || continues(stretch, stretches[other], minimum))) {
        parent[find(other)] = find(index);
      }
    }
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      const list = ends.get(key);
      if (!list) ends.set(key, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
    }
  });
  const totals = new Map<number, number>();
  lengths.forEach((length, index) => totals.set(find(index), (totals.get(find(index)) ?? 0) + length));
  return covered.filter((_, index) => (totals.get(find(index)) ?? 0) + EPSILON_M >= minimum);
}

/** Length of the union of stretches, centreline by centreline (two partners covering one stretch count it once). */
function unionLength(stretches: readonly Stretch[]) {
  const bySegment = new Map<number, Array<[number, number]>>();
  for (const { segment, lo, hi } of stretches) bySegment.set(segment, [...(bySegment.get(segment) ?? []), [lo, hi]]);
  let total = 0;
  for (const intervals of bySegment.values()) for (const [lo, hi] of union(intervals)) total += hi - lo;
  return total;
}

/** Stretches of `line` covered by `other` (one direction), both already in one frame. */
function coveredStretches(line: readonly Centreline[], other: SegmentGrid): Stretch[] {
  const { distance_m: distance, angle_deg: angle } = ZONE_OVERLAP;
  const sinMax = Math.sin((angle * Math.PI) / 180);
  const stretches: Stretch[] = [];
  for (const [index, segment] of line.entries()) {
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
    for (const [lo, hi] of union(intervals)) {
      stretches.push({ segment: index, lo, hi, at: [x0 + ux * lo, y0 + uy * lo, x0 + ux * hi, y0 + uy * hi] });
    }
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
  const forward = unionLength(continuous(coveredStretches(a, new SegmentGrid(b, cell)), minimum));
  if (forward === 0) return 0;
  const backward = unionLength(continuous(coveredStretches(b, new SegmentGrid(a, cell)), minimum));
  return Math.round(Math.min(forward, backward) * 1000) / 1000;
}

export type DuplicatePair = { left: string; right: string; overlap_m: number };

/**
 * Length of `line` covered by any of `others`, all brought into the common frame by their page transforms: for each
 * other line, the continuous stretches of at least its pair's `minimum` (minCommonLength of their two pages), then
 * their union. A coarser partner never raises the minimum of another pair.
 */
export function coveredBy(line: OverlapLine, transform: TakeoffFrameTransform,
  others: ReadonlyArray<{ line: OverlapLine; transform: TakeoffFrameTransform; minimum?: number }>): number {
  const own = transformed(line.segments, transform);
  if (own.length === 0) return 0;
  const kept = others.flatMap((other) => {
    const segments = transformed(other.line.segments, other.transform);
    return segments.length === 0 ? [] : continuous(coveredStretches(own, new SegmentGrid(segments, 1)), other.minimum ?? 0);
  });
  return Math.round(unionLength(kept) * 1000) / 1000;
}

/** A line of a group of duplicates (the lines joined by pairs) and its reduction (measured − quantity). */
export type SettleLine = { id: string; frozen: boolean; reduction_m: number };

/** A stretch of the group drawn by `lines` (k of them, each over its whole length): counted k − 1 times too many. */
export type SharedStretch = { lines: string[]; length_m: number };

/** A line of a group, in the group's order, with its partners and each pair's minimum common length. */
export type GroupMember = {
  id: string;
  line: OverlapLine;
  transform: TakeoffFrameTransform;
  partners: ReadonlyArray<{ id: string; line: OverlapLine; transform: TakeoffFrameTransform; minimum: number }>;
};

/**
 * The group's shared stretches: along each line, the pieces where the same partners cover it (each with its pair's
 * minimum, continuous stretches only), each piece taken once, on the first of its lines in the group's order. Pieces
 * drawn by the same lines are added up.
 */
export function sharedStretches(members: readonly GroupMember[]): SharedStretch[] {
  const order = new Map(members.map((member, index) => [member.id, index]));
  const stretches = new Map<string, SharedStretch>();
  for (const [index, member] of members.entries()) {
    const own = transformed(member.line.segments, member.transform);
    if (own.length === 0) continue;
    // Intervals of each centreline of the line covered by each partner.
    const covers = member.partners.map((partner) => {
      const segments = transformed(partner.line.segments, partner.transform);
      const kept = segments.length === 0 ? [] : continuous(coveredStretches(own, new SegmentGrid(segments, 1)), partner.minimum);
      return { id: partner.id, kept };
    });
    for (const segment of own.keys()) {
      const intervals = covers.map(({ id, kept }) => ({ id, spans: union(kept.filter((entry) => entry.segment === segment)
        .map((entry): [number, number] => [entry.lo, entry.hi])) }));
      const cuts = [...new Set(intervals.flatMap(({ spans }) => spans.flat()))].sort((left, right) => left - right);
      for (let cut = 0; cut + 1 < cuts.length; cut += 1) {
        const [lo, hi] = [cuts[cut], cuts[cut + 1]];
        if (hi - lo <= EPSILON_M) continue;
        const middle = (lo + hi) / 2;
        const drawers = intervals.filter(({ spans }) => spans.some(([a, b]) => a <= middle && middle <= b)).map(({ id }) => id);
        // Taken on the first line that draws it: a later line sees it again from its own side.
        if (drawers.length === 0 || drawers.some((id) => (order.get(id) ?? Infinity) < index)) continue;
        const lines = [member.id, ...drawers].sort();
        const key = lines.join("|");
        const entry = stretches.get(key);
        if (entry) entry.length_m += hi - lo;
        else stretches.set(key, { lines, length_m: hi - lo });
      }
    }
  }
  return [...stretches.values()];
}

/** Adds to `flow` a maximum flow from `source` to `sink` within `capacity` (augmenting shortest paths). */
function augment(capacity: number[][], flow: number[][], source: number, sink: number) {
  let added = 0;
  for (;;) {
    const previous = new Array<number>(capacity.length).fill(-1);
    previous[source] = source;
    const queue = [source];
    while (queue.length > 0 && previous[sink] === -1) {
      const node = queue.shift() as number;
      for (let next = 0; next < capacity.length; next += 1) {
        if (previous[next] === -1 && capacity[node][next] - flow[node][next] > EPSILON_M) {
          previous[next] = node;
          queue.push(next);
        }
      }
    }
    if (previous[sink] === -1) return added;
    let room = Infinity;
    for (let node = sink; node !== source; node = previous[node]) room = Math.min(room, capacity[previous[node]][node] - flow[previous[node]][node]);
    for (let node = sink; node !== source; node = previous[node]) {
      flow[previous[node]][node] += room;
      flow[node][previous[node]] -= room;
    }
    added += room;
  }
}

/**
 * Whether a group of duplicates is counted once. A stretch drawn by k lines is counted k − 1 times too many; a line's
 * reduction removes, of each stretch it draws, at most that stretch's length, and never anything of a stretch it does
 * not draw. Reductions are allocated to the stretches they can remove (a maximum flow): the lines of applied jobs
 * (frozen) first pay what they count twice among themselves, which only they could remove; then every reduction,
 * what is left of theirs included, pays the stretches a current line draws. Each reduced line may leave its
 * centimetre of rounding (ZONE_OVERLAP.settle_m). `deficit_m`: what the version still counts twice.
 */
export function settleDuplicates(lines: readonly SettleLine[], stretches: readonly SharedStretch[]): { settled: boolean; deficit_m: number } {
  const index = new Map(lines.map((line, position) => [line.id, position]));
  const usable = stretches.filter((stretch) => stretch.lines.length > 1 && stretch.length_m > 0 && stretch.lines.every((id) => index.has(id)));
  // Nodes: source, the lines, the stretches, sink.
  const source = 0, sink = lines.length + usable.length + 1;
  const capacity = Array.from({ length: sink + 1 }, () => new Array<number>(sink + 1).fill(0));
  const flow = Array.from({ length: sink + 1 }, () => new Array<number>(sink + 1).fill(0));
  lines.forEach((line, position) => { capacity[source][position + 1] = Math.max(0, line.reduction_m); });
  usable.forEach((stretch, position) => {
    for (const id of stretch.lines) capacity[(index.get(id) as number) + 1][lines.length + 1 + position] = stretch.length_m;
  });
  const debt = (stretch: SharedStretch) => (stretch.lines.length - 1) * stretch.length_m;
  const frozenOnly = (stretch: SharedStretch) => stretch.lines.every((id) => lines[index.get(id) as number].frozen);
  // Applied lines pay their own duplicates first; augmenting paths never take back what reached the sink.
  usable.forEach((stretch, position) => { if (frozenOnly(stretch)) capacity[lines.length + 1 + position][sink] = debt(stretch); });
  augment(capacity, flow, source, sink);
  usable.forEach((stretch, position) => { if (!frozenOnly(stretch)) capacity[lines.length + 1 + position][sink] = debt(stretch); });
  const paid = augment(capacity, flow, source, sink);
  const owed = usable.filter((stretch) => !frozenOnly(stretch)).reduce((sum, stretch) => sum + debt(stretch), 0);
  const deficit = Math.max(0, Math.round((owed - paid) * 1000) / 1000);
  const tolerance = ZONE_OVERLAP.settle_m * Math.max(1, lines.filter((line) => line.reduction_m > EPSILON_M).length);
  return { settled: deficit <= tolerance + EPSILON_M, deficit_m: deficit <= tolerance + EPSILON_M ? 0 : deficit };
}

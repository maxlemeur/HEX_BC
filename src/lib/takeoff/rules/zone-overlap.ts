import { applyTransform } from "@/lib/takeoff/rules/registration";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { BAND_MAX_PT } from "@/lib/takeoff/vectors/measure";
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
  /** A reduction this close to the common length settles it (quantities are rounded to the centimetre). */
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

const FLOW_EPSILON = 1e-9;

/** Max flow from pairs (capacity: their common length) through either line to the lines' reductions (Dinic). */
function settleFlow(pairs: readonly DuplicatePair[], budget: Map<string, number>): Map<DuplicatePair, number> {
  const lineIds = [...new Set(pairs.flatMap((pair) => [pair.left, pair.right]))].sort();
  const source = 0, sink = 1 + pairs.length + lineIds.length;
  const lineNode = new Map(lineIds.map((id, index) => [id, 1 + pairs.length + index]));
  const to: number[] = [], cap: number[] = [], head = new Array<number>(sink + 1).fill(-1), next: number[] = [];
  const edge = (from: number, target: number, capacity: number) => {
    for (const [a, b, c] of [[from, target, capacity], [target, from, 0]] as const) {
      to.push(b); cap.push(c); next.push(head[a]); head[a] = to.length - 1;
    }
    return to.length - 2;
  };
  const sourceEdges = pairs.map((pair, index) => {
    const id = edge(source, 1 + index, pair.overlap_m);
    edge(1 + index, lineNode.get(pair.left) as number, pair.overlap_m);
    edge(1 + index, lineNode.get(pair.right) as number, pair.overlap_m);
    return id;
  });
  const sinkEdges = new Map(lineIds.map((id) => [id, edge(lineNode.get(id) as number, sink, Math.max(0, budget.get(id) ?? 0))]));
  const level = new Array<number>(sink + 1);
  const cursor = new Array<number>(sink + 1);
  const push = (node: number, limit: number): number => {
    if (node === sink) return limit;
    for (; cursor[node] !== -1; cursor[node] = next[cursor[node]]) {
      const id = cursor[node];
      if (cap[id] <= FLOW_EPSILON || level[to[id]] !== level[node] + 1) continue;
      const sent = push(to[id], Math.min(limit, cap[id]));
      if (sent > FLOW_EPSILON) {
        cap[id] -= sent;
        cap[id ^ 1] += sent;
        return sent;
      }
    }
    return 0;
  };
  for (;;) {
    level.fill(-1);
    level[source] = 0;
    const queue = [source];
    for (let index = 0; index < queue.length; index += 1) {
      for (let id = head[queue[index]]; id !== -1; id = next[id]) {
        if (cap[id] > FLOW_EPSILON && level[to[id]] === -1) {
          level[to[id]] = level[queue[index]] + 1;
          queue.push(to[id]);
        }
      }
    }
    if (level[sink] === -1) break;
    for (let node = 0; node <= sink; node += 1) cursor[node] = head[node];
    while (push(source, Infinity) > FLOW_EPSILON) { /* blocking flow */ }
  }
  for (const [id, edgeId] of sinkEdges) budget.set(id, Math.max(0, budget.get(id) ?? 0) - cap[edgeId ^ 1]);
  return new Map(pairs.map((pair, index) => [pair, cap[sourceEdges[index] ^ 1]]));
}

/**
 * Which pairs are settled by the reductions (measured − quantity) of their lines: each pair needs its common
 * length removed from either line, a metre of reduction paying once. Solved as a flow, so that the reductions are
 * shared the way that settles the most length whatever the order of the lines. Pairs of two frozen lines (both
 * jobs applied) take the frozen reductions first: only they could pay them; the rest pays the other pairs.
 */
export function settlePairs(pairs: readonly DuplicatePair[], lines: ReadonlyMap<string, DuplicateLine>): Set<DuplicatePair> {
  const budget = new Map([...lines.values()].map((line) => [line.id, Math.max(0, line.measured_m - line.quantity)]));
  const frozen = (id: string) => lines.get(id)?.frozen === true;
  const settled = new Set<DuplicatePair>();
  const phases = [pairs.filter((pair) => frozen(pair.left) && frozen(pair.right)),
    pairs.filter((pair) => !(frozen(pair.left) && frozen(pair.right)))];
  for (const phase of phases) {
    if (phase.length === 0) continue;
    for (const [pair, flow] of settleFlow(phase, budget)) {
      if (flow >= pair.overlap_m - ZONE_OVERLAP.settle_m - FLOW_EPSILON) settled.add(pair);
    }
  }
  return settled;
}

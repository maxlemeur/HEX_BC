import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";
import { isNetworkClass, type GroupClass } from "@/lib/takeoff/vectors/classify";
import { lightnessSaturation, parseHexColor } from "@/lib/takeoff/vectors/colors";
import {
  SegmentIndex,
  boxContains,
  distanceToSegment,
  orientation,
  orientationGap,
  pointsToMetres,
  returnsToStart,
  segmentLength,
  type Box,
  type Point,
  type Segment,
} from "@/lib/takeoff/vectors/geometry";
import type { LabelBlock } from "@/lib/takeoff/vectors/labels";
import { commonNetwork } from "@/lib/takeoff/vectors/legend";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";

// Network lengths of a page (TI-662 step 4). A pipe is drawn as a band: two
// outlines and up to three tints, so the stroke length of a network is 2 to 4
// times its length. The measure takes the centreline:
// - the segments of each network's groups (networks apart) are put in angle classes (consecutive
//   orientations within 0.5°, a class spanning at most 3°, 0 and π being one
//   orientation), then in local offset clusters (strokes within BAND_GAP_PT
//   across that overlap along, a cluster at most BAND_MAX_PT wide), then in runs (intervals along the
//   direction merged across gaps up to RUN_GAP_PT): a run's length is the
//   union of its intervals, so overlapping or duplicated strokes count once;
// - a run no longer than 2 × BAND_MAX_PT lying across a longer run of its own
//   network (centre within its half width plus 1 pt, at 30° or more) is a cap
//   or a fitting outline, not pipe; a short pipe of another network is kept;
// - strokes in the legend boxes or in a diagram frame (a dark closed rectangle,
//   its four corners drawn, of 0.3 % to 40 % of the page holding network strokes but almost no
//   background: grey or near-white length under 5 % of the network length)
//   are not measured: samples, details and schematics are not at scale (a
//   frame is never a network stroke and is at least 10 band widths on each side);
// - labels (labels.ts) attach to a run of their network: by a leader (a dark
//   stroke starting at the label's box, along it as an underline or away from
//   it, never a wall that only passes under the label, followed over up to
//   5 joined strokes, whose far end lies within LEADER_REACH of the run), else
//   inline (the nearest run parallel to the label within 10°, 2.5 label heights away);
//   a label without network attaches to none (« à revoir »), a label without
//   DN only decides the network of a shared colour;
// - a run whose labels disagree on DN, material or insulation (sections of one
//   network touching end to end at a reducer) is cut where one of its strokes
//   ends, when exactly one such place lies between the two labels; otherwise
//   it keeps DN null (« conflict », « à revoir ») and no DN reaches it;
// - DN and material go from labelled runs to connected runs (an end within
//   JOIN_PT of another run), nearest label first; a run reached by none keeps
//   DN null (« à revoir »). A run of a shared legend colour takes the network
//   of its component's labels among its candidates, else stays « à revoir ».
// Real lengths: sheet points × 25.4/72 mm × the page's denominator; null when
// the page scale is not measurable.

export const MEASURE_RULE_VERSION = 4;
export const BAND_GAP_PT = 2.5;
export const BAND_MAX_PT = 7;
export const RUN_GAP_PT = 1;
export const JOIN_PT = 3;
/** A leader's end lies within this distance of the centreline of the pipe it names (arrowhead and half band). */
export const LEADER_REACH_PT = 8;
const ANGLE_STEP = (0.5 * Math.PI) / 180;
const ANGLE_SPAN = (3 * Math.PI) / 180;

export type NetworkRun = {
  network: NetworkCode | null;
  candidates: NetworkCode[];
  /** Centreline in page space. */
  segment: Segment;
  length_pt: number;
  width_pt: number;
  dn: number | null;
  material: MaterialCode | null;
  insulated: boolean;
  label: string | null;
  /** « conflict »: its labels disagree with no single place to cut it; DN stays null (« à revoir »). */
  attached: "label" | "propagated" | "conflict" | null;
};

export type MeasuredNetwork = {
  network: NetworkCode;
  material: MaterialCode | null;
  dn: number | null;
  /** Length of the runs the labels say are insulated (part of length_pt). */
  insulated_pt: number;
  insulated_m: number | null;
  runs: number;
  length_pt: number;
  length_m: number | null;
};

export type NetworkMeasure = {
  rule_version: number;
  runs: NetworkRun[];
  totals: MeasuredNetwork[];
  excluded: { legend_boxes: Box[]; diagram_frames: Box[]; segments: number };
  labels: { blocks: number; attached: number; unattached: number; superposed: number; incomplete: number };
};

export type RawSegment = { segment: Segment; network: NetworkCode | null; candidates: NetworkCode[] };

function isDark(color: string) {
  const rgb = parseHexColor(color);
  return rgb !== null && lightnessSaturation(rgb).lightness < 0.5;
}

/** Diagram frames: dark closed rectangles holding network strokes and almost no background. */
export function findDiagramFrames(model: PageModel, classes: readonly GroupClass[]): Box[] {
  const { extraction, groupOf, groups } = model;
  const pageArea = extraction.width * extraction.height;
  const frames: Box[] = [];
  for (const path of extraction.paths) {
    if (path.count < 4 || path.count > 6) continue;
    const shut = path.closed || returnsToStart(extraction.points, path.start, path.count);
    if (!shut) continue;
    const group = groups[groupOf[path.group]];
    // A network stroke is the pipe itself (a band drawn as a closed outline), never the frame of a detail; a hidden layer is not printed.
    if (group.hidden || !group.colors.some(isDark) || isNetworkClass(classes[groupOf[path.group]].class)) continue;
    const xs: number[] = [], ys: number[] = [];
    for (let index = path.start; index < path.start + path.count; index += 1) {
      xs.push(extraction.points[2 * index]);
      ys.push(extraction.points[2 * index + 1]);
    }
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    if (area < 0.003 * pageArea || area > 0.4 * pageArea) continue;
    if (Math.min(box.x1 - box.x0, box.y1 - box.y0) < 10 * BAND_MAX_PT) continue;
    // Axis-aligned rectangle: every point at a corner of the box, and all four corners drawn.
    const corners = new Set<number>();
    const atCorners = xs.every((x, index) => {
      const left = Math.abs(x - box.x0) < 0.5, right = Math.abs(x - box.x1) < 0.5;
      const top = Math.abs(ys[index] - box.y0) < 0.5, bottom = Math.abs(ys[index] - box.y1) < 0.5;
      if (!(left || right) || !(top || bottom)) return false;
      corners.add((right ? 1 : 0) + (bottom ? 2 : 0));
      return true;
    });
    if (atCorners && corners.size === 4 && !frames.some((frame) => Math.abs(frame.x0 - box.x0) < 1 && Math.abs(frame.y0 - box.y0) < 1 && Math.abs(frame.x1 - box.x1) < 1 && Math.abs(frame.y1 - box.y1) < 1)) frames.push(box);
  }
  if (frames.length === 0) return [];
  const network = frames.map(() => 0), background = frames.map(() => 0);
  model.segments.forEach((segment, id) => {
    const groupIndex = model.segmentGroup[id];
    const group = groups[groupIndex];
    const isNetwork = isNetworkClass(classes[groupIndex].class) || classes[groupIndex].candidates.length > 0;
    if (!isNetwork && !group.grey) return;
    const mid = { x: (segment.x0 + segment.x1) / 2, y: (segment.y0 + segment.y1) / 2 };
    const length = segmentLength(segment);
    frames.forEach((frame, index) => {
      // Strictly inside: the frame's own edges (black is grey) are not the background it holds.
      if (!boxContains({ x0: frame.x0 + 1, y0: frame.y0 + 1, x1: frame.x1 - 1, y1: frame.y1 - 1 }, mid)) return;
      if (isNetwork) network[index] += length;
      else background[index] += length;
    });
  });
  return frames.filter((_, index) => network[index] > 0 && background[index] < 0.05 * network[index]);
}

export type Run = {
  a: number; b: number; offset: number; width: number; u: Point; n: Point; network: NetworkCode | null; candidates: NetworkCode[];
  /** Ends, along u, of the strokes the run is made of: where its sections may change DN. */
  breaks: number[];
};

/**
 * Orientations in [0, π) sorted from the largest circular gap: a horizontal line
 * drawn one way is at 0+, the other way at π−; both must fall in one class.
 */
function circularOrder<T extends { theta: number }>(items: T[]): T[] {
  const sorted = [...items].sort((left, right) => left.theta - right.theta);
  if (sorted.length < 2) return sorted;
  let start = 0;
  let largest = sorted[0].theta + Math.PI - sorted[sorted.length - 1].theta;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].theta - sorted[index - 1].theta;
    if (gap > largest) {
      largest = gap;
      start = index;
    }
  }
  return [...sorted.slice(start), ...sorted.slice(0, start).map((item) => ({ ...item, theta: item.theta + Math.PI }))];
}

type Projected = { lo: number; hi: number; offset: number; member: RawSegment };

/**
 * Bands of one angle class, found locally: two strokes belong together when
 * they are within BAND_GAP_PT across and overlap (or touch within RUN_GAP_PT)
 * along; a group wider than BAND_MAX_PT (pipes side by side) is then split by
 * offset within itself only. An unrelated parallel stroke elsewhere on the
 * sheet never moves where a band starts.
 */
function localClusters(projected: readonly Projected[]): Projected[][] {
  const parent = projected.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const bins = new Map<number, number[]>();
  projected.forEach((entry, index) => {
    const key = Math.floor(entry.offset / BAND_GAP_PT);
    const list = bins.get(key);
    if (list) list.push(index);
    else bins.set(key, [index]);
  });
  for (const [key, list] of bins) {
    const pool = [...list, ...(bins.get(key + 1) ?? [])].sort((left, right) => projected[left].lo - projected[right].lo);
    let active: number[] = [];
    for (const index of pool) {
      const entry = projected[index];
      active = active.filter((other) => projected[other].hi + RUN_GAP_PT >= entry.lo);
      for (const other of active) {
        if (Math.abs(projected[other].offset - entry.offset) <= BAND_GAP_PT) parent[find(index)] = find(other);
      }
      active.push(index);
    }
  }
  const components = new Map<number, Projected[]>();
  projected.forEach((entry, index) => {
    const root = find(index);
    const list = components.get(root);
    if (list) list.push(entry);
    else components.set(root, [entry]);
  });
  const clusters: Projected[][] = [];
  for (const component of components.values()) {
    const byOffset = [...component].sort((left, right) => left.offset - right.offset);
    let start = 0;
    while (start < byOffset.length) {
      let end = start + 1;
      while (end < byOffset.length && byOffset[end].offset - byOffset[end - 1].offset <= BAND_GAP_PT
        && byOffset[end].offset - byOffset[start].offset <= BAND_MAX_PT) end += 1;
      clusters.push(byOffset.slice(start, end));
      start = end;
    }
  }
  return clusters;
}

export function bundle(raw: readonly RawSegment[]): Run[] {
  const items = circularOrder(raw.map((entry) => ({ ...entry, theta: orientation(entry.segment) })));
  const runs: Run[] = [];
  let start = 0;
  while (start < items.length) {
    let end = start + 1;
    while (end < items.length && items[end].theta - items[end - 1].theta <= ANGLE_STEP && items[end].theta - items[start].theta <= ANGLE_SPAN) end += 1;
    const members = items.slice(start, end);
    let weight = 0, sx = 0, sy = 0;
    for (const member of members) {
      const length = segmentLength(member.segment);
      // Average the doubled angle so that orientations near 0 and π agree.
      sx += length * Math.cos(2 * member.theta);
      sy += length * Math.sin(2 * member.theta);
      weight += length;
    }
    const theta = weight > 0 ? Math.atan2(sy, sx) / 2 : members[0].theta;
    const u = { x: Math.cos(theta), y: Math.sin(theta) }, n = { x: -Math.sin(theta), y: Math.cos(theta) };
    const projected: Projected[] = members.map((member) => {
      const { x0, y0, x1, y1 } = member.segment;
      const a = x0 * u.x + y0 * u.y, b = x1 * u.x + y1 * u.y;
      return { lo: Math.min(a, b), hi: Math.max(a, b), offset: ((x0 + x1) / 2) * n.x + ((y0 + y1) / 2) * n.y, member };
    });
    for (const local of localClusters(projected)) {
      const cluster = [...local].sort((left, right) => left.lo - right.lo);
      let current: (Run & { weight: number; lowOffset: number; highOffset: number }) | null = null;
      const pending: Array<Run & { weight: number; lowOffset: number; highOffset: number }> = [];
      for (const entry of cluster) {
        const length = entry.hi - entry.lo;
        if (current !== null && entry.lo <= current.b + RUN_GAP_PT) {
          current.b = Math.max(current.b, entry.hi);
          current.offset += entry.offset * length;
          current.weight += length;
          current.lowOffset = Math.min(current.lowOffset, entry.offset);
          current.highOffset = Math.max(current.highOffset, entry.offset);
          current.breaks.push(entry.lo, entry.hi);
          for (const candidate of entry.member.candidates) if (!current.candidates.includes(candidate)) current.candidates.push(candidate);
          continue;
        }
        current = { a: entry.lo, b: entry.hi, offset: entry.offset * length, weight: length, width: 0, u, n,
          lowOffset: entry.offset, highOffset: entry.offset, network: entry.member.network, candidates: [...entry.member.candidates],
          breaks: [entry.lo, entry.hi] };
        pending.push(current);
      }
      for (const run of pending) {
        runs.push({ a: run.a, b: run.b, offset: run.weight > 0 ? run.offset / run.weight : run.lowOffset, width: run.highOffset - run.lowOffset,
          u: run.u, n: run.n, network: run.network, candidates: run.candidates, breaks: run.breaks.filter((value) => value > run.a && value < run.b) });
      }
    }
    start = end;
  }
  return runs;
}

function runSegment(run: Run): Segment {
  return {
    x0: run.a * run.u.x + run.offset * run.n.x, y0: run.a * run.u.y + run.offset * run.n.y,
    x1: run.b * run.u.x + run.offset * run.n.x, y1: run.b * run.u.y + run.offset * run.n.y,
  };
}

export function dropCapsAndFittings(runs: Run[]): Run[] {
  const segments = runs.map(runSegment);
  const width = segments.reduce((max, segment) => Math.max(max, segment.x0, segment.x1), 1);
  const index = new SegmentIndex(segments, width);
  return runs.filter((run, id) => {
    const length = run.b - run.a;
    if (length > 2 * BAND_MAX_PT) return true;
    const segment = segments[id];
    const mid = { x: (segment.x0 + segment.x1) / 2, y: (segment.y0 + segment.y1) / 2 };
    return !index.near(mid, BAND_MAX_PT).some((other) => {
      if (other === id) return false;
      const host = runs[other];
      if (host.b - host.a <= length) return false;
      if (orientationGap(orientation(segments[other]), orientation(segment)) < Math.PI / 6) return false;
      return distanceToSegment(mid, segments[other]) <= host.width / 2 + 1;
    });
  });
}

function darkLeaderSegments(model: PageModel, classes: readonly GroupClass[]) {
  const leaders: Segment[] = [];
  model.segments.forEach((segment, id) => {
    const groupIndex = model.segmentGroup[id];
    if (isNetworkClass(classes[groupIndex].class) || classes[groupIndex].candidates.length > 0) return;
    if (!model.groups[groupIndex].colors.some(isDark)) return;
    leaders.push(segment);
  });
  return leaders;
}

export function leaderTips(block: LabelBlock, leaders: SegmentIndex): Point[] {
  const tips: Point[] = [];
  const h = block.height;
  const box = { x0: block.box.x0 - 1.2 * h, y0: block.box.y0 - 1.2 * h, x1: block.box.x1 + 1.2 * h, y1: block.box.y1 + 1.2 * h };
  const radius = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  for (const id of leaders.near(block.centre, radius)) {
    const segment = leaders.segments[id];
    const ends = [{ x: segment.x0, y: segment.y0 }, { x: segment.x1, y: segment.y1 }];
    const inBox = ends.map((end) => boxContains(box, end));
    // An underline starts or ends at its label: a wall that only passes under it is not one.
    const under = inBox.some(Boolean) && distanceToSegment(block.centre, segment) <= 1.2 * h
      && orientationGap(orientation(segment), ((block.angle % Math.PI) + Math.PI) % Math.PI) <= (5 * Math.PI) / 180;
    if (!under && !inBox.some(Boolean)) continue;
    for (const [endIndex, end] of ends.entries()) {
      if (!under && inBox[endIndex]) continue;
      // Follow a bent leader over up to 5 joined strokes.
      let tip = end, previous = segment;
      for (let hop = 0; hop < 5; hop += 1) {
        const next = leaders.near(tip, 0.6).map((other) => leaders.segments[other]).find((other) => other !== previous
          && (Math.hypot(other.x0 - tip.x, other.y0 - tip.y) <= 0.5 || Math.hypot(other.x1 - tip.x, other.y1 - tip.y) <= 0.5));
        if (!next) break;
        tip = Math.hypot(next.x0 - tip.x, next.y0 - tip.y) <= 0.5 ? { x: next.x1, y: next.y1 } : { x: next.x0, y: next.y0 };
        previous = next;
      }
      tips.push(tip);
    }
  }
  return tips;
}

/** Votes needed, and agreement among them, for a label vote to classify a colour group. */
export const LABEL_VOTES = { minimum: 2, agreement: 0.8 } as const;

/**
 * Label votes (keywords printed on the plan, TI-662 step 3): a colour group
 * the legend does not name, neither near-white, grey nor dark, whose strokes
 * lie at the end of the leaders of at least LABEL_VOTES.minimum labels naming
 * one network (80 % of its votes) takes that network. Plans whose legend omits
 * a network (chilled water « EG-A / EG-R » beside an air legend) are read this way.
 */
export function classifyByLabels(model: PageModel, classes: readonly GroupClass[], labels: readonly LabelBlock[]): GroupClass[] {
  const width = Math.max(model.extraction.width, 1);
  const leaders = new SegmentIndex(darkLeaderSegments(model, classes), width);
  const open = model.segments.map((_, id) => {
    const group = model.groups[model.segmentGroup[id]];
    const entry = classes[model.segmentGroup[id]];
    return entry.class === null && entry.candidates.length === 0 && group.layer === null && !group.nearWhite && !group.grey && !group.colors.some(isDark);
  });
  const candidates = new SegmentIndex(model.segments.map((segment, id) => (open[id] ? segment : { x0: NaN, y0: NaN, x1: NaN, y1: NaN })), width);
  const votes = new Map<number, Map<NetworkCode, number>>();
  for (const block of labels) {
    const network = block.label.network;
    if (network === null) continue;
    let best: { group: number; distance: number } | null = null;
    for (const tip of leaderTips(block, leaders)) {
      for (const id of candidates.near(tip, LEADER_REACH_PT)) {
        if (!open[id]) continue;
        const distance = distanceToSegment(tip, model.segments[id]);
        if (distance <= LEADER_REACH_PT && (!best || distance < best.distance)) best = { group: model.segmentGroup[id], distance };
      }
    }
    if (!best) continue;
    const tally = votes.get(best.group) ?? new Map<NetworkCode, number>();
    tally.set(network, (tally.get(network) ?? 0) + 1);
    votes.set(best.group, tally);
  }
  return classes.map((entry, group) => {
    const tally = votes.get(group);
    if (!tally) return entry;
    const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
    const [network, count] = [...tally.entries()].sort((left, right) => right[1] - left[1])[0];
    if (total < LABEL_VOTES.minimum || count / total < LABEL_VOTES.agreement) return entry;
    return { class: network, source: "label", confidence: null, candidates: [] };
  });
}

const fitsNetwork = (run: Pick<Run, "network" | "candidates">, network: NetworkCode | null) => network === null || run.network === network
  || run.candidates.includes(network) || (run.network !== null && commonNetwork([run.network, network]) === run.network);

type Attachment = { block: LabelBlock; t: number };

/**
 * Labels on the runs of their network: by a leader whose end is nearest a run (within LEADER_REACH_PT),
 * else inline, on the nearest parallel run within 2.5 label heights. Each attachment keeps its position
 * along the run (t, in the run's direction), where a change of DN is looked for.
 */
function attachLabels(runs: readonly Run[], leaders: SegmentIndex, labels: readonly LabelBlock[], width: number) {
  const segments = runs.map(runSegment);
  const index = new SegmentIndex(segments, width);
  const attached = runs.map(() => [] as Attachment[]);
  let count = 0;
  for (const block of labels) {
    // A label without network cannot say which pipe it names: it stays « à revoir ».
    if (block.label.network === null) continue;
    let best: { id: number; distance: number; at: Point } | null = null;
    for (const tip of leaderTips(block, leaders)) {
      for (const id of index.near(tip, LEADER_REACH_PT)) {
        if (!fitsNetwork(runs[id], block.label.network)) continue;
        const distance = distanceToSegment(tip, segments[id]);
        if (distance <= LEADER_REACH_PT && (!best || distance < best.distance)) best = { id, distance, at: tip };
      }
    }
    if (!best) {
      for (const id of index.near(block.centre, 2.5 * block.height)) {
        if (!fitsNetwork(runs[id], block.label.network)) continue;
        if (orientationGap(orientation(segments[id]), ((block.angle % Math.PI) + Math.PI) % Math.PI) > Math.PI / 18) continue;
        const distance = distanceToSegment(block.centre, segments[id]);
        if (distance <= 2.5 * block.height && (!best || distance < best.distance)) best = { id, distance, at: block.centre };
      }
    }
    if (!best) continue;
    count += 1;
    const run = runs[best.id];
    attached[best.id].push({ block, t: best.at.x * run.u.x + best.at.y * run.u.y });
  }
  return { labels: attached, count };
}

/** Stroke ends within RUN_GAP_PT of each other are one place. */
function places(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const groups: number[][] = [];
  for (const value of sorted) {
    const last = groups[groups.length - 1];
    if (last && value - last[last.length - 1] <= RUN_GAP_PT) last.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}

/**
 * Runs cut where their labels change DN, material or insulation: between two disagreeing labels, at the one
 * place a stroke of the run ends. No such place, or several: the run stays whole, « conflict ».
 */
function splitAtLabelChanges(runs: readonly Run[], labels: ReadonlyArray<readonly Attachment[]>) {
  const valueOf = (block: LabelBlock) => (block.label.dn === null ? null : JSON.stringify([block.label.dn, block.label.material, block.label.insulated]));
  const pieces: Array<{ run: Run; labels: Attachment[]; conflict: boolean }> = [];
  runs.forEach((run, id) => {
    const own = [...labels[id]].sort((left, right) => left.t - right.t);
    const valued = own.filter((entry) => valueOf(entry.block) !== null);
    const cuts: number[] = [];
    let conflict = false;
    for (let index = 1; index < valued.length; index += 1) {
      const left = valued[index - 1], right = valued[index];
      if (valueOf(left.block) === valueOf(right.block)) continue;
      const between = places(run.breaks.filter((value) => value > Math.max(left.t, run.a + RUN_GAP_PT) && value < Math.min(right.t, run.b - RUN_GAP_PT)));
      if (between.length === 1) cuts.push(between[0]);
      else conflict = true;
    }
    if (conflict || cuts.length === 0) {
      pieces.push({ run, labels: own, conflict });
      return;
    }
    const bounds = [run.a, ...cuts, run.b];
    for (let index = 1; index < bounds.length; index += 1) {
      const a = bounds[index - 1], b = bounds[index];
      const first = index === 1, last = index === bounds.length - 1;
      pieces.push({
        run: { ...run, a, b, breaks: run.breaks.filter((value) => value > a && value < b) },
        labels: own.filter((entry) => (first || entry.t >= a) && (last || entry.t < b)),
        conflict: false,
      });
    }
  });
  return pieces;
}

export function measureNetworks(input: {
  model: PageModel;
  classes: readonly GroupClass[];
  legendBoxes: readonly Box[];
  labels: readonly LabelBlock[];
  denominator: number | null;
}): NetworkMeasure {
  const { model, classes } = input;
  const frames = findDiagramFrames(model, classes);
  const excludedBoxes = [...input.legendBoxes, ...frames];
  const raw: RawSegment[] = [];
  let excluded = 0;
  model.segments.forEach((segment, id) => {
    const entry = classes[model.segmentGroup[id]];
    if (!isNetworkClass(entry.class) && entry.candidates.length === 0) return;
    // A near-white stroke of a network layer is background drawn in that layer, never pipe.
    if (model.segmentNearWhite[id]) return;
    const mid = { x: (segment.x0 + segment.x1) / 2, y: (segment.y0 + segment.y1) / 2 };
    if (excludedBoxes.some((box) => boxContains(box, mid))) {
      excluded += 1;
      return;
    }
    if (segmentLength(segment) <= 1e-6) return;
    raw.push({ segment, network: isNetworkClass(entry.class) ? entry.class : null, candidates: entry.candidates });
  });
  // Networks are bundled apart: two pipes of different networks side by side never make one run.
  const byNetwork = new Map<string, RawSegment[]>();
  for (const entry of raw) {
    const key = entry.network ?? `?${entry.candidates.join("+")}`;
    const list = byNetwork.get(key);
    if (list) list.push(entry);
    else byNetwork.set(key, [entry]);
  }
  // A cap or a fitting outline lies across a pipe of its own network: another network's short pipe is pipe.
  const bundled = [...byNetwork.keys()].sort().flatMap((key) => dropCapsAndFittings(bundle(byNetwork.get(key) ?? [])));
  const width = Math.max(model.extraction.width, 1);
  const leaders = new SegmentIndex(darkLeaderSegments(model, classes), width);
  const attached = attachLabels(bundled, leaders, input.labels, width);
  const pieces = splitAtLabelChanges(bundled, attached.labels);
  const runs = pieces.map((piece) => piece.run);
  const segments = runs.map(runSegment);
  const runIndex = new SegmentIndex(segments, width);
  const result: NetworkRun[] = runs.map((run, id) => ({
    network: run.network, candidates: [...run.candidates].sort(), segment: segments[id], length_pt: run.b - run.a, width_pt: run.width,
    dn: null, material: null, insulated: false, label: null, attached: pieces[id].conflict ? "conflict" : null,
  }));
  const attachedLabels = attached.count;
  const incomplete = input.labels.filter((block) => block.label.dn === null || block.label.network === null).length;
  // The label of each run: one with a DN when there is one (all of a piece's DN-bearing labels agree).
  const labelled = new Map<number, LabelBlock>();
  pieces.forEach((piece, id) => {
    for (const { block } of piece.labels) {
      const known = labelled.get(id);
      if (!known || (known.label.dn === null && block.label.dn !== null)) labelled.set(id, block);
    }
  });
  // Connectivity between runs: an end of one within JOIN_PT of another's centreline.
  const neighbours = result.map(() => [] as number[]);
  result.forEach((run, id) => {
    for (const end of [{ x: run.segment.x0, y: run.segment.y0 }, { x: run.segment.x1, y: run.segment.y1 }]) {
      for (const other of runIndex.near(end, JOIN_PT + Math.max(run.width_pt, 1))) {
        if (other === id || neighbours[id].includes(other)) continue;
        if (distanceToSegment(end, segments[other]) <= JOIN_PT + Math.max(run.width_pt, result[other].width_pt) / 2) {
          neighbours[id].push(other);
          neighbours[other].push(id);
        }
      }
    }
  });
  // Shared colours: the network of the labels of the component, among its candidates.
  const component = result.map(() => -1);
  let components = 0;
  result.forEach((_, id) => {
    if (component[id] >= 0) return;
    const queue = [id];
    component[id] = components;
    while (queue.length) {
      const current = queue.shift() as number;
      // A component joins runs of one network, or shared-colour runs of the same candidates: never across networks.
      const same = (other: NetworkRun) => (result[current].network !== null ? other.network === result[current].network
        : other.network === null && other.candidates.join() === result[current].candidates.join());
      for (const next of neighbours[current]) if (component[next] < 0 && same(result[next])) {
        component[next] = components;
        queue.push(next);
      }
    }
    components += 1;
  });
  // Every label attached to the component counts: two candidates named on one run leave it « à revoir ».
  const componentNetwork = new Map<number, NetworkCode | null>();
  pieces.forEach((piece, id) => {
    const run = result[id];
    for (const { block } of piece.labels) {
      if (run.network !== null || block.label.network === null || !run.candidates.includes(block.label.network)) continue;
      const known = componentNetwork.get(component[id]);
      componentNetwork.set(component[id], known === undefined || known === block.label.network ? block.label.network : null);
    }
  });
  result.forEach((run, id) => {
    const decided = componentNetwork.get(component[id]) ?? null;
    if (run.network === null && decided !== null && run.candidates.includes(decided)) run.network = decided;
  });
  // DN and material: from labelled runs to connected runs of the same network, nearest first (breadth first).
  const queue: number[] = [];
  for (const [id, block] of labelled) {
    const run = result[id];
    if (block.label.dn === null || run.attached === "conflict") continue;
    run.dn = block.label.dn;
    run.material = block.label.material;
    run.insulated = block.label.insulated;
    run.label = block.text;
    run.attached = "label";
    queue.push(id);
  }
  while (queue.length) {
    const current = queue.shift() as number;
    for (const next of neighbours[current]) {
      const run = result[next];
      if (run.attached !== null || run.network !== result[current].network) continue;
      run.dn = result[current].dn;
      run.material = result[current].material;
      run.insulated = result[current].insulated;
      run.label = result[current].label;
      run.attached = "propagated";
      queue.push(next);
    }
  }
  const totals = new Map<string, MeasuredNetwork>();
  for (const run of result) {
    if (run.network === null) continue;
    const key = JSON.stringify([run.network, run.material, run.dn]);
    const total = totals.get(key) ?? { network: run.network, material: run.material, dn: run.dn, runs: 0, length_pt: 0, length_m: null,
      insulated_pt: 0, insulated_m: null };
    total.runs += 1;
    total.length_pt += run.length_pt;
    if (run.insulated) total.insulated_pt += run.length_pt;
    totals.set(key, total);
  }
  const measured = [...totals.values()].map((total) => ({
    ...total, length_pt: Math.round(total.length_pt * 100) / 100, insulated_pt: Math.round(total.insulated_pt * 100) / 100,
    length_m: input.denominator === null ? null : Math.round(pointsToMetres(total.length_pt, input.denominator) * 1000) / 1000,
    insulated_m: input.denominator === null ? null : Math.round(pointsToMetres(total.insulated_pt, input.denominator) * 1000) / 1000,
  })).sort((left, right) => right.length_pt - left.length_pt);
  return {
    rule_version: MEASURE_RULE_VERSION, runs: result, totals: measured,
    excluded: { legend_boxes: [...input.legendBoxes], diagram_frames: frames, segments: excluded },
    labels: { blocks: input.labels.length, attached: attachedLabels, unattached: input.labels.length - attachedLabels,
      superposed: input.labels.filter((block) => block.superposed).length, incomplete },
  };
}

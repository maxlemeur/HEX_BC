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
//   orientation), then in offset
//   clusters (consecutive offsets across the direction within BAND_GAP_PT, a
//   cluster at most BAND_MAX_PT wide), then in runs (intervals along the
//   direction merged across gaps up to RUN_GAP_PT): a run's length is the
//   union of its intervals, so overlapping or duplicated strokes count once;
// - a run no longer than 2 × BAND_MAX_PT lying across a longer run (centre
//   within its half width plus 1 pt, at 30° or more) is a cap or a fitting
//   outline, not pipe;
// - strokes in the legend boxes or in a diagram frame (a dark closed rectangle
//   of 0.3 % to 40 % of the page holding network strokes but almost no
//   background: grey or near-white length under 5 % of the network length)
//   are not measured: samples, details and schematics are not at scale (a
//   frame is never a network stroke and is at least 10 band widths on each side);
// - labels (labels.ts) attach to a run of their network: by a leader (a dark
//   stroke passing under the label or starting at its box, followed over up to
//   5 joined strokes, whose far end lies within LEADER_REACH of the run), else
//   inline (a run parallel to the label within 10°, 2.5 label heights away);
//   a label without network attaches to none (« à revoir »), a label without
//   DN only decides the network of a shared colour;
// - DN and material go from labelled runs to connected runs (an end within
//   JOIN_PT of another run), nearest label first; a run reached by none keeps
//   DN null (« à revoir »). A run of a shared legend colour takes the network
//   of its component's labels among its candidates, else stays « à revoir ».
// Real lengths: sheet points × 25.4/72 mm × the page's denominator; null when
// the page scale is not measurable.

export const MEASURE_RULE_VERSION = 1;
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
  attached: "label" | "propagated" | null;
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
    const group = groups[groupOf[path.group]];
    // A network stroke is the pipe itself (a band drawn as a closed outline), never the frame of a detail.
    if (!group.colors.some(isDark) || isNetworkClass(classes[groupOf[path.group]].class)) continue;
    const xs: number[] = [], ys: number[] = [];
    for (let index = path.start; index < path.start + path.count; index += 1) {
      xs.push(extraction.points[2 * index]);
      ys.push(extraction.points[2 * index + 1]);
    }
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    if (area < 0.003 * pageArea || area > 0.4 * pageArea) continue;
    if (Math.min(box.x1 - box.x0, box.y1 - box.y0) < 10 * BAND_MAX_PT) continue;
    // Axis-aligned rectangle: every point on the box edges.
    const onEdge = xs.every((x, index) => Math.min(Math.abs(x - box.x0), Math.abs(x - box.x1)) < 0.5 || Math.min(Math.abs(ys[index] - box.y0), Math.abs(ys[index] - box.y1)) < 0.5);
    if (onEdge && !frames.some((frame) => Math.abs(frame.x0 - box.x0) < 1 && Math.abs(frame.y0 - box.y0) < 1 && Math.abs(frame.x1 - box.x1) < 1 && Math.abs(frame.y1 - box.y1) < 1)) frames.push(box);
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
      if (!boxContains(frame, mid)) return;
      if (isNetwork) network[index] += length;
      else background[index] += length;
    });
  });
  return frames.filter((_, index) => network[index] > 0 && background[index] < 0.05 * network[index]);
}

export type Run = { a: number; b: number; offset: number; width: number; u: Point; n: Point; network: NetworkCode | null; candidates: NetworkCode[] };

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
    const projected = members.map((member) => {
      const { x0, y0, x1, y1 } = member.segment;
      const a = x0 * u.x + y0 * u.y, b = x1 * u.x + y1 * u.y;
      return { lo: Math.min(a, b), hi: Math.max(a, b), offset: ((x0 + x1) / 2) * n.x + ((y0 + y1) / 2) * n.y, member };
    }).sort((left, right) => left.offset - right.offset);
    let clusterStart = 0;
    while (clusterStart < projected.length) {
      let clusterEnd = clusterStart + 1;
      while (clusterEnd < projected.length && projected[clusterEnd].offset - projected[clusterEnd - 1].offset <= BAND_GAP_PT
        && projected[clusterEnd].offset - projected[clusterStart].offset <= BAND_MAX_PT) clusterEnd += 1;
      const cluster = projected.slice(clusterStart, clusterEnd).sort((left, right) => left.lo - right.lo);
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
          for (const candidate of entry.member.candidates) if (!current.candidates.includes(candidate)) current.candidates.push(candidate);
          continue;
        }
        current = { a: entry.lo, b: entry.hi, offset: entry.offset * length, weight: length, width: 0, u, n,
          lowOffset: entry.offset, highOffset: entry.offset, network: entry.member.network, candidates: [...entry.member.candidates] };
        pending.push(current);
      }
      for (const run of pending) {
        runs.push({ a: run.a, b: run.b, offset: run.weight > 0 ? run.offset / run.weight : run.lowOffset, width: run.highOffset - run.lowOffset,
          u: run.u, n: run.n, network: run.network, candidates: run.candidates });
      }
      clusterStart = clusterEnd;
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
    const under = distanceToSegment(block.centre, segment) <= 1.2 * h && orientationGap(orientation(segment), ((block.angle % Math.PI) + Math.PI) % Math.PI) <= (5 * Math.PI) / 180;
    const inBox = ends.map((end) => boxContains(box, end));
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
  const runs = dropCapsAndFittings([...byNetwork.keys()].sort().flatMap((key) => bundle(byNetwork.get(key) ?? [])));
  const segments = runs.map(runSegment);
  const width = Math.max(model.extraction.width, 1);
  const runIndex = new SegmentIndex(segments, width);
  const leaders = new SegmentIndex(darkLeaderSegments(model, classes), width);
  const result: NetworkRun[] = runs.map((run, id) => ({
    network: run.network, candidates: [...run.candidates].sort(), segment: segments[id], length_pt: run.b - run.a, width_pt: run.width,
    dn: null, material: null, insulated: false, label: null, attached: null,
  }));
  const fits = (run: NetworkRun, network: NetworkCode | null) => network === null || run.network === network
    || run.candidates.includes(network) || (run.network !== null && commonNetwork([run.network, network]) === run.network);
  let attachedLabels = 0, incomplete = 0;
  const labelled = new Map<number, LabelBlock>();
  for (const block of input.labels) {
    if (block.label.dn === null || block.label.network === null) incomplete += 1;
    // A label without network cannot say which pipe it names: it stays « à revoir ».
    if (block.label.network === null) continue;
    let best: { id: number; distance: number } | null = null;
    for (const tip of leaderTips(block, leaders)) {
      for (const id of runIndex.near(tip, LEADER_REACH_PT)) {
        if (!fits(result[id], block.label.network)) continue;
        const distance = distanceToSegment(tip, segments[id]);
        if (distance <= LEADER_REACH_PT && (!best || distance < best.distance)) best = { id, distance };
      }
    }
    if (!best) {
      for (const id of runIndex.near(block.centre, 2.5 * block.height)) {
        if (!fits(result[id], block.label.network)) continue;
        if (orientationGap(orientation(segments[id]), ((block.angle % Math.PI) + Math.PI) % Math.PI) > Math.PI / 18) continue;
        const distance = distanceToSegment(block.centre, segments[id]);
        if (distance <= 2.5 * block.height && (!best || distance < best.distance)) best = { id, distance: distance + LEADER_REACH_PT };
      }
    }
    if (!best) continue;
    attachedLabels += 1;
    const known = labelled.get(best.id);
    if (!known || (known.label.dn === null && block.label.dn !== null)) labelled.set(best.id, block);
  }
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
      for (const next of neighbours[current]) if (component[next] < 0 && fits(result[next], result[current].network)) {
        component[next] = components;
        queue.push(next);
      }
    }
    components += 1;
  });
  const componentNetwork = new Map<number, NetworkCode | null>();
  for (const [id, block] of labelled) {
    const run = result[id];
    if (run.network !== null || block.label.network === null || !run.candidates.includes(block.label.network)) continue;
    const known = componentNetwork.get(component[id]);
    componentNetwork.set(component[id], known === undefined || known === block.label.network ? block.label.network : null);
  }
  result.forEach((run, id) => {
    if (run.network === null && run.candidates.length > 0) run.network = componentNetwork.get(component[id]) ?? null;
  });
  // DN and material: from labelled runs to connected runs of the same network, nearest first (breadth first).
  const queue: number[] = [];
  for (const [id, block] of labelled) {
    const run = result[id];
    if (block.label.dn === null) continue;
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

import { NETWORK_CODES, NETWORKS, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { isNetworkClass } from "@/lib/takeoff/vectors/classify";
import { isGrey, isNearWhite, lightnessSaturation, parseHexColor } from "@/lib/takeoff/vectors/colors";
import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { distanceToSegment, pointsToMetres, SegmentIndex, type Box, type Segment } from "@/lib/takeoff/vectors/geometry";
import { mergeTextLines, readLabelBlocks, type LabelBlock } from "@/lib/takeoff/vectors/labels";
import { commonNetwork, isTintOrShade } from "@/lib/takeoff/vectors/legend";
import { LEADER_REACH_PT, leaderTips } from "@/lib/takeoff/vectors/measure";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { layerSegments, networkOfSegments } from "@/lib/takeoff/vectors/vocabulary";

// The evidence of the vector groups Decisions is asked about (TI-704,
// prompt takeoff-vector-groups-v2), pure: what the measured design of
// 12/11/2026 gives the model, computed once per page from its extraction and
// keyword reading, never from a render. The images it describes are drawn by
// group-evidence-render-server.ts.
// - Legend blocks: rows « text + short coloured sample » aligned in a column,
//   with a title (légende, réseaux, nomenclature) or at least 4 rows of one
//   distinct colour each, of any text (not only network codes: an air legend,
//   a plan's own codes); and the lists « CODE - description » of a schematic
//   (≥ 3 stacked lines). Each block is rendered with its texts.
// - Plan codes: the heads of the plan's labels that print a size (« EG-A » of
//   « EG-A DN 50 »), seen at least twice, with the class the vocabulary gives.
// - Per candidate: true colours (with lightness and saturation), width, dash,
//   layer, length, share, extent, share inside a legend; the labels whose
//   leader line ends on its strokes (the measure's leader rule, for labels of
//   any code); the texts within 80 pt of its strokes; the legend rows of its
//   colour (exact, or a tint or shade); and the rules' hints: the same colour
//   as a network of the keyword reading (every colour that may carry one, so
//   that a layer is never tied by one shared colour among others; a layer
//   network's colour only when it has one), a tint or
//   shade of one, a band along one (≥ 50 % of its length parallel within 3° at
//   ≤ 4 pt), a pale colour.
// - Focus: the 100 pt cell holding most of its length outside the legends; a
//   160 pt window there (the pipe's scale) and an 800 pt one (surroundings).
// Labels attach to the nearest unclassed visible group (the candidates and
// the groups the filter keeps out, as measured), never to a classed one.
// Plan content (texts, layer names) is data: the questions say so.

export const GROUP_EVIDENCE = {
  /** A legend sample: a stroke on a text's row, 1.5 to 30 heights long, at most 1.2 high, before the next text within 40 heights. */
  sample: { minHeights: 1.5, maxHeights: 30, maxThicknessHeights: 1.2, rowHeights: 0.6, reachHeights: 40 },
  nearTextReachPt: 80,
  nearTexts: 8,
  leaderLabels: 8,
  planCodes: { minCount: 2, max: 40, maxLength: 24 },
  band: { reachPt: 4, parallelDeg: 3, minDistancePt: 0.05, minShare: 0.5, minAgreement: 0.8 },
  focus: { cellPt: 100, detailPt: 160, contextPt: 800 },
  /** Pale (TI-704 guard): lightness above 0.85, or above 0.75 with a saturation under 0.45. */
  pale: { lightness: 0.85, lightnessLow: 0.75, saturation: 0.45 },
  textChars: 120,
  labelChars: 100,
} as const;

export type LegendSample = { group: number; color: string; width: number; dash: string | null; keywordClass: string | null };
export type LegendRow = { texts: string[]; samples: LegendSample[] };
export type LegendBlock = { box: Box; rows: LegendRow[] };
export type PlanCode = { code: string; count: number; class: NetworkCode | null };
export type BandHint = { share: number; network: NetworkCode | null; agreement: number | null };
/** A network, several networks no common network covers, or none. */
export type NetworkHint = NetworkCode | NetworkCode[] | null;

export type CandidateEvidence = {
  alias: string;
  id: string;
  /** Index of the group in the page model. */
  group: number;
  stats: {
    layer: string | null; colors: string[]; width: number; dash: string | null; grey: boolean;
    length_pt: number; length_m: number | null; share: number; paths: number; segments: number; closed: number;
    bbox: [number, number, number, number] | null; in_legend_share: number; colour_words: string[];
  };
  texts: Array<{ text: string; distance: number }>;
  leader_labels: Array<{ text: string; count: number }>;
  rules: { same_colour: NetworkHint; tint_family: NetworkHint; band: BandHint };
  legend_matches: Array<{ block: number; row: number; texts: string[]; exact: boolean }>;
  /** Every visible colour pale (GROUP_EVIDENCE.pale): never a network on a colour page. */
  pale: boolean;
  /**
   * The colours that may carry a network: visible, neither grey nor near-white (the keyword networks' colours are read
   * the same way). The black strokes most layers hold never tie two of them.
   */
  keyColors: string[];
  focus: { detail: Box; context: Box };
};

export type PageEvidence = {
  mode: VectorPageReading["mode"];
  scale: { status: string; denominator: number | null };
  legend_blocks: LegendBlock[];
  plan_codes: PlanCode[];
  /** Visible layer names of a page with layers. */
  layers: string[];
  /** Colours of the keyword reading's networks (never grey nor near-white), by colour. */
  classified_colours: Record<string, NetworkHint>;
  candidates: CandidateEvidence[];
};

export type EvidenceCandidate = { alias: string; group: number; id: string; visibleLength_pt: number; share: number };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Pale (TI-704 guard): a very light colour of a colour page is never a network. */
export function isPaleColor(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return false;
  const { lightness, saturation } = lightnessSaturation(rgb);
  return lightness > GROUP_EVIDENCE.pale.lightness || (lightness > GROUP_EVIDENCE.pale.lightnessLow && saturation < GROUP_EVIDENCE.pale.saturation);
}

function horizontal(text: VectorText) {
  return Math.abs(Math.sin(text.angle)) < 0.02 && Math.cos(text.angle) > 0;
}

function pathBoxesOf(model: PageModel): Box[] {
  const { points, paths } = model.extraction;
  return paths.map((entry) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let index = entry.start; index < entry.start + entry.count; index += 1) {
      const x = points[2 * index], y = points[2 * index + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  });
}

/** Ids of items by the rows of a grid along y, for the boxes they span. */
function rowIndex(boxes: readonly Box[], cell: number) {
  const rows = new Map<number, number[]>();
  boxes.forEach((box, id) => {
    if (!Number.isFinite(box.y0)) return;
    for (let row = Math.floor(box.y0 / cell); row <= Math.floor(box.y1 / cell); row += 1) {
      const list = rows.get(row);
      if (list) list.push(id);
      else rows.set(row, [id]);
    }
  });
  return {
    near(y0: number, y1: number) {
      const found = new Set<number>();
      for (let row = Math.floor(y0 / cell); row <= Math.floor(y1 / cell); row += 1) for (const id of rows.get(row) ?? []) found.add(id);
      return [...found].sort((left, right) => left - right);
    },
  };
}

type Row = { y: number; h: number; texts: string[]; x0: number; x1: number; sampleX0: number; samples: LegendSample[] };

/** The legend blocks of a page: sample rows grouped into aligned, titled or distinct columns, then the « CODE - description » lists. */
export function readLegendBlocks(model: PageModel, reading: Pick<VectorPageReading, "groups">, lines: readonly VectorText[]): LegendBlock[] {
  const { extraction } = model;
  const boxes = pathBoxesOf(model);
  const rule = GROUP_EVIDENCE.sample;
  const flat = lines.filter(horizontal);
  if (flat.length === 0) return [];
  let minHeight = Infinity, maxHeight = 0;
  for (const text of flat) {
    minHeight = Math.min(minHeight, text.height);
    maxHeight = Math.max(maxHeight, text.height);
  }
  const cell = Math.max(2, minHeight);
  // Only a stroke thin and short enough for some text's row can be a sample: the others are never indexed.
  const paths = rowIndex(boxes.map((box) => (box.y1 - box.y0 <= rule.maxThicknessHeights * maxHeight && box.x1 - box.x0 >= rule.minHeights * minHeight
    && box.x1 - box.x0 <= rule.maxHeights * maxHeight ? box : { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })), cell);
  const texts = rowIndex(flat.map((text) => ({ x0: text.x, y0: text.y - text.height, x1: text.x + text.width, y1: text.y })), cell);
  const rows: Row[] = [];
  for (const text of flat) {
    const h = text.height;
    const centre = text.y - h / 2;
    const end = text.x + text.width;
    const sameRow = texts.near(centre - 2 * h, centre + 2 * h).map((id) => flat[id])
      .filter((other) => other !== text && Math.abs(other.y - other.height / 2 - centre) <= rule.rowHeights * h);
    const nextText = Math.min(end + rule.reachHeights * h, ...sameRow.filter((other) => other.x > end - 0.5).map((other) => other.x));
    const previousText = Math.max(text.x - rule.reachHeights * h, ...sameRow.filter((other) => other.x + other.width < text.x + 0.5).map((other) => other.x + other.width));
    const samples: LegendSample[] = [];
    let sampleX0 = Infinity;
    for (const id of paths.near(centre - rule.rowHeights * h, centre + rule.rowHeights * h)) {
      const box = boxes[id];
      if (box.y1 - box.y0 > rule.maxThicknessHeights * h || box.x1 - box.x0 < rule.minHeights * h || box.x1 - box.x0 > rule.maxHeights * h) continue;
      if (Math.abs((box.y0 + box.y1) / 2 - centre) > rule.rowHeights * h) continue;
      const after = box.x0 >= end - 0.5 && box.x0 <= nextText;
      const before = box.x1 <= text.x + 0.5 && box.x1 >= previousText;
      if (!after && !before) continue;
      const entry = extraction.paths[id];
      const key = extraction.groups[entry.group];
      if (isNearWhite(key.color) || isGrey(key.color)) continue;
      const group = model.groupOf[entry.group];
      sampleX0 = Math.min(sampleX0, box.x0);
      if (!samples.some((sample) => sample.color === key.color && sample.width === key.width && sample.dash === key.dash)) {
        samples.push({ group, color: key.color, width: key.width, dash: key.dash, keywordClass: reading.groups[group]?.class ?? null });
      }
    }
    if (samples.length === 0) continue;
    rows.push({ y: centre, h, texts: [text.str.trim()], x0: text.x, x1: end, sampleX0, samples });
  }
  // Blocks: rows near one another (5 heights across, within 60 heights along).
  const parent = rows.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let a = 0; a < rows.length; a += 1) {
    for (let b = a + 1; b < rows.length; b += 1) {
      const h = Math.max(rows[a].h, rows[b].h);
      if (Math.abs(rows[a].y - rows[b].y) <= 5 * h && Math.abs(rows[a].x0 - rows[b].x0) <= 60 * h) parent[find(a)] = find(b);
    }
  }
  const clusters = new Map<number, Row[]>();
  rows.forEach((row, index) => clusters.set(find(index), [...(clusters.get(find(index)) ?? []), row]));
  const blocks: LegendBlock[] = [];
  const inBlocks = (text: VectorText) => blocks.some(({ box }) => text.x >= box.x0 && text.x <= box.x1 && text.y >= box.y0 && text.y <= box.y1);
  for (const cluster of clusters.values()) {
    // A legend is a column: its texts start at one x and its samples at another; the largest aligned subset is kept.
    let members: Row[] = [];
    for (const reference of cluster) {
      const aligned = cluster.filter((row) => Math.abs(row.x0 - reference.x0) <= 2 * reference.h && Math.abs(row.sampleX0 - reference.sampleX0) <= 3 * reference.h);
      if (aligned.length > members.length) members = aligned;
    }
    if (members.length < 2) continue;
    const hh = Math.max(...members.map((row) => row.h));
    const top = Math.min(...members.map((row) => row.y)) - 10 * hh, bottom = Math.max(...members.map((row) => row.y)) + hh;
    const left = Math.min(...members.map((row) => Math.min(row.x0, row.sampleX0))) - 30 * hh, right = Math.max(...members.map((row) => row.x1)) + 40 * hh;
    const titled = flat.some((text) => /l[ée]gende|legend|r[ée]seaux|nomenclature/i.test(text.str) && text.y >= top && text.y <= bottom && text.x >= left && text.x <= right);
    const singles = members.filter((row) => new Set(row.samples.map((sample) => sample.color)).size === 1);
    const distinct = new Set(singles.map((row) => row.samples[0].color)).size;
    if (!titled && members.length < 3) continue;
    if (!titled && !(members.length >= 4 && singles.length >= 0.8 * members.length && distinct === singles.length)) continue;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const row of members) {
      box.x0 = Math.min(box.x0, row.x0);
      box.x1 = Math.max(box.x1, row.x1);
      box.y0 = Math.min(box.y0, row.y - row.h);
      box.y1 = Math.max(box.y1, row.y + row.h);
    }
    // The samples' extent and the texts of the block (a title above, a code between the name and its sample).
    box.x1 += 30 * hh;
    box.x0 -= 25 * hh;
    box.y0 -= 5 * hh;
    box.y1 += 1.5 * hh;
    // The texts of each row inside the block, left to right (a name then its code).
    for (const row of members) {
      row.texts = [...new Set(flat.filter((text) => Math.abs(text.y - text.height / 2 - row.y) <= rule.rowHeights * row.h && text.x >= box.x0 && text.x <= box.x1)
        .sort((first, second) => first.x - second.x).map((text) => text.str.trim()))];
    }
    blocks.push({ box, rows: [...members].sort((first, second) => first.y - second.y).map((row) => ({ texts: row.texts, samples: row.samples })) });
  }
  // Lists of a schematic: at least 3 stacked lines « CODE - description », without samples.
  const listed = flat.filter((text) => /^\s*[A-Z][A-Z0-9./]*(?:[ -][A-Z0-9]+)*\s+-\s+[A-Za-zÀ-ÿ]/.test(text.str) && !inBlocks(text));
  const listParent = listed.map((_, index) => index);
  const listFind = (index: number): number => (listParent[index] === index ? index : (listParent[index] = listFind(listParent[index])));
  for (let a = 0; a < listed.length; a += 1) {
    for (let b = a + 1; b < listed.length; b += 1) {
      const h = Math.max(listed[a].height, listed[b].height);
      if (Math.abs(listed[a].y - listed[b].y) <= 4 * h && Math.abs(listed[a].x - listed[b].x) <= 40 * h) listParent[listFind(a)] = listFind(b);
    }
  }
  const lists = new Map<number, VectorText[]>();
  listed.forEach((text, index) => lists.set(listFind(index), [...(lists.get(listFind(index)) ?? []), text]));
  for (const members of lists.values()) {
    if (members.length < 3) continue;
    const h = Math.max(...members.map((text) => text.height));
    const box = { x0: Math.min(...members.map((text) => text.x)) - 12 * h, y0: Math.min(...members.map((text) => text.y)) - 4 * h,
      x1: Math.max(...members.map((text) => text.x + text.width)) + 2 * h, y1: Math.max(...members.map((text) => text.y)) + 1.5 * h };
    blocks.push({ box, rows: [...members].sort((first, second) => first.y - second.y || first.x - second.x).map((text) => ({ texts: [text.str.trim()], samples: [] })) });
  }
  return blocks;
}

const SIZE = /(\bDN\s?\d|[øØ]\s?\d|\bD\s?\d{2,3}\b)/;

/** The head of a label that prints a size (« EG-A » of « EG-A DN 50 »), or null. */
export function labelHeadCode(text: string): string | null {
  const trimmed = text.trim();
  if (!SIZE.test(trimmed)) return null;
  const head = trimmed.split(/\s+-\s+|\s+/)[0]?.replace(/[:;,]+$/, "");
  if (!head || head.length > GROUP_EVIDENCE.planCodes.maxLength || !/^[A-Za-zÀ-ÿ]/.test(head) || /^(DN|D|ø|Ø)$/i.test(head)) return null;
  return head;
}

/** Codes at the head of the plan's labels outside the legends, seen at least twice, most frequent first, with their vocabulary class. */
export function readPlanCodes(blocks: readonly LabelBlock[], inLegend: (x: number, y: number) => boolean): PlanCode[] {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (inLegend(block.centre.x, block.centre.y)) continue;
    const head = labelHeadCode(block.text);
    if (head) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= GROUP_EVIDENCE.planCodes.minCount)
    .sort((left, right) => right[1] - left[1]).slice(0, GROUP_EVIDENCE.planCodes.max)
    .map(([code, count]) => ({ code, count, class: networkOfSegments(layerSegments(code)) }));
}

function colourWords(hex: string) {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const { lightness, saturation } = lightnessSaturation(rgb);
  return `${hex} (luminosité ${round(lightness, 2)}, saturation ${round(saturation, 2)})`;
}

const NONE: Segment = { x0: Number.NaN, y0: Number.NaN, x1: Number.NaN, y1: Number.NaN };

/**
 * The evidence of a page's candidates. `unclassed`: the groups labels may attach to (the candidates and those the
 * filter leaves out); the candidates by default.
 */
export function buildGroupEvidence(model: PageModel, reading: VectorPageReading, candidates: readonly EvidenceCandidate[],
  unclassed: ReadonlySet<number> = new Set(candidates.map((candidate) => candidate.group))): PageEvidence {
  const { extraction } = model;
  const page: Omit<PageEvidence, "candidates" | "legend_blocks" | "plan_codes"> = {
    mode: reading.mode, scale: { status: reading.scale.status, denominator: reading.scale.denominator },
    layers: extraction.layers.filter((layer) => layer.visible).map((layer) => layer.name), classified_colours: {},
  };
  // Colours of the keyword reading's networks.
  const networkOf = reading.groups.map((group) => (isNetworkClass(group.class) ? group.class : null));
  // A network's colour: a colour group's own, or a layer's when it has a single one (a layer of several holds symbols
  // and fittings in the standard CAD colours other layers use too).
  const colourNetworks = new Map<string, NetworkCode[]>();
  reading.groups.forEach((group, index) => {
    const network = networkOf[index];
    if (!network || model.groups[index]?.hidden) return;
    const keys = group.colors.filter((color) => !isNearWhite(color) && !isGrey(color));
    if (model.groups[index].layer !== null && keys.length !== 1) return;
    for (const color of keys) colourNetworks.set(color, [...(colourNetworks.get(color) ?? []), network]);
  });
  const hintOf = (networks: readonly NetworkCode[]): NetworkHint => (networks.length === 0 ? null : commonNetwork(networks) ?? [...new Set(networks)]);
  page.classified_colours = Object.fromEntries([...colourNetworks.entries()].map(([color, networks]) => [color, hintOf(networks)]));
  if (reading.mode === "raster" || candidates.length === 0) return { ...page, legend_blocks: [], plan_codes: [], candidates: [] };
  const lines = mergeTextLines(extraction.texts);
  const blocks = readLegendBlocks(model, reading, lines);
  const inLegend = (x: number, y: number) => blocks.some(({ box }) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)
    || reading.legend.boxes.some((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
  const labelBlocks = readLabelBlocks(extraction.texts);
  const planCodes = readPlanCodes(labelBlocks, inLegend);
  const width = Math.max(extraction.width, 1);
  // Labels whose leader (a dark stroke of a group the keywords did not make a network, followed over joined strokes) ends on an unclassed group.
  const dark = model.groups.map((group, index) => !networkOf[index] && group.colors.some((color) => {
    const rgb = parseHexColor(color);
    return rgb !== null && lightnessSaturation(rgb).lightness < 0.5;
  }));
  const leaderIndex = new SegmentIndex(model.segments.map((segment, id) => (dark[model.segmentGroup[id]] ? segment : NONE)), width);
  const unclassedIndex = new SegmentIndex(model.segments.map((segment, id) => (unclassed.has(model.segmentGroup[id]) && !model.segmentNearWhite[id] ? segment : NONE)), width);
  const attached = new Map<number, Map<string, number>>();
  for (const block of labelBlocks) {
    if (inLegend(block.centre.x, block.centre.y)) continue;
    let best: { group: number; distance: number } | null = null;
    for (const tip of leaderTips(block, leaderIndex)) {
      for (const id of unclassedIndex.near(tip, LEADER_REACH_PT)) {
        const distance = distanceToSegment(tip, model.segments[id]);
        if (distance <= LEADER_REACH_PT && (!best || distance < best.distance)) best = { group: model.segmentGroup[id], distance };
      }
    }
    if (!best) continue;
    const tally = attached.get(best.group) ?? new Map<string, number>();
    const text = block.text.slice(0, GROUP_EVIDENCE.labelChars);
    tally.set(text, (tally.get(text) ?? 0) + 1);
    attached.set(best.group, tally);
  }
  // Network segments of the keyword reading, for the band hint.
  const networkIds = model.segments.flatMap((_, id) => (networkOf[model.segmentGroup[id]] !== null && !model.segmentNearWhite[id] ? [id] : []));
  // Cells of twice the band's reach: a query meets few network segments (the default 24 pt cells hold hundreds on a dense plan).
  const networkIndex = new SegmentIndex(networkIds.map((id) => model.segments[id]), width, 2 * GROUP_EVIDENCE.band.reachPt);
  const parallel = Math.sin((GROUP_EVIDENCE.band.parallelDeg * Math.PI) / 180);
  // Each candidate's own visible segments and paths, gathered once.
  const wanted = new Set(candidates.map((candidate) => candidate.group));
  const ownSegments = new Map<number, number[]>(candidates.map((candidate) => [candidate.group, []]));
  model.segments.forEach((_, id) => {
    if (!model.segmentNearWhite[id]) ownSegments.get(model.segmentGroup[id])?.push(id);
  });
  const bandOf = (groupIndex: number): BandHint => {
    let total = 0;
    const banded = new Map<NetworkCode, number>();
    for (const id of ownSegments.get(groupIndex) ?? []) {
      const segment = model.segments[id];
      const dx = segment.x1 - segment.x0, dy = segment.y1 - segment.y0;
      const length = Math.hypot(dx, dy);
      if (length <= 0) continue;
      total += length;
      const mid = { x: (segment.x0 + segment.x1) / 2, y: (segment.y0 + segment.y1) / 2 };
      let best: { network: NetworkCode; distance: number } | null = null;
      for (const local of networkIndex.near(mid, GROUP_EVIDENCE.band.reachPt)) {
        const other = model.segments[networkIds[local]];
        const ox = other.x1 - other.x0, oy = other.y1 - other.y0;
        const otherLength = Math.hypot(ox, oy);
        if (otherLength <= 0 || Math.abs(dx * oy - dy * ox) / (length * otherLength) > parallel) continue;
        const t = ((mid.x - other.x0) * ox + (mid.y - other.y0) * oy) / (otherLength * otherLength);
        if (t < 0 || t > 1) continue;
        const distance = distanceToSegment(mid, other);
        if (distance > GROUP_EVIDENCE.band.reachPt || distance < GROUP_EVIDENCE.band.minDistancePt) continue;
        const network = networkOf[model.segmentGroup[networkIds[local]]] as NetworkCode;
        if (!best || distance < best.distance) best = { network, distance };
      }
      if (best) banded.set(best.network, (banded.get(best.network) ?? 0) + length);
    }
    const bandedTotal = [...banded.values()].reduce((sum, value) => sum + value, 0);
    const sorted = [...banded.entries()].sort((left, right) => right[1] - left[1]);
    const lead = sorted[0] ?? null;
    const compatible = lead ? sorted.filter(([network]) => commonNetwork([lead[0], network]) !== null) : [];
    const agreeing = compatible.reduce((sum, [, value]) => sum + value, 0);
    return { share: total > 0 ? round(bandedTotal / total, 3) : 0, network: lead ? commonNetwork(compatible.map(([network]) => network)) ?? lead[0] : null,
      agreement: bandedTotal > 0 ? round(agreeing / bandedTotal, 3) : null };
  };
  // Texts within reach of each candidate's strokes (outside the legends).
  const near = new Map<number, Array<{ text: string; distance: number }>>(candidates.map((candidate) => [candidate.group, []]));
  const allIndex = new SegmentIndex(model.segments.map((segment, id) => (wanted.has(model.segmentGroup[id]) && !model.segmentNearWhite[id] ? segment : NONE)), width);
  const reach = GROUP_EVIDENCE.nearTextReachPt;
  for (const line of lines) {
    if (inLegend(line.x, line.y)) continue;
    const c = Math.cos(line.angle), s = Math.sin(line.angle);
    const centre = { x: line.x + (c * line.width) / 2 + (s * line.height) / 2, y: line.y + (s * line.width) / 2 - (c * line.height) / 2 };
    const best = new Map<number, number>();
    for (const id of allIndex.near(centre, reach)) {
      const group = model.segmentGroup[id];
      if (!wanted.has(group) || model.segmentNearWhite[id]) continue;
      const distance = distanceToSegment(centre, model.segments[id]);
      if (distance <= reach && distance < (best.get(group) ?? Infinity)) best.set(group, distance);
    }
    for (const [group, distance] of best) near.get(group)?.push({ text: line.str.trim().slice(0, GROUP_EVIDENCE.textChars), distance });
  }
  const keyNearWhite = extraction.groups.map((key) => isNearWhite(key.color));
  const hiddenLayers = new Set(extraction.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const keyHidden = extraction.groups.map((key) => key.layer !== null && hiddenLayers.has(key.layer));
  const { cellPt, detailPt, contextPt } = GROUP_EVIDENCE.focus;
  const ownPaths = new Map<number, typeof extraction.paths>(candidates.map((candidate) => [candidate.group, []]));
  for (const entry of extraction.paths) {
    if (!keyNearWhite[entry.group] && !keyHidden[entry.group]) ownPaths.get(model.groupOf[entry.group])?.push(entry);
  }
  const records = candidates.map((candidate): CandidateEvidence => {
    const group = model.groups[candidate.group];
    // Focus: the cell holding most of the group's visible length outside the legends.
    const cells = new Map<string, number>();
    let lengthAll = 0, lengthInLegend = 0;
    for (const entry of ownPaths.get(candidate.group) ?? []) {
      for (let index = entry.start + 1; index < entry.start + entry.count; index += 1) {
        const x0 = extraction.points[2 * index - 2], y0 = extraction.points[2 * index - 1], x1 = extraction.points[2 * index], y1 = extraction.points[2 * index + 1];
        const length = Math.hypot(x1 - x0, y1 - y0);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        lengthAll += length;
        if (inLegend(mx, my)) {
          lengthInLegend += length;
          continue;
        }
        const key = `${Math.floor(mx / cellPt)}:${Math.floor(my / cellPt)}`;
        cells.set(key, (cells.get(key) ?? 0) + length);
      }
    }
    const [bestCell] = [...cells.entries()].sort((left, right) => right[1] - left[1]);
    const [cx, cy] = bestCell ? bestCell[0].split(":").map((value) => (Number(value) + 0.5) * cellPt) : [extraction.width / 2, extraction.height / 2];
    const visible = group.colors.filter((color) => !isNearWhite(color));
    const keyColors = visible.filter((color) => !isGrey(color));
    // Every key colour a network's: one colour of a layer shared with a network does not make the layer that network.
    const same = keyColors.length > 0 && keyColors.every((color) => colourNetworks.has(color))
      ? [...new Set(keyColors.flatMap((color) => colourNetworks.get(color) ?? []))] : [];
    const tint = [...new Set(keyColors.flatMap((color) => [...colourNetworks.entries()]
      .filter(([base]) => base !== color && isTintOrShade(color, base)).flatMap(([, networks]) => networks)))];
    const legendMatches = blocks.flatMap((block, b) => block.rows.flatMap((row, r) => (row.samples.some((sample) => visible.includes(sample.color))
      ? [{ block: b + 1, row: r + 1, texts: row.texts, exact: true }]
      : row.samples.some((sample) => visible.some((color) => isTintOrShade(color, sample.color))) ? [{ block: b + 1, row: r + 1, texts: row.texts, exact: false }] : [])));
    const unique: Array<{ text: string; distance: number }> = [];
    for (const entry of (near.get(candidate.group) ?? []).sort((left, right) => left.distance - right.distance)) {
      if (!unique.some((other) => other.text === entry.text) && unique.length < GROUP_EVIDENCE.nearTexts) unique.push({ text: entry.text, distance: round(entry.distance, 1) });
    }
    const bbox = reading.groups[candidate.group]?.bbox ?? null;
    const denominator = reading.scale.denominator;
    return {
      alias: candidate.alias, id: candidate.id, group: candidate.group,
      stats: {
        layer: group.layerName, colors: group.colors.slice(0, 6), width: group.width, dash: group.dash, grey: group.grey,
        length_pt: round(candidate.visibleLength_pt, 1), length_m: denominator ? round(pointsToMetres(candidate.visibleLength_pt, denominator), 1) : null,
        share: round(candidate.share, 4), paths: group.paths, segments: group.segments, closed: group.closed,
        bbox: bbox ? [round(bbox[0] / extraction.width, 3), round(bbox[1] / extraction.height, 3), round(bbox[2] / extraction.width, 3), round(bbox[3] / extraction.height, 3)] : null,
        in_legend_share: lengthAll > 0 ? round(lengthInLegend / lengthAll, 3) : 0,
        colour_words: visible.slice(0, 3).map(colourWords),
      },
      texts: unique,
      leader_labels: [...(attached.get(candidate.group) ?? new Map<string, number>()).entries()].sort((left, right) => right[1] - left[1])
        .slice(0, GROUP_EVIDENCE.leaderLabels).map(([text, count]) => ({ text, count })),
      rules: { same_colour: hintOf(same), tint_family: hintOf(tint), band: bandOf(candidate.group) },
      legend_matches: legendMatches,
      pale: visible.length > 0 && visible.every(isPaleColor),
      keyColors,
      focus: {
        detail: { x0: cx - detailPt / 2, y0: cy - detailPt / 2, x1: cx + detailPt / 2, y1: cy + detailPt / 2 },
        context: { x0: cx - contextPt / 2, y0: cy - contextPt / 2, x1: cx + contextPt / 2, y1: cy + contextPt / 2 },
      },
    };
  });
  return { ...page, legend_blocks: blocks, plan_codes: planCodes, candidates: records };
}

// ---------------------------------------------------------------------------
// What the model reads (takeoff-vector-groups-v2): the page JSON shared by the questions of a call, a group's JSON.

/** The answers offered besides the networks (TI-704): what each says, and the class it gives (null: « à revoir »). */
export const OTHER_ANSWERS = [
  { value: "gaine", class: "autre", short: "gaine d'air", description: "Gaine ou conduit d'air (réseau aéraulique : soufflage, reprise, extraction, air neuf, VMC, désenfumage)" },
  { value: "fond", class: "fond", short: "fond d'architecture", description: "Fond d'architecture (murs, cloisons, portes, trame, mobilier, appareils sanitaires, façade)" },
  { value: "cadre_texte", class: "texte", short: "cadre, texte, cotation", description: "Cadre, cartouche, tableau, texte, cotation, ligne de rappel ou repère" },
  { value: "symbole", class: "autre", short: "symbole ou équipement isolé", description: "Symboles ou équipements épars (vannes, appareils, diffuseurs, émetteurs), pas une canalisation continue" },
  { value: "hors_liste", class: null, short: "canalisation hors liste", description: "Canalisation réelle d'un fluide qui n'est dans aucun des réseaux proposés" },
  { value: "inconnu", class: null, short: "je ne sais pas", description: "Je ne sais pas : les preuves ne permettent pas de trancher" },
] as const;
export type OtherAnswer = (typeof OTHER_ANSWERS)[number]["value"];

/** Plan codes and legend rows that lead to a network on this page. */
function codesOfNetwork(evidence: Pick<PageEvidence, "plan_codes" | "legend_blocks">, code: NetworkCode) {
  const own = evidence.plan_codes.filter((entry) => entry.class === code).map((entry) => entry.code);
  const rows = evidence.legend_blocks.flatMap((block) => block.rows.filter((row) => row.samples.some((sample) => sample.keywordClass === code)).map((row) => row.texts.join(" ")));
  return { own, rows };
}

/** The answers of a group question: the networks with their label and the plan's codes that lead to them, then OTHER_ANSWERS. */
export function groupAnswerChoices(evidence: Pick<PageEvidence, "plan_codes" | "legend_blocks">): Array<{ value: string; description: string }> {
  return [
    ...NETWORK_CODES.map((code) => {
      const { own } = codesOfNetwork(evidence, code);
      return { value: code as string, description: `${NETWORKS[code].label}${own.length ? ` (${own.join(", ")})` : ""}` };
    }),
    ...OTHER_ANSWERS.map((entry) => ({ value: entry.value as string, description: entry.short as string })),
  ];
}

/** Bytes of a call's shared JSON at most (under the 256 KiB the Decisions adapter accepts). */
export const PAGE_JSON_MAX_BYTES = 240 * 1024;

/**
 * The page's JSON, shared by every question of a call: glossary, codes per network, legend rows, plan codes, layers,
 * classified colours; within PAGE_JSON_MAX_BYTES (legend rows and layers halved until it fits, `tronque` then said).
 */
export function pageJson(evidence: PageEvidence, legendImages: number, maxBytes: number = PAGE_JSON_MAX_BYTES): Record<string, unknown> {
  let rows = Number.POSITIVE_INFINITY;
  let layers = Number.POSITIVE_INFINITY;
  for (;;) {
    const json = pageJsonOf(evidence, legendImages, rows, layers);
    if (Buffer.byteLength(JSON.stringify(json), "utf8") <= maxBytes || (rows === 0 && layers === 0)) return json;
    const legendRows = evidence.legend_blocks.reduce((sum, block) => sum + block.rows.length, 0);
    rows = Math.floor(Math.min(rows, legendRows) / 2);
    layers = Math.floor(Math.min(layers, evidence.layers.length) / 2);
  }
}

function pageJsonOf(evidence: PageEvidence, legendImages: number, rows: number, layers: number): Record<string, unknown> {
  const legende = evidence.legend_blocks.flatMap((block, b) => block.rows.map((row, r) => ({ ligne: `b${b + 1}r${r + 1}`, textes: row.texts,
    echantillons: row.samples.map((sample) => ({ couleur: sample.color, epaisseur_pt: sample.width, tiret: sample.dash })) })));
  const trimmed = legende.length > rows || evidence.layers.length > layers;
  return {
    classes: {
      reseaux: Object.fromEntries(NETWORK_CODES.map((code) => [code, NETWORKS[code].label])),
      hors_reseau: Object.fromEntries(OTHER_ANSWERS.map((entry) => [entry.value, entry.description])),
      codes_du_plan_par_reseau: Object.fromEntries(NETWORK_CODES.flatMap((code) => {
        const { own, rows } = codesOfNetwork(evidence, code);
        return own.length || rows.length ? [[code, [...own, ...rows]]] : [];
      })),
    },
    plan: { mode: evidence.mode === "layers" ? "calques" : "couleurs", echelle: evidence.scale.denominator ? `1/${evidence.scale.denominator}` : "inconnue" },
    legende: legende.slice(0, rows),
    codes_du_plan: evidence.plan_codes.map((entry) => ({ code: entry.code, libelles: entry.count })),
    ...(evidence.mode === "layers" ? { calques: evidence.layers.slice(0, layers) } : {}),
    couleurs_deja_classees: evidence.classified_colours,
    images_de_la_demande: legendImages > 0 ? "Les images jointes à la demande sont les blocs de légende du plan, rendus avec leurs textes." : "Aucun bloc de légende lu sur ce plan.",
    ...(trimmed ? { tronque: true } : {}),
  };
}

/** A group's JSON: its statistics, labels, texts, legend rows of its colour and the rules' hints. */
export function groupJson(candidate: CandidateEvidence): Record<string, unknown> {
  const { stats } = candidate;
  return {
    groupe: candidate.alias,
    couleurs: stats.colour_words, epaisseur_pt: stats.width, tiret: stats.dash, ...(stats.layer ? { calque: stats.layer } : {}),
    longueur_m: stats.length_m, longueur_pt: stats.length_pt, part_de_la_page: stats.share, traits: stats.paths, fermes: stats.closed,
    emprise_page: stats.bbox, part_dans_une_legende: stats.in_legend_share,
    libelles_relies_par_rappel: candidate.leader_labels,
    textes_proches: candidate.texts.slice(0, 6),
    lignes_de_legende_de_meme_couleur: candidate.legend_matches.slice(0, 4).map((match) => ({ ligne: `b${match.block}r${match.row}`, textes: match.texts, exacte: match.exact })),
    indices_des_regles: {
      meme_couleur_qu_un_reseau_classe: candidate.rules.same_colour,
      teinte_d_un_reseau_classe: candidate.rules.tint_family,
      bande_le_long_d_un_reseau_classe: candidate.rules.band.network
        ? { reseau: candidate.rules.band.network, part_de_la_longueur: candidate.rules.band.share, accord: candidate.rules.band.agreement } : null,
      couleur_pale: candidate.pale,
    },
  };
}

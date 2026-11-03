import type { NetworkCode } from "@/lib/takeoff/bench/keys";
import { isGrey, isNearWhite, parseHexColor } from "@/lib/takeoff/vectors/colors";
import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { boxContains, emptyBox, extendBox, textFrame, type Box } from "@/lib/takeoff/vectors/geometry";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import { networkOfLegendCode } from "@/lib/takeoff/vectors/vocabulary";

// Legend of a page without layers (TI-662 step 3, keywords): an entry is a
// text that is a network code alone (« ECS », « EU/EV », « EG VC »),
// horizontal as the sheet reads (within 0.02 rad of one page axis, either way:
// a page turned by /Rotate 90, 180 or 270, or drawn turned, reads as drawn; a
// code written across that axis is a pipe's inline tag), with the strokes
// drawn on its row after it. The legend is read along both page axes and the
// one giving more entries is kept (on a tie, the axis most of the page's
// characters run along): vertical labels outnumbering an upright legend do not
// turn the sheet. The row is
// read in the code's own frame (along its baseline, and across it towards the
// top of its glyphs): the strokes' centre within 0.6 text height of the
// text's, after the text, within 40 heights and before the next text on the
// row, no taller than 1.5 heights, the whole sample no longer than 25 heights
// (a longer run is a pipe tagged inline on the plan): their colours are the
// network's. Black, grey and near-white strokes are never a network colour
// (table lines, frames, background).
// - A colour drawn in the samples of one network is that network's. A colour
//   drawn for two networks is shared: when one network contains the others
//   (EUV contains EU and EV; CHW contains CHW-S and CHW-R…), the colour is that
//   network's, otherwise it stays « à revoir » with its candidates, which the
//   labels may decide per run of pipe.
// - The legend box (entries and samples, plus 2 text heights) is excluded from
//   the measure.

export const LEGEND_RULE_VERSION = 3;
/** Longest legend sample, in text heights: a longer run after a code is a pipe tagged inline, not a sample. */
export const LEGEND_SAMPLE_MAX_HEIGHTS = 25;

/** The parent network of a member (EU and EV of EUV, a supply or a return of its network), as the bench's CONFOUNDED_NETWORKS. */
export const PARENT_NETWORK: Partial<Record<NetworkCode, NetworkCode>> = {
  EU: "EUV", EV: "EUV", "CHW-S": "CHW", "CHW-R": "CHW", "HW-S": "HW", "HW-R": "HW", "GLY-S": "GLY", "GLY-R": "GLY",
  "HRC-S": "HRC", "HRC-R": "HRC", "CW-S": "CW", "CW-R": "CW",
};
const PARENT = PARENT_NETWORK;

/** The network containing every one of these (itself included), or null. */
export function commonNetwork(networks: readonly NetworkCode[]): NetworkCode | null {
  const unique = [...new Set(networks)];
  if (unique.length === 1) return unique[0];
  for (const candidate of unique) {
    if (unique.every((network) => network === candidate || PARENT[network] === candidate)) return candidate;
  }
  const parents = new Set(unique.map((network) => PARENT[network] ?? network));
  return parents.size === 1 ? [...parents][0] : null;
}

/** Quarter turn (0 to 3) of a baseline within 0.02 rad of a page axis (by its sine), else null. */
function quarterOf(angle: number): number | null {
  const quarter = Math.round(angle / (Math.PI / 2));
  if (Math.abs(Math.sin(angle - (quarter * Math.PI) / 2)) > 0.02) return null;
  return ((quarter % 4) + 4) % 4;
}

/** The axis most of the page's characters run along: 0 along page x, 1 along page y (x on a tie). */
function readingAxis(texts: readonly VectorText[]) {
  const characters = [0, 0];
  for (const text of texts) {
    const quarter = quarterOf(text.angle);
    if (quarter !== null) characters[quarter % 2] += text.str.trim().length;
  }
  return characters[1] > characters[0] ? 1 : 0;
}

export type LegendEntry = { text: string; network: NetworkCode; colors: string[]; box: Box; sampleLength_pt: number };
export type LegendColor = { color: string; network: NetworkCode | null; candidates: NetworkCode[] };
export type PageLegend = { version: number; entries: LegendEntry[]; colors: LegendColor[]; boxes: Box[] };

export function readLegend(model: PageModel): PageLegend {
  // The legend along each page axis; the one with more entries is the sheet's (the characters' axis on a tie).
  const preferred = readingAxis(model.extraction.texts);
  const first = readLegendAlong(model, preferred);
  const other = readLegendAlong(model, 1 - preferred);
  return other.entries.length > first.entries.length ? other : first;
}

/** The legend read with the sheet's horizontal along page x (axis 0) or page y (axis 1). */
function readLegendAlong(model: PageModel, axis: number): PageLegend {
  const { extraction, segments, segmentGroup, groups } = model;
  const entries: LegendEntry[] = [];
  // Rows are read in the sheet's frame (along its horizontal, up across it), reversed for a code that reads the other way.
  const sheet = textFrame((axis * Math.PI) / 2);
  const codes = extraction.texts.flatMap((text) => {
    const network = networkOfLegendCode(text.str);
    const quarter = quarterOf(text.angle);
    if (!network || quarter === null || quarter % 2 !== axis || text.height <= 0) return [];
    const sign = quarter === axis ? 1 : -1;
    const start = sign * sheet.along(text.x, text.y);
    // In the code's frame: its row's centre line half a height above its baseline, its end one width along it.
    return [{ text, network, sign, cu: sign * sheet.up(text.x, text.y) + text.height / 2, end: start + text.width, h: text.height }];
  });
  if (codes.length === 0) return { version: LEGEND_RULE_VERSION, entries, colors: [], boxes: [] };
  // A row's samples end before the next text on that row (a multi-column legend puts the next code there).
  const windowEnd = codes.map((code) => Math.min(code.end + 40 * code.h, ...extraction.texts
    .filter((text) => text !== code.text && code.sign * sheet.along(text.x, text.y) > code.end
      && Math.abs(code.sign * sheet.up(text.x, text.y) + code.h / 2 - code.cu) <= 0.6 * code.h)
    .map((text) => code.sign * sheet.along(text.x, text.y))));
  const samples = codes.map(() => ({ colors: new Set<string>(), box: emptyBox(), first: Infinity, last: -Infinity }));
  segments.forEach((segment, id) => {
    const top = Math.min(segment.y0, segment.y1), bottom = Math.max(segment.y0, segment.y1);
    const left = Math.min(segment.x0, segment.x1), right = Math.max(segment.x0, segment.x1);
    // The segment in the sheet's frame: its extent along the rows (a0..a1) and across them (u0..u1).
    const along0 = sheet.along(segment.x0, segment.y0), along1 = sheet.along(segment.x1, segment.y1);
    const up0 = sheet.up(segment.x0, segment.y0), up1 = sheet.up(segment.x1, segment.y1);
    const a0 = Math.min(along0, along1), a1 = Math.max(along0, along1), u0 = Math.min(up0, up1), u1 = Math.max(up0, up1);
    for (const [index, code] of codes.entries()) {
      // In the code's own frame (reversed when it reads the other way).
      const first = code.sign > 0 ? a0 : -a1, last = code.sign > 0 ? a1 : -a0;
      const low = code.sign > 0 ? u0 : -u1, high = code.sign > 0 ? u1 : -u0;
      if (high - low > 1.5 * code.h || Math.abs((low + high) / 2 - code.cu) > 0.6 * code.h) continue;
      if (first < code.end || first > windowEnd[index] || last > windowEnd[index] + code.h) continue;
      const group = groups[segmentGroup[id]];
      for (const color of group.colors) {
        if (isNearWhite(color) || isGrey(color)) continue;
        const sample = samples[index];
        sample.colors.add(color);
        extendBox(sample.box, left, top);
        extendBox(sample.box, right, bottom);
        sample.first = Math.min(sample.first, first);
        sample.last = Math.max(sample.last, last);
      }
    }
  });
  const byColor = new Map<string, NetworkCode[]>();
  for (const [index, code] of codes.entries()) {
    const sample = samples[index];
    if (sample.colors.size === 0 || sample.last - sample.first > LEGEND_SAMPLE_MAX_HEIGHTS * code.h) continue;
    const box = { ...sample.box };
    // The top of the code's glyphs at its start: they rise along (sin, −cos) of its frame.
    extendBox(box, code.text.x + code.sign * sheet.sin * code.h, code.text.y - code.sign * sheet.cos * code.h);
    entries.push({ text: code.text.str.trim(), network: code.network, colors: [...sample.colors].sort(), box,
      sampleLength_pt: Math.max(0, sample.last - sample.first) });
    for (const color of sample.colors) byColor.set(color, [...(byColor.get(color) ?? []), code.network]);
  }
  const colors = [...byColor.entries()].map(([color, networks]) => ({
    color, network: commonNetwork(networks), candidates: [...new Set(networks)].sort(),
  })).sort((left, right) => (left.color < right.color ? -1 : 1));
  return { version: LEGEND_RULE_VERSION, entries, colors, boxes: legendBoxes(entries, axis) };
}

/** Entries close to each other form one legend box (2 text heights around: a row's thickness, across the sheet's axis). */
function legendBoxes(entries: readonly LegendEntry[], axis: number): Box[] {
  const boxes: Box[] = [];
  for (const entry of entries) {
    const margin = Math.max(4, axis === 0 ? entry.box.y1 - entry.box.y0 : entry.box.x1 - entry.box.x0);
    const grown = { x0: entry.box.x0 - margin, y0: entry.box.y0 - margin, x1: entry.box.x1 + margin, y1: entry.box.y1 + margin };
    const touching = boxes.find((box) => box.x0 <= grown.x1 && grown.x0 <= box.x1 && box.y0 <= grown.y1 && grown.y0 <= box.y1);
    if (touching) {
      extendBox(touching, grown.x0, grown.y0);
      extendBox(touching, grown.x1, grown.y1);
    } else {
      boxes.push(grown);
    }
  }
  return boxes;
}

export function inLegend(legend: PageLegend, x: number, y: number) {
  return legend.boxes.some((box) => boxContains(box, { x, y }));
}

/** Largest channel gap allowed between a colour and the tint or shade of a legend colour. */
export const TINT_TOLERANCE = 10;

/** t in [0, 1] such that color ≈ base + t × (towards − base), with its largest channel residual. */
function mixOf(color: { r: number; g: number; b: number }, base: { r: number; g: number; b: number }, towards: number) {
  const channels = [[color.r, base.r], [color.g, base.g], [color.b, base.b]] as const;
  let numerator = 0, denominator = 0;
  for (const [value, origin] of channels) {
    numerator += (value - origin) * (towards - origin);
    denominator += (towards - origin) * (towards - origin);
  }
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, numerator / denominator));
  const residual = Math.max(...channels.map(([value, origin]) => Math.abs(value - (origin + t * (towards - origin)))));
  return { t, residual };
}

/**
 * The legend colour a stroke colour is drawn in: the colour itself, or a tint
 * (mixed with white, 10 to 85 %) or shade (mixed with black, 10 to 60 %) of
 * it, as drawing tools render a pipe's outline and 3D shading. A colour close
 * to the tints of two networks takes their common network, else stays « à
 * revoir » with both as candidates. Grey and near-white colours never match.
 */
export function matchLegendColor(legend: PageLegend, color: string): LegendColor | null {
  const exact = legend.colors.find((entry) => entry.color === color);
  if (exact) return exact;
  const rgb = parseHexColor(color);
  if (!rgb || isNearWhite(color) || isGrey(color)) return null;
  const matches = legend.colors.filter((entry) => {
    const base = parseHexColor(entry.color);
    if (!base) return false;
    const tint = mixOf(rgb, base, 255), shade = mixOf(rgb, base, 0);
    return (tint.t >= 0.1 && tint.t <= 0.85 && tint.residual <= TINT_TOLERANCE)
      || (shade.t >= 0.1 && shade.t <= 0.6 && shade.residual <= TINT_TOLERANCE);
  });
  if (matches.length === 0) return null;
  const candidates = [...new Set(matches.flatMap((entry) => entry.candidates))].sort();
  return { color, network: commonNetwork(matches.flatMap((entry) => (entry.network ? [entry.network] : entry.candidates))), candidates };
}

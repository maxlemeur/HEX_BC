import { isGrey, isNearWhite } from "@/lib/takeoff/vectors/colors";
import type { VectorGroupKey, VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { emptyBox, extendBox, polylineLength, type Box, type Segment } from "@/lib/takeoff/vectors/geometry";

// Groups of one extracted page (TI-662 step 1): a group is a layer (OCG) when
// the page has layers and the stroke lies in one, otherwise a colour, width and
// dash. Statistics per group, near-white and grey flags, and the segments of
// the page with their group, for the scale, legend, label and measure passes.
// A near-white stroke stays near-white inside a layer of other colours: it is
// never measured nor counted in the detection badge. A layer hidden by the
// document's default configuration (OFF) is not printed: it is not read. Its
// group keeps its statistics, but its strokes give no segment, so no scale
// check, legend, leader or measure ever sees them.

export type GroupStats = {
  id: string;
  index: number;
  key: VectorGroupKey;
  /** Layer id, or null for a colour group. */
  layer: string | null;
  layerName: string | null;
  colors: string[];
  width: number;
  dash: string | null;
  paths: number;
  segments: number;
  length_pt: number;
  closed: number;
  bbox: Box;
  nearWhite: boolean;
  grey: boolean;
  /** Stroke length of the group without its near-white strokes (a layer may mix colours). */
  visibleLength_pt: number;
  /** A layer hidden in the document's default configuration: its content is not printed. */
  hidden: boolean;
};

export type PageModel = {
  extraction: VectorPageExtraction;
  /** One entry per group of the extraction, merged by layer when the page has layers. */
  groups: GroupStats[];
  /** Index in `groups` of each extraction group. */
  groupOf: number[];
  segments: Segment[];
  /** Group (index in `groups`) of each segment. */
  segmentGroup: Int32Array;
  /** 1 when the segment's own stroke colour is near-white (inside a layer of other colours too). */
  segmentNearWhite: Uint8Array;
  /** Stroke length of the page without near-white groups (detection badge denominator). */
  visibleLength_pt: number;
};

/** Id of an extraction group: its layer, else its colour, width and dash. */
export function groupId(key: VectorGroupKey) {
  return key.layer !== null ? `oc:${key.layer}` : `c:${key.color}|w:${key.width}|d:${key.dash ?? ""}`;
}

export function buildPageModel(extraction: VectorPageExtraction): PageModel {
  const layerNames = new Map(extraction.layers.map((layer) => [layer.id, layer.name]));
  const hiddenLayers = new Set(extraction.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const byId = new Map<string, number>();
  const groups: GroupStats[] = [];
  const groupOf = extraction.groups.map((key) => {
    const id = groupId(key);
    const known = byId.get(id);
    if (known !== undefined) {
      const group = groups[known];
      if (!group.colors.includes(key.color)) group.colors.push(key.color);
      return known;
    }
    byId.set(id, groups.length);
    groups.push({
      id, index: groups.length, key, layer: key.layer, layerName: key.layer === null ? null : layerNames.get(key.layer) ?? null,
      colors: [key.color], width: key.width, dash: key.dash, paths: 0, segments: 0, length_pt: 0, closed: 0, bbox: emptyBox(),
      nearWhite: false, grey: false, visibleLength_pt: 0, hidden: key.layer !== null && hiddenLayers.has(key.layer),
    });
    return groups.length - 1;
  });
  const { points } = extraction;
  const segments: Segment[] = [];
  const segmentGroups: number[] = [];
  const segmentNearWhite: number[] = [];
  const keyNearWhite = extraction.groups.map((key) => isNearWhite(key.color));
  const keyHidden = extraction.groups.map((key) => key.layer !== null && hiddenLayers.has(key.layer));
  for (const path of extraction.paths) {
    const group = groups[groupOf[path.group]];
    group.paths += 1;
    group.segments += path.count - 1;
    const length = polylineLength(points, path.start, path.count);
    group.length_pt += length;
    if (!keyNearWhite[path.group]) group.visibleLength_pt += length;
    if (path.closed) group.closed += 1;
    for (let index = path.start; index < path.start + path.count; index += 1) extendBox(group.bbox, points[2 * index], points[2 * index + 1]);
    if (keyHidden[path.group]) continue;
    for (let index = path.start + 1; index < path.start + path.count; index += 1) {
      segments.push({ x0: points[2 * index - 2], y0: points[2 * index - 1], x1: points[2 * index], y1: points[2 * index + 1] });
      segmentGroups.push(groupOf[path.group]);
      segmentNearWhite.push(keyNearWhite[path.group] ? 1 : 0);
    }
  }
  let visibleLength = 0;
  for (const group of groups) {
    // A layer is near-white or grey only when all its colours are.
    group.nearWhite = group.colors.every((color) => isNearWhite(color));
    group.grey = group.colors.every((color) => isGrey(color) || isNearWhite(color));
    if (!group.hidden) visibleLength += group.visibleLength_pt;
  }
  return { extraction, groups, groupOf, segments, segmentGroup: Int32Array.from(segmentGroups), segmentNearWhite: Uint8Array.from(segmentNearWhite),
    visibleLength_pt: visibleLength };
}

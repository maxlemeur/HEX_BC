import { isNearWhite, lightnessSaturation, parseHexColor } from "@/lib/takeoff/vectors/colors";
import type { Box } from "@/lib/takeoff/vectors/geometry";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";

// What the Decisions images of vector groups draw (TI-662 L3c), pure: drawn
// from the extracted geometry, never from a render of the PDF (a group of the
// sheet must be told apart from what lies on it), then rasterised by
// group-sheet-server.ts.
// - A tile is a square: an alias band on top, then the group's window (its
//   bounding box with a margin, widened to the drawing area so that nothing is
//   stretched). The group is drawn thicker in a dark rendition of its own
//   colour, over the very light grey of the other printed strokes in the
//   window (near-white ones included: the architecture background is context;
//   hidden layers are not printed).
// - Points are capped per tile, group and context apart (subsampled by path,
//   then by point, first and last points kept), so a huge group stays bounded.
// - Contact sheet: up to 36 tiles of 384 px, 6 per row. Dedicated render: one
//   group alone in a 1200 px tile.
// - Legend crop: the union of the legend boxes with a margin, clamped to the
//   page (image 1, rendered by pdfjs in renderPdfPages).

export const GROUP_SHEET = {
  tilePx: 384,
  columns: 6,
  /** Height of the alias band on top of each tile. */
  labelPx: 24,
  dedicatedPx: 1200,
  /** Margin around the group's bounding box: this share of its larger side, at least minMarginPt. */
  marginShare: 0.08,
  minMarginPt: 12,
  maxPoints: { tile: 8_000, dedicated: 40_000 },
  groupLineWidthPx: { tile: 2.5, dedicated: 3.5 },
  contextLineWidthPx: 1,
  contextColor: "#dcdcdc",
  /** Largest lightness of the group's dark rendition. */
  darkLightness: 0.3,
  jpegQualities: [80, 65, 50],
  maxBytes: 1_500_000,
  legendMaxEdgePx: 1600,
  legendMarginPt: 12,
  /** Legend boxes closer than this (edge to edge) are one legend; the crop keeps the cluster with the most boxes. */
  legendClusterGapPt: 48,
  /** A small legend is enlarged up to this scale (pt to px). */
  legendMaxScale: 4,
} as const;

export type TileKind = "tile" | "dedicated";
export type TilePlan = {
  window: Box;
  /** Dark rendition of the group's colour. */
  color: string;
  lineWidth: number;
  /** Polylines in tile pixels (x, y pairs), the group's and the context's. */
  group: number[][];
  context: number[][];
  points: { group: number; context: number; groupTotal: number; contextTotal: number };
};
export type SheetTile = { x: number; y: number; size: number; label: string; plan: TilePlan };
export type SheetPlan = { width: number; height: number; tiles: SheetTile[] };

function hex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** The colour at the same hue and saturation with its lightness at most GROUP_SHEET.darkLightness. */
export function darkRendition(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return "#202020";
  const { lightness } = lightnessSaturation(rgb);
  if (lightness <= GROUP_SHEET.darkLightness) return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
  const max = Math.max(rgb.r, rgb.g, rgb.b), min = Math.min(rgb.r, rgb.g, rgb.b);
  const spread = max - min;
  const target = GROUP_SHEET.darkLightness * 255;
  // Map the channels so that (max + min) / 2 becomes the target, the spread kept as far as the target allows.
  const half = Math.min(spread / 2, target);
  const top = target + half, bottom = target - half;
  const channel = (value: number) => (spread === 0 ? target : bottom + ((value - min) / spread) * (top - bottom));
  return `#${hex(channel(rgb.r))}${hex(channel(rgb.g))}${hex(channel(rgb.b))}`;
}

type PathRef = { start: number; count: number };

/** Up to `cap` points of these paths: every k-th path past cap / 4 paths, then every s-th point (first and last kept). */
function capPolylines(points: Float32Array, paths: readonly PathRef[], cap: number, map: (x: number, y: number) => [number, number]) {
  const total = paths.reduce((sum, path) => sum + path.count, 0);
  let kept = paths;
  if (total > cap && paths.length > cap / 4) {
    const stride = Math.ceil(paths.length / (cap / 4));
    kept = paths.filter((_, index) => index % stride === 0);
  }
  const keptTotal = kept.reduce((sum, path) => sum + path.count, 0);
  const step = keptTotal > cap ? Math.ceil(keptTotal / (cap / 2)) : 1;
  const polylines: number[][] = [];
  for (const path of kept) {
    const polyline: number[] = [];
    const last = path.start + path.count - 1;
    for (let index = path.start; index <= last; index += step) polyline.push(...map(points[2 * index], points[2 * index + 1]));
    if ((path.count - 1) % step !== 0) polyline.push(...map(points[2 * last], points[2 * last + 1]));
    if (polyline.length >= 4) polylines.push(polyline);
  }
  return { polylines, total };
}

const pathBoxCache = new WeakMap<PageModel, Float64Array>();

function pathBoxes(model: PageModel) {
  const known = pathBoxCache.get(model);
  if (known) return known;
  const { points, paths } = model.extraction;
  const boxes = new Float64Array(4 * paths.length);
  paths.forEach((path, id) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let index = path.start; index < path.start + path.count; index += 1) {
      const x = points[2 * index], y = points[2 * index + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    boxes.set([x0, y0, x1, y1], 4 * id);
  });
  pathBoxCache.set(model, boxes);
  return boxes;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The drawing of one group in a square tile of sizePx (alias band on top). */
export function planTile(model: PageModel, groupIndex: number, sizePx: number, kind: TileKind): TilePlan {
  const { extraction, groupOf } = model;
  const group = model.groups[groupIndex];
  const hiddenLayers = new Set(extraction.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const keyHidden = extraction.groups.map((key) => key.layer !== null && hiddenLayers.has(key.layer));
  const keyNearWhite = extraction.groups.map((key) => isNearWhite(key.color));
  const boxes = pathBoxes(model);
  // The group's own printed strokes (its near-white ones are background).
  const own: PathRef[] = [];
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  extraction.paths.forEach((path, id) => {
    if (groupOf[path.group] !== groupIndex || keyNearWhite[path.group] || keyHidden[path.group]) return;
    own.push(path);
    bounds.x0 = Math.min(bounds.x0, boxes[4 * id]);
    bounds.y0 = Math.min(bounds.y0, boxes[4 * id + 1]);
    bounds.x1 = Math.max(bounds.x1, boxes[4 * id + 2]);
    bounds.y1 = Math.max(bounds.y1, boxes[4 * id + 3]);
  });
  if (!Number.isFinite(bounds.x0)) Object.assign(bounds, { x0: 0, y0: 0, x1: extraction.width, y1: extraction.height });
  const margin = Math.max(GROUP_SHEET.minMarginPt, GROUP_SHEET.marginShare * Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0));
  const window = { x0: bounds.x0 - margin, y0: bounds.y0 - margin, x1: bounds.x1 + margin, y1: bounds.y1 + margin };
  const area = { x: 0, y: GROUP_SHEET.labelPx, width: sizePx, height: sizePx - GROUP_SHEET.labelPx };
  // Widen the window to the drawing area's aspect, centred: the same scale on both axes.
  const scale = Math.min(area.width / (window.x1 - window.x0), area.height / (window.y1 - window.y0));
  const extraX = area.width / scale - (window.x1 - window.x0), extraY = area.height / scale - (window.y1 - window.y0);
  window.x0 -= extraX / 2;
  window.x1 += extraX / 2;
  window.y0 -= extraY / 2;
  window.y1 += extraY / 2;
  const map = (x: number, y: number): [number, number] => [round1(area.x + (x - window.x0) * scale), round1(area.y + (y - window.y0) * scale)];
  const context: PathRef[] = [];
  extraction.paths.forEach((path, id) => {
    if (keyHidden[path.group] || (groupOf[path.group] === groupIndex && !keyNearWhite[path.group])) return;
    if (boxes[4 * id + 2] < window.x0 || boxes[4 * id] > window.x1 || boxes[4 * id + 3] < window.y0 || boxes[4 * id + 1] > window.y1) return;
    context.push(path);
  });
  const cap = GROUP_SHEET.maxPoints[kind];
  const drawn = capPolylines(extraction.points, own, cap, map);
  const around = capPolylines(extraction.points, context, cap, map);
  const count = (polylines: number[][]) => polylines.reduce((sum, polyline) => sum + polyline.length / 2, 0);
  return {
    window, color: darkRendition(group.colors.find((color) => !isNearWhite(color)) ?? group.colors[0]), lineWidth: GROUP_SHEET.groupLineWidthPx[kind],
    group: drawn.polylines, context: around.polylines,
    points: { group: count(drawn.polylines), context: count(around.polylines), groupTotal: drawn.total, contextTotal: around.total },
  };
}

/** A contact sheet: one 384 px tile per group, 6 per row, in the order given. */
export function planContactSheet(model: PageModel, groups: ReadonlyArray<{ alias: string; group: number }>): SheetPlan {
  const size = GROUP_SHEET.tilePx, columns = GROUP_SHEET.columns;
  return {
    width: columns * size,
    height: Math.max(1, Math.ceil(groups.length / columns)) * size,
    tiles: groups.map((entry, index) => ({
      x: (index % columns) * size, y: Math.floor(index / columns) * size, size, label: entry.alias, plan: planTile(model, entry.group, size, "tile"),
    })),
  };
}

/** One group alone in a 1200 px tile. */
export function planDedicated(model: PageModel, entry: { alias: string; group: number }): SheetPlan {
  const size = GROUP_SHEET.dedicatedPx;
  return { width: size, height: size, tiles: [{ x: 0, y: 0, size, label: entry.alias, plan: planTile(model, entry.group, size, "dedicated") }] };
}

/**
 * The crop of the legend: the boxes closer than GROUP_SHEET.legendClusterGapPt to one another form a legend, the one
 * with the most boxes is kept (then the larger), never the union with a stray box far from it (a lone code read as an
 * entry would make the crop a strip where the legend is a few pixels tall); with GROUP_SHEET.legendMarginPt, clamped
 * to the page; null without a legend.
 */
export function legendCrop(boxes: readonly Box[], width: number, height: number): Box | null {
  if (boxes.length === 0) return null;
  const gap = GROUP_SHEET.legendClusterGapPt;
  const parent = boxes.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const dx = Math.max(0, boxes[b].x0 - boxes[a].x1, boxes[a].x0 - boxes[b].x1);
      const dy = Math.max(0, boxes[b].y0 - boxes[a].y1, boxes[a].y0 - boxes[b].y1);
      if (dx <= gap && dy <= gap) parent[find(a)] = find(b);
    }
  }
  const clusters = new Map<number, Box[]>();
  boxes.forEach((box, index) => clusters.set(find(index), [...(clusters.get(find(index)) ?? []), box]));
  const union = (members: readonly Box[]) => ({
    x0: Math.min(...members.map((box) => box.x0)), y0: Math.min(...members.map((box) => box.y0)),
    x1: Math.max(...members.map((box) => box.x1)), y1: Math.max(...members.map((box) => box.y1)),
  });
  const area = (box: Box) => (box.x1 - box.x0) * (box.y1 - box.y0);
  const main = [...clusters.values()].map(union).map((box, index) => ({ box, count: [...clusters.values()][index].length }))
    .sort((left, right) => right.count - left.count || area(right.box) - area(left.box))[0].box;
  const margin = GROUP_SHEET.legendMarginPt;
  return { x0: Math.max(0, main.x0 - margin), y0: Math.max(0, main.y0 - margin), x1: Math.min(width, main.x1 + margin), y1: Math.min(height, main.y1 + margin) };
}

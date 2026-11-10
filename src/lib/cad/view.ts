// A drawing on a canvas: the viewport (pixels per drawing unit and the corner
// of the sheet), what is prepared once per drawing (boxes, drawing order) and
// the drawing itself. Coordinates are computed here, not by a canvas transform,
// so that a line stays one pixel wide at any zoom. The context is the part of
// CanvasRenderingContext2D the view uses, which lets the tests write down what
// is drawn.

import { CAD_PATH_CLOSED, CAD_PATH_COMPOUND, CAD_PATH_FILLED, CAD_PATH_KINDS, cadOpenGates, type CadDrawing, type CadExtents, type CadText } from "./model";
import { CAD_CAP_HEIGHT, CAD_LINE_SPACING, cadFirstBaseline, cadTextLines } from "./text-layout";

export type CadViewport = {
  /** Pixels per drawing unit. */
  scale: number;
  /** Drawing point at the top left corner of the canvas: y goes up in the drawing, down on the screen. */
  x: number;
  y: number;
};

export type CadViewLimits = { min: number; max: number };

const HATCH = CAD_PATH_KINDS.indexOf("hatch");
const PAPER = "#ffffff", INK = "#1a1a1a";
/** Brightest a colour is drawn on the white sheet (relative luminance). */
const MAX_LUMA = 0.45;
const SOLID_HATCH_ALPHA = 0.45, PATTERN_HATCH_ALPHA = 0.14;
/** In pixels: below MIN_MARK a path is not drawn, below MIN_OUTLINE it is a mark across its box, and points closer than MIN_STEP are one. */
const MIN_MARK = 0.3, MIN_OUTLINE = 2, MIN_STEP = 0.35, MIN_FILL = 0.5;
/** Capital height, in pixels, below which a text is not written. */
const MIN_TEXT = 3;
/** Paths stroked in one go: the browser slows down on longer ones. */
const STROKE_BATCH = 4000;
/** Width of a character over the capital height, on the generous side: it boxes a text whose font is not measured. */
const TEXT_WIDTH = 1;
export const CAD_VIEW_MAX_TEXTS = 6000;

/** The viewport that shows `extents` whole and centred in a canvas of `width` × `height` pixels. */
export function fitCadViewport(extents: CadExtents | null, width: number, height: number, padding = 12): CadViewport {
  const box = extents && [extents.x0, extents.y0, extents.x1, extents.y1].every(Number.isFinite) ? extents : null;
  const w = Math.max(width - 2 * padding, 1), h = Math.max(height - 2 * padding, 1);
  const dw = box ? box.x1 - box.x0 : 0, dh = box ? box.y1 - box.y0 : 0;
  const fitted = Math.min(dw > 0 ? w / dw : Infinity, dh > 0 ? h / dh : Infinity);
  const scale = Number.isFinite(fitted) && fitted > 0 ? fitted : 1;
  const cx = box ? (box.x0 + box.x1) / 2 : 0, cy = box ? (box.y0 + box.y1) / 2 : 0;
  return { scale, x: cx - width / 2 / scale, y: cy + height / 2 / scale };
}

/** How far the view zooms out and in from the fitted one. */
export function cadViewLimits(fit: CadViewport): CadViewLimits {
  return { min: fit.scale / 4, max: fit.scale * 4000 };
}

/** Zooms by `factor`, the drawing point under (sx, sy) staying there. */
export function zoomCadViewport(viewport: CadViewport, factor: number, sx: number, sy: number, limits: CadViewLimits): CadViewport {
  if (!Number.isFinite(factor) || factor <= 0) return viewport;
  const scale = Math.min(Math.max(viewport.scale * factor, limits.min), limits.max);
  return { scale, x: viewport.x + sx / viewport.scale - sx / scale, y: viewport.y - sy / viewport.scale + sy / scale };
}

/** Moves the sheet by (dx, dy) pixels. */
export function panCadViewport(viewport: CadViewport, dx: number, dy: number): CadViewport {
  return { scale: viewport.scale, x: viewport.x - dx / viewport.scale, y: viewport.y + dy / viewport.scale };
}

/** The drawing point under a pixel of the canvas. */
export function cadPointAt(viewport: CadViewport, sx: number, sy: number): [number, number] {
  return [viewport.x + sx / viewport.scale, viewport.y - sy / viewport.scale];
}

export type CadScene = {
  drawing: CadDrawing;
  /** x0, y0, x1, y1 of each path. The first loop of a hatch holds the box of all its loops. */
  boxes: Float64Array;
  /** Paths in the order they are drawn: the fills as the file lists them, then the tracé colour by colour. */
  order: Uint32Array;
  /** How many entries of `order` are fills (hatch loops and filled outlines). */
  fills: number;
  /** x0, y0, x1, y1 around each text, from an estimate of its width. */
  textBoxes: Float64Array;
};

function boxText(entry: CadText, out: Float64Array, at: number) {
  const lines = cadTextLines(entry.text);
  const width = lines.reduce((longest, line) => Math.max(longest, line.length), 0) * entry.height * TEXT_WIDTH * (entry.stretch ?? 1);
  const first = cadFirstBaseline(entry, lines.length);
  const left = entry.align === 1 ? -width / 2 : entry.align === 2 ? -width : 0;
  const bottom = first - (lines.length - 1) * entry.height * CAD_LINE_SPACING - entry.height * 0.3, top = first + entry.height;
  const cos = Math.cos(entry.angle), sin = Math.sin(entry.angle);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of [[left, bottom], [left + width, bottom], [left, top], [left + width, top]]) {
    const x = entry.x + u * cos - v * sin, y = entry.y + u * sin + v * cos;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  out[at] = x0; out[at + 1] = y0; out[at + 2] = x1; out[at + 3] = y1;
}

/** What the view needs of a drawing and that does not change with the viewport. Computed once per drawing. */
export function buildCadScene(drawing: CadDrawing): CadScene {
  const { paths, points, texts } = drawing;
  const boxes = new Float64Array(4 * paths.count);
  const isFill = (index: number) => paths.kind[index] === HATCH || (paths.flags[index] & CAD_PATH_FILLED) !== 0;
  const perColor = new Map<number, number>();
  let head = -1, fills = 0;
  for (let index = 0; index < paths.count; index += 1) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let at = paths.start[index], end = at + paths.size[index]; at < end; at += 1) {
      const x = points[2 * at], y = points[2 * at + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const at = 4 * index;
    boxes[at] = x0; boxes[at + 1] = y0; boxes[at + 2] = x1; boxes[at + 3] = y1;
    if ((paths.flags[index] & CAD_PATH_COMPOUND) === 0) head = index;
    else if (head >= 0) {
      const to = 4 * head;
      if (x0 < boxes[to]) boxes[to] = x0;
      if (y0 < boxes[to + 1]) boxes[to + 1] = y0;
      if (x1 > boxes[to + 2]) boxes[to + 2] = x1;
      if (y1 > boxes[to + 3]) boxes[to + 3] = y1;
    }
    if (isFill(index)) fills += 1;
    else perColor.set(paths.color[index], (perColor.get(paths.color[index]) ?? 0) + 1);
  }

  // Tracé of one colour is stroked at once: the paths are grouped by colour, in the order of the file within each.
  const next = new Map<number, number>();
  let offset = fills;
  for (const color of [...perColor.keys()].sort((a, b) => a - b)) {
    next.set(color, offset);
    offset += perColor.get(color) as number;
  }
  const order = new Uint32Array(paths.count);
  for (let index = 0, fill = 0; index < paths.count; index += 1) {
    if (isFill(index)) { order[fill] = index; fill += 1; continue; }
    const at = next.get(paths.color[index]) as number;
    order[at] = index;
    next.set(paths.color[index], at + 1);
  }

  const textBoxes = new Float64Array(4 * texts.length);
  texts.forEach((entry, index) => boxText(entry, textBoxes, 4 * index));
  return { drawing, boxes, order, fills, textBoxes };
}

const writable = (entry: CadText) => entry.height > 0 && Number.isFinite(entry.height) && entry.text.trim() !== "";

/** Box of what the layers show (the file's own visibility unless `shown` is given), null when they show nothing. */
export function cadSceneExtents(scene: CadScene, shown?: readonly boolean[]): CadExtents | null {
  const { drawing, boxes, textBoxes } = scene, { paths, layers, texts } = drawing;
  const visible = (layer: number) => (shown ? shown[layer] === true : layers[layer].visible);
  const open = cadOpenGates(drawing, visible);
  const counted = (layer: number, gate: number) => visible(layer) && (gate < 0 || open[gate] === 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (from: Float64Array, at: number) => {
    if (!(from[at] <= from[at + 2]) || !(from[at + 1] <= from[at + 3])) return;
    if (from[at] < x0) x0 = from[at];
    if (from[at + 1] < y0) y0 = from[at + 1];
    if (from[at + 2] > x1) x1 = from[at + 2];
    if (from[at + 3] > y1) y1 = from[at + 3];
  };
  for (let index = 0; index < paths.count; index += 1) {
    if (paths.size[index] > 0 && counted(paths.layer[index], paths.gate[index])) grow(boxes, 4 * index);
  }
  texts.forEach((entry, index) => {
    if (writable(entry) && counted(entry.layer, entry.gate)) grow(textBoxes, 4 * index);
  });
  return x0 <= x1 && y0 <= y1 && Number.isFinite(x1 - x0) && Number.isFinite(y1 - y0) ? { x0, y0, x1, y1 } : null;
}

const displayColors = new Map<number, string>();

/** The colour a path is drawn in on the white sheet: white becomes ink, and what white would wash out is darkened. */
export function cadDisplayColor(color: number): string {
  const known = displayColors.get(color);
  if (known) return known;
  let r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff, css = INK;
  if (r !== 0xff || g !== 0xff || b !== 0xff) {
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luma > MAX_LUMA) { r = Math.round((r * MAX_LUMA) / luma); g = Math.round((g * MAX_LUMA) / luma); b = Math.round((b * MAX_LUMA) / luma); }
    css = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }
  if (displayColors.size < 4096) displayColors.set(color, css);
  return css;
}

export type CadViewContext = Pick<
  CanvasRenderingContext2D,
  | "beginPath" | "moveTo" | "lineTo" | "closePath" | "stroke" | "fillRect" | "fillText" | "save" | "restore" | "translate" | "rotate" | "scale"
  | "strokeStyle" | "fillStyle" | "lineWidth" | "lineJoin" | "lineCap" | "globalAlpha" | "font" | "textAlign" | "textBaseline"
> & { fill(rule?: CanvasFillRule): void };

export type CadViewOptions = {
  /** Size of the canvas in the pixels the viewport counts in. */
  width: number;
  height: number;
  /** Layers shown, by index: replaces the visibility the file gives them. */
  shown?: readonly boolean[];
  /** Texts written at most (CAD_VIEW_MAX_TEXTS by default). */
  maxTexts?: number;
};

export type CadViewStats = {
  /** Outlines and filled shapes sent to the canvas. */
  paths: number;
  texts: number;
  /** Texts tall enough and in view that were not written because of `maxTexts`. */
  textsOverLimit: number;
};

/** Draws what the viewport shows of the scene: a white sheet, the fills, the tracé, then the texts. */
export function drawCadView(ctx: CadViewContext, scene: CadScene, viewport: CadViewport, options: CadViewOptions): CadViewStats {
  const { drawing, boxes, order, fills, textBoxes } = scene, { paths, points, layers, texts } = drawing;
  const { scale, x: vx, y: vy } = viewport, { width, height } = options;
  const stats: CadViewStats = { paths: 0, texts: 0, textsOverLimit: 0 };

  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(vx) || !Number.isFinite(vy)) return stats;

  const visible = (layer: number) => (options.shown ? options.shown[layer] === true : layers[layer].visible);
  const open = cadOpenGates(drawing, visible);
  const counted = (layer: number, gate: number) => visible(layer) && (gate < 0 || open[gate] === 1);
  // The canvas in drawing units, a pixel wider on each side for the width of the lines.
  const wx0 = vx - 1 / scale, wx1 = vx + (width + 1) / scale, wy0 = vy - (height + 1) / scale, wy1 = vy + 1 / scale;
  const outside = (from: Float64Array, at: number) => from[at + 2] < wx0 || from[at] > wx1 || from[at + 3] < wy0 || from[at + 1] > wy1;
  const span = (at: number) => Math.max(boxes[at + 2] - boxes[at], boxes[at + 3] - boxes[at + 1]) * scale;

  const outline = (index: number, closed: boolean) => {
    const start = paths.start[index], last = start + paths.size[index] - 1;
    let fromX = (points[2 * start] - vx) * scale, fromY = (vy - points[2 * start + 1]) * scale;
    ctx.moveTo(fromX, fromY);
    for (let at = start + 1; at <= last; at += 1) {
      const x = (points[2 * at] - vx) * scale, y = (vy - points[2 * at + 1]) * scale;
      // Points the screen cannot tell apart are one, but the path ends where it ends.
      if (at < last && (x - fromX) * (x - fromX) + (y - fromY) * (y - fromY) < MIN_STEP * MIN_STEP) continue;
      ctx.lineTo(x, y);
      fromX = x; fromY = y;
    }
    if (closed) ctx.closePath();
  };

  // Fills, under the tracé. Each shape is filled on its own, its further loops left empty (even-odd).
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let at = 0; at < fills;) {
    const first = at, head = order[at];
    at += 1;
    while (at < fills && (paths.flags[order[at]] & CAD_PATH_COMPOUND) !== 0) at += 1;
    if (!counted(paths.layer[head], paths.gate[head]) || outside(boxes, 4 * head) || !(span(4 * head) >= MIN_FILL)) continue;
    ctx.beginPath();
    for (let loop = first; loop < at; loop += 1) if (paths.size[order[loop]] >= 3) outline(order[loop], true);
    ctx.fillStyle = cadDisplayColor(paths.color[head]);
    // A hatch tints its area without hiding what is drawn in it; a filled outline (SOLID, TRACE) is plain.
    ctx.globalAlpha = paths.kind[head] !== HATCH ? 1 : (paths.flags[head] & CAD_PATH_FILLED) !== 0 ? SOLID_HATCH_ALPHA : PATTERN_HATCH_ALPHA;
    ctx.fill("evenodd");
    stats.paths += 1;
  }
  ctx.globalAlpha = 1;

  // Tracé, one stroke per colour.
  let color = -1, pending = 0;
  const flush = () => {
    if (pending > 0) ctx.stroke();
    pending = 0;
  };
  for (let at = fills; at < order.length; at += 1) {
    const index = order[at], box = 4 * index;
    if (paths.size[index] < 2 || !counted(paths.layer[index], paths.gate[index]) || outside(boxes, box)) continue;
    const size = span(box);
    if (!(size >= MIN_MARK)) continue;
    if (paths.color[index] !== color || pending >= STROKE_BATCH) {
      flush();
      color = paths.color[index];
    }
    if (pending === 0) {
      ctx.strokeStyle = cadDisplayColor(color);
      ctx.beginPath();
    }
    if (size < MIN_OUTLINE) {
      ctx.moveTo((boxes[box] - vx) * scale, (vy - boxes[box + 1]) * scale);
      ctx.lineTo((boxes[box + 2] - vx) * scale, (vy - boxes[box + 3]) * scale);
    } else outline(index, (paths.flags[index] & CAD_PATH_CLOSED) !== 0);
    pending += 1;
    stats.paths += 1;
  }
  flush();

  // Texts, where the plotted PDF writes them.
  const most = options.maxTexts ?? CAD_VIEW_MAX_TEXTS;
  let font = "";
  ctx.textBaseline = "alphabetic";
  texts.forEach((entry, index) => {
    const capHeight = entry.height * scale;
    if (!(capHeight >= MIN_TEXT) || !writable(entry) || !counted(entry.layer, entry.gate) || outside(textBoxes, 4 * index)) return;
    if (stats.texts >= most) { stats.textsOverLimit += 1; return; }
    const size = `${Math.round((capHeight / CAD_CAP_HEIGHT) * 2) / 2}px Helvetica, Arial, sans-serif`;
    if (size !== font) { ctx.font = size; font = size; }
    ctx.fillStyle = cadDisplayColor(entry.color);
    ctx.textAlign = entry.align === 1 ? "center" : entry.align === 2 ? "right" : "left";
    const lines = cadTextLines(entry.text), step = entry.height * CAD_LINE_SPACING, first = cadFirstBaseline(entry, lines.length);
    const x = (entry.x - vx) * scale, y = (vy - entry.y) * scale, turned = Math.abs(entry.angle) > 1e-6;
    // Written in its own frame when it is turned, or when a reference stretched it along its line.
    const framed = turned || entry.stretch !== undefined;
    if (framed) {
      ctx.save();
      ctx.translate(x, y);
      if (turned) ctx.rotate(-entry.angle);
      if (entry.stretch !== undefined) ctx.scale(entry.stretch, 1);
    }
    lines.forEach((raw, position) => {
      const line = raw.replace(/\t/g, " ");
      if (line.trim() === "") return;
      const below = (position * step - first) * scale;
      ctx.fillText(line, framed ? 0 : x, framed ? below : y + below);
    });
    if (framed) ctx.restore();
    stats.texts += 1;
  });
  return stats;
}

// The view of a drawing plotted to scale as a PDF the métré reads like any
// other plan: one PDF layer per drawing layer, a sheet in whole millimetres and
// a cartouche that states the scale and the format the métré checks it against.
// Hatches are left out: they are areas, and the métré would read their outline
// as tracé.

import { PDFDocument, PDFHexString, PDFName, StandardFonts, type PDFRef } from "pdf-lib";

import { CAD_PATH_CLOSED, CAD_PATH_COMPOUND, CAD_PATH_FILLED, cadOpenGates, type CadDrawing } from "./model";
import { CAD_PLOT_DENOMINATORS } from "./plot-scales";
import { CAD_CAP_HEIGHT as CAP_HEIGHT, CAD_LINE_SPACING as LINE_SPACING, cadFirstBaseline, cadTextLines } from "./text-layout";

const MM_PER_POINT = 25.4 / 72;
/** Scales tried in turn when none is asked for nor announced by the drawing. */
const FIT_DENOMINATORS = [20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const A0_MM = [1189, 841];
const MARGIN_MM = 10, CARTOUCHE_MM = 12, MIN_SIDE_MM = 210, CARTOUCHE_TEXT_MM = 2.5;
const LINE_WIDTH_PT = 0.5;
const HATCH_KIND = 6;
// The words the métré takes for a scale label, and the scale that follows them.
const SCALE_LABEL = /[ée]chelle|\bscale\b|\bech\b/i;
const SCALE_VALUE = /(?:^|[^\d/])1\s*[/:]\s*(\d{1,4})(?![\d/])/g;

/** `maxSheetMm` is the longest side a PDF page can have (14 400 points). */
export const CAD_PLOT_LIMITS = { maxTexts: 40_000, maxBytes: 50 * 1024 * 1024, maxSheetMm: 5080 };

export type CadPlotErrorReason = "truncated" | "unknown_unit" | "invalid_denominator" | "empty" | "does_not_fit" | "too_large";

export class CadPlotError extends Error {
  constructor(readonly reason: CadPlotErrorReason) {
    super(`CAD plot refused: ${reason}`);
    this.name = "CadPlotError";
  }
}

export type CadPlotOptions = {
  /** Layers plotted, by layer index; the layers the file shows when left out. */
  shown?: readonly boolean[];
  /** Unit picked by the user; the unit of the file when left out. */
  metresPerUnit?: number | null;
  /** Scale asked for, 50 for 1/50. */
  denominator?: number;
  title?: string;
  /** Date written in the file; none when left out, so that a drawing always gives the same file. */
  date?: Date;
  limits?: Partial<typeof CAD_PLOT_LIMITS>;
};

export type CadPlot = {
  bytes: Uint8Array;
  denominator: number;
  /** Where the scale comes from: asked for, announced by a text of the drawing, or the first that fits A0. */
  scaleSource: "requested" | "drawing" | "fit";
  /** Scales the texts of the drawing announce and the plot does not follow: the métré will ask which one holds. */
  otherScales: number[];
  sheet_mm: [number, number];
  /** Names of the layers plotted, each a layer of the PDF. */
  layers: string[];
  paths: number;
  texts: number;
  omitted: { hatches: number; texts: number };
};

type Box = { x0: number; y0: number; x1: number; y1: number };
type TextLine = { text: number; hex: string; dx: number; dy: number };
/** A text that is a scale label alone, or scales alone: where its first line starts and how long it is. */
type ScaleMark = { x: number; y: number; width: number; height: number; cos: number; sin: number; scales: number[] };
/** Labels and values looked at; a plan has a handful of them. */
const SCALE_MARKS = 500;

/** The métré's rule: a value after its label on the same baseline, or just under it. */
function follows(label: ScaleMark, value: ScaleMark): boolean {
  const h = Math.max(label.height, value.height), dx = value.x - label.x, dy = value.y - label.y;
  const along = dx * label.cos + dy * label.sin, down = dx * label.sin - dy * label.cos;
  const after = along - label.width >= -h && along - label.width <= 8 * h && Math.abs(down) <= h;
  const below = Math.abs(along) <= Math.max(label.width, value.width) + 2 * h && down > 0 && down <= 4 * h;
  return after || below;
}

const fixed = (value: number) => String(Math.round(value * 1000) / 1000);

function colorOps(color: number, operator: "RG" | "rg") {
  // White on screen is black on paper.
  const rgb = color === 0xffffff ? 0 : color;
  return `${fixed(((rgb >> 16) & 255) / 255)} ${fixed(((rgb >> 8) & 255) / 255)} ${fixed((rgb & 255) / 255)} ${operator}`;
}

function sheetFor(box: Box, mmPerUnit: number): [number, number] {
  const side = (extent: number, margins: number) => Math.max(MIN_SIDE_MM, Math.ceil(extent * mmPerUnit - 1e-6) + margins);
  return [side(box.x1 - box.x0, 2 * MARGIN_MM), side(box.y1 - box.y0, 2 * MARGIN_MM + CARTOUCHE_MM)];
}

const fitsIn = ([width, height]: [number, number], [long, short]: number[]) => (width <= long && height <= short) || (width <= short && height <= long);

export async function plotCadDrawing(drawing: CadDrawing, options: CadPlotOptions = {}): Promise<CadPlot> {
  const { layers, paths, points, texts } = drawing;
  const limits = { ...CAD_PLOT_LIMITS, ...options.limits };
  if (drawing.truncated) throw new CadPlotError("truncated");
  const metresPerUnit = options.metresPerUnit === undefined ? drawing.units.metresPerUnit : options.metresPerUnit;
  if (metresPerUnit === null || !(metresPerUnit > 0) || !Number.isFinite(metresPerUnit)) throw new CadPlotError("unknown_unit");
  if (options.denominator !== undefined && !CAD_PLOT_DENOMINATORS.includes(options.denominator)) throw new CadPlotError("invalid_denominator");
  const shown = (layer: number) => (options.shown ? options.shown[layer] === true : layers[layer].visible);
  const open = cadOpenGates(drawing, shown);
  const counted = (layer: number, gate: number) => shown(layer) && (gate < 0 || open[gate] === 1);

  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = doc.embedStandardFont(StandardFonts.Helvetica);
  const glyphs = new Set(font.getCharacterSet());
  const printable = (value: string) => {
    let out = "";
    for (const char of value) out += glyphs.has(char.codePointAt(0) as number) ? char : char === "\t" ? " " : "?";
    return out;
  };

  // What is plotted, layer by layer, and the box it fills in drawing units.
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => {
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  };
  const pathsOf: number[][] = layers.map(() => []), linesOf: TextLine[][] = layers.map(() => []);
  const omitted = { hatches: 0, texts: 0 };
  let pathCount = 0, lineCount = 0;
  for (let index = 0; index < paths.count; index += 1) {
    const layer = paths.layer[index];
    if (!counted(layer, paths.gate[index])) continue;
    if (paths.kind[index] === HATCH_KIND) {
      if ((paths.flags[index] & CAD_PATH_COMPOUND) === 0) omitted.hatches += 1;
      continue;
    }
    if (paths.size[index] < 2) continue;
    for (let at = paths.start[index], end = at + paths.size[index]; at < end; at += 1) grow(points[2 * at], points[2 * at + 1]);
    pathsOf[layer].push(index);
    pathCount += 1;
  }
  const announced = new Set<number>(), labels: ScaleMark[] = [], values: ScaleMark[] = [];
  texts.forEach((entry, index) => {
    if (!counted(entry.layer, entry.gate) || !(entry.height > 0) || !Number.isFinite(entry.height)) return;
    // A label announces the scales of its own text; alone, the scale may be the text beside it (a cartouche attribute).
    const written = Array.from(entry.text.matchAll(SCALE_VALUE), (match) => Number(match[1]));
    const scales = written.filter((value) => CAD_PLOT_DENOMINATORS.includes(value));
    const labelled = SCALE_LABEL.test(entry.text);
    if (labelled) for (const value of scales) announced.add(value);
    let marks = labelled ? (written.length === 0 ? labels : null) : scales.length > 0 ? values : null;
    if (marks && marks.length >= SCALE_MARKS) marks = null;
    const lines = cadTextLines(entry.text), size = entry.height / CAP_HEIGHT, step = entry.height * LINE_SPACING;
    const first = cadFirstBaseline(entry, lines.length);
    const cos = Math.cos(entry.angle), sin = Math.sin(entry.angle);
    lines.forEach((raw, position) => {
      const line = printable(raw);
      if (line.trim() === "") return;
      const width = font.widthOfTextAtSize(line, 1) * size;
      const dx = entry.align === 1 ? -width / 2 : entry.align === 2 ? -width : 0, dy = first - position * step;
      if (marks) {
        marks.push({ x: entry.x + dx * cos - dy * sin, y: entry.y + dx * sin + dy * cos, width, height: entry.height, cos, sin, scales });
        marks = null;
      }
      if (lineCount >= limits.maxTexts) { omitted.texts += 1; return; }
      for (const [u, v] of [[dx, dy - entry.height / 4], [dx + width, dy - entry.height / 4], [dx, dy + entry.height], [dx + width, dy + entry.height]]) {
        grow(entry.x + u * cos - v * sin, entry.y + u * sin + v * cos);
      }
      linesOf[entry.layer].push({ text: index, hex: font.encodeText(line).toString(), dx, dy });
      lineCount += 1;
    });
  });
  if (pathCount === 0 && lineCount === 0) throw new CadPlotError("empty");
  for (const value of values) {
    if (labels.some((label) => follows(label, value))) for (const scale of value.scales) announced.add(scale);
  }

  // The scale: asked for, else the one the drawing announces, else the first that fits A0.
  const sheetAt = (value: number) => sheetFor(box, (metresPerUnit * 1000) / value);
  const within = (sheet: [number, number]) => sheet[0] <= limits.maxSheetMm && sheet[1] <= limits.maxSheetMm;
  const announcedScales = [...announced].sort((a, b) => a - b);
  let denominator: number | undefined, scaleSource: CadPlot["scaleSource"] = "fit";
  if (options.denominator !== undefined) {
    if (!within(sheetAt(options.denominator))) throw new CadPlotError("does_not_fit");
    denominator = options.denominator;
    scaleSource = "requested";
  } else if (announcedScales.length === 1 && within(sheetAt(announcedScales[0]))) {
    denominator = announcedScales[0];
    scaleSource = "drawing";
  } else {
    denominator = FIT_DENOMINATORS.find((value) => fitsIn(sheetAt(value), A0_MM));
    if (denominator === undefined) throw new CadPlotError("does_not_fit");
  }
  const mmPerUnit = (metresPerUnit * 1000) / denominator, scale = mmPerUnit / MM_PER_POINT;
  const sheet = sheetFor(box, mmPerUnit);
  // The drawing sits in the middle of what the margins and the cartouche leave.
  const left = (sheet[0] - (box.x1 - box.x0) * mmPerUnit) / 2 / MM_PER_POINT;
  const bottom = (MARGIN_MM + CARTOUCHE_MM + (sheet[1] - 2 * MARGIN_MM - CARTOUCHE_MM - (box.y1 - box.y0) * mmPerUnit) / 2) / MM_PER_POINT;
  const px = (x: number) => fixed((x - box.x0) * scale + left), py = (y: number) => fixed((y - box.y0) * scale + bottom);

  // The cartouche comes first: the métré takes the first format it reads.
  const cartoucheSize = CARTOUCHE_TEXT_MM / MM_PER_POINT / CAP_HEIGHT;
  const cartouche = (value: string, yMm: number) =>
    `BT /F1 ${fixed(cartoucheSize)} Tf 1 0 0 1 ${fixed(MARGIN_MM / MM_PER_POINT)} ${fixed(yMm / MM_PER_POINT)} Tm ${font.encodeText(value).toString()} Tj ET`;
  const out: string[] = [`${LINE_WIDTH_PT} w 1 J 1 j`, "0 0 0 rg", cartouche(`Échelle 1/${denominator}`, 7.5), cartouche(`Format ${sheet[0]}x${sheet[1]}`, 3)];

  const groups: PDFRef[] = [], properties: Record<string, PDFRef> = {}, plotted: string[] = [];
  for (let layer = 0; layer < layers.length; layer += 1) {
    if (pathsOf[layer].length === 0 && linesOf[layer].length === 0) continue;
    const tag = `oc${groups.length}`;
    const group = doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFHexString.fromText(layers[layer].name) }));
    groups.push(group);
    properties[tag] = group;
    plotted.push(layers[layer].name);
    out.push(`/OC /${tag} BDC`);
    let stroke = -1, fill = -1;
    for (const index of pathsOf[layer]) {
      const filled = (paths.flags[index] & CAD_PATH_FILLED) !== 0, color = paths.color[index];
      if (filled && color !== fill) { out.push(colorOps(color, "rg")); fill = color; }
      if (!filled && color !== stroke) { out.push(colorOps(color, "RG")); stroke = color; }
      const start = paths.start[index];
      let ops = `${px(points[2 * start])} ${py(points[2 * start + 1])} m`;
      for (let at = start + 1, end = start + paths.size[index]; at < end; at += 1) ops += ` ${px(points[2 * at])} ${py(points[2 * at + 1])} l`;
      out.push(`${ops} ${filled ? "h f" : (paths.flags[index] & CAD_PATH_CLOSED) !== 0 ? "h S" : "S"}`);
    }
    for (const line of linesOf[layer]) {
      const entry = texts[line.text], cos = Math.cos(entry.angle), sin = Math.sin(entry.angle);
      if (entry.color !== fill) { out.push(colorOps(entry.color, "rg")); fill = entry.color; }
      const x = entry.x + line.dx * cos - line.dy * sin, y = entry.y + line.dx * sin + line.dy * cos;
      out.push(`BT /F1 ${fixed((entry.height / CAP_HEIGHT) * scale)} Tf ${fixed(cos)} ${fixed(sin)} ${fixed(-sin)} ${fixed(cos)} ${px(x)} ${py(y)} Tm ${line.hex} Tj ET`);
    }
    out.push("EMC");
  }

  doc.setTitle(options.title ?? "Tracé");
  doc.setProducer("MergeOne");
  doc.setCreator("MergeOne");
  if (options.date) { doc.setCreationDate(options.date); doc.setModificationDate(options.date); }
  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: groups, D: { Order: groups, ON: groups } }));
  const page = doc.addPage([sheet[0] / MM_PER_POINT, sheet[1] / MM_PER_POINT]);
  page.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font.ref }, Properties: properties }));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(out.join("\n"))));
  const bytes = await doc.save();
  if (bytes.length > limits.maxBytes) throw new CadPlotError("too_large");

  return {
    bytes, denominator, scaleSource, otherScales: announcedScales.filter((value) => value !== denominator), sheet_mm: sheet,
    layers: plotted, paths: pathCount, texts: lineCount, omitted,
  };
}

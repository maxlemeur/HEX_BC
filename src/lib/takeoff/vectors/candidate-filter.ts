import { isMeasuredNetwork } from "@/lib/takeoff/vectors/classify";
import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { boxContains, boxesOverlap, emptyBox, extendBox, type Box } from "@/lib/takeoff/vectors/geometry";
import { isTint, isTintOrShade, readAirDuctLegend } from "@/lib/takeoff/vectors/legend";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { mergeTextLines, readLabelBlocks } from "@/lib/takeoff/vectors/labels";
import { nonNetworkLayerKind, parsePipeLabel } from "@/lib/takeoff/vectors/vocabulary";

// The groups never sent to Decisions (TI-704): they can never be a network. On
// the 8 development plans, 135 of the 171 groups sent were no network and none
// was classed by Decisions at 0.8 or more (5/11, v1 questions); these rules leave out 110 of them,
// and none of the 36 real networks. A filtered group keeps no class: it stays
// « à revoir », as without a model. Trade-off: a grey group is no longer asked
// whether it is a wall (fill.ts takes a Decisions « mur » or « cloison » it
// accepts as a room barrier; the v2 questions offer neither since TI-704); none
// of the 89 grey answers of the 5/11 runs was one at 0.8 or more.
// - grey: every colour grey or near-white (the background, frames, tables and
//   the insulation hatches drawn along the pipes): the reading never makes a
//   network of a grey group, whatever Decisions answers (classify.ts);
// - pattern: every colour a pattern (a hatch, « pattern » in the extraction):
//   it has no colour to compare with a legend;
// - frame_layer, architecture_layer: a layer named as a frame or title block,
//   or as furniture, tiling or joinery (vocabulary.ts nonNetworkLayerKind);
// - legend_sample: every visible stroke inside the legend box (which the
//   measure leaves out), or the whole group a short thin strip beside a text
//   of the page that is no piece of a pipe label (naming a network or a size
//   itself, or in a line or a label block of labels.ts that does, however the
//   PDF splits or glues it): at most 25 text heights long, 1.5 thick, within
//   one text height of it, along it (the sample of a legend whose code is no
//   network, on a page with layers too);
// - air_duct: on a page whose legend has at least 2 air-duct codes (legend.ts
//   readAirDuctLegend), a colour group (never a layer: its name is its
//   identity) whose colours are each that of an air row or a tint of one
//   (mixed with white, as a duct's band is shaded), and none related to a
//   network of the page: its colour, a tint or shade of it, or the colour it is
//   a tint of (a band pipe's outline beside its classed fill). A shade of an air
//   colour is kept, and does not keep the air colour: the dark red of a heating
//   pipe is a shade of the red of an extract duct.

export const CANDIDATE_FILTER_REASONS = ["grey", "pattern", "frame_layer", "architecture_layer", "legend_sample", "air_duct"] as const;
export type CandidateFilterReason = (typeof CANDIDATE_FILTER_REASONS)[number];
/** A legend sample beside a text: its length and thickness, and its distance to the text, in heights of that text. */
export const LEGEND_SAMPLE_STRIP = { maxLengthHeights: 25, maxThicknessHeights: 1.5, maxGapHeights: 1 } as const;
/** Air-duct codes a page's legend needs before its colours are ducts: one lone code may be an equipment tag. */
export const AIR_LEGEND_MIN_CODES = 2;

/** The box of a text's glyphs (along its baseline, up its height) and whether it reads along page x. */
function textBox(text: VectorText): { box: Box; horizontal: boolean } {
  const cos = Math.cos(text.angle), sin = Math.sin(text.angle);
  const box = emptyBox();
  for (const [along, up] of [[0, 0], [text.width, 0], [0, text.height], [text.width, text.height]]) {
    // Glyphs rise along (sin, −cos) of their frame (legend.ts).
    extendBox(box, text.x + along * cos + up * sin, text.y + along * sin - up * cos);
  }
  return { box, horizontal: Math.abs(cos) >= Math.abs(sin) };
}

/** Cells a box may fill in the text index; a larger box (a corrupt text matrix) is checked on every lookup instead. */
const BOX_INDEX_CELLS = 4096;

/** The ids of boxes containing a point, by a grid of 64 pt cells (numeric keys, as geometry.ts SegmentIndex). */
function boxIndex(boxes: readonly Box[]) {
  const cell = 64;
  const key = (cx: number, cy: number) => (cy + 1048576) * 2097152 + (cx + 1048576);
  const cells = new Map<number, number[]>();
  const everywhere: number[] = [];
  boxes.forEach((box, id) => {
    if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) return;
    const [cx0, cx1, cy0, cy1] = [Math.floor(box.x0 / cell), Math.floor(box.x1 / cell), Math.floor(box.y0 / cell), Math.floor(box.y1 / cell)];
    // Far off any sheet, or over too many cells: never iterated cell by cell.
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > BOX_INDEX_CELLS || [cx0, cx1, cy0, cy1].some((value) => Math.abs(value) >= 1048576)) {
      everywhere.push(id);
      return;
    }
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const list = cells.get(key(cx, cy));
        if (list) list.push(id);
        else cells.set(key(cx, cy), [id]);
      }
    }
  });
  return (point: { x: number; y: number }) => {
    const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell);
    const near = Math.abs(cx) < 1048576 && Math.abs(cy) < 1048576 ? cells.get(key(cx, cy)) ?? [] : [];
    return [...near, ...everywhere].filter((id) => boxContains(boxes[id], point, 0.01));
  };
}

const centreOf = (box: Box) => ({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });
const isLabelText = (str: string) => {
  const label = parsePipeLabel(str);
  return label.network !== null || label.dn !== null;
};

/**
 * Whether a text of the page is a piece of a pipe label, however the PDF writes it: it reads as a label itself, or
 * lies in a line (labels.ts mergeTextLines) that has such a piece (« C.12 » then « EF », « PVC » glued to « DN 40 »)
 * or that belongs to a label block (labels.ts readLabelBlocks: « QRS » then « DN 22 », a label on two lines).
 */
function labelPieces(texts: readonly VectorText[]) {
  const lines = mergeTextLines(texts).map((line) => textBox(line).box);
  const inLines = boxIndex(lines);
  const labelled = new Set<number>();
  for (const block of readLabelBlocks(texts)) for (const box of block.lines) for (const id of inLines(centreOf(box))) labelled.add(id);
  for (const text of texts) if (isLabelText(text.str)) for (const id of inLines(centreOf(textBox(text).box))) labelled.add(id);
  return (text: VectorText) => isLabelText(text.str) || inLines(centreOf(textBox(text).box)).some((id) => labelled.has(id));
}

/** Whether a group's whole extent is a legend sample beside one of the page's texts (LEGEND_SAMPLE_STRIP). */
function isSampleStrip(bbox: Box, texts: ReadonlyArray<{ box: Box; horizontal: boolean; height: number }>) {
  const width = bbox.x1 - bbox.x0, height = bbox.y1 - bbox.y0;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  const horizontal = width >= height;
  const length = Math.max(width, height), thickness = Math.min(width, height);
  return texts.some((text) => text.horizontal === horizontal && text.height > 0
    && length <= LEGEND_SAMPLE_STRIP.maxLengthHeights * text.height && thickness <= LEGEND_SAMPLE_STRIP.maxThicknessHeights * text.height
    && boxesOverlap(bbox, text.box, LEGEND_SAMPLE_STRIP.maxGapHeights * text.height));
}

/**
 * For each group of the page, the reason it is never sent to Decisions, or null. Only the groups `wanted` names are
 * judged (the others get null): the selection asks for the groups it would otherwise send.
 */
export function candidateFilterReasons(model: PageModel, reading: VectorPageReading, wanted: ReadonlySet<number>): Array<CandidateFilterReason | null> {
  const reasons: Array<CandidateFilterReason | null> = model.groups.map(() => null);
  if (wanted.size === 0 || reading.mode === "raster") return reasons;
  // A pipe label sits beside its pipe: no piece of it is the text of a legend sample (labelPieces). The pieces are
  // only sought on a page where some group is a strip beside a text at all.
  const written = model.extraction.texts.filter((text) => text.str.trim().length > 0 && text.height > 0);
  const boxed = written.map((text) => ({ ...textBox(text), height: text.height }));
  const strips = new Set([...wanted].filter((index) => isSampleStrip(model.groups[index].bbox, boxed)));
  let unlabelled: typeof boxed | null = null;
  const sampleStrip = (index: number) => {
    if (!strips.has(index)) return false;
    if (unlabelled === null) {
      const piece = labelPieces(written);
      unlabelled = boxed.filter((_, position) => !piece(written[position]));
    }
    return isSampleStrip(model.groups[index].bbox, unlabelled);
  };
  // The groups judged with every visible segment inside a legend box (by its centre), on a page with a legend.
  const inLegend = new Set<number>();
  if (reading.legend.boxes.length > 0) {
    const outside = new Set<number>();
    model.segments.forEach((segment, id) => {
      const group = model.segmentGroup[id];
      if (!wanted.has(group) || model.segmentNearWhite[id] || outside.has(group)) return;
      const centre = { x: (segment.x0 + segment.x1) / 2, y: (segment.y0 + segment.y1) / 2 };
      if (reading.legend.boxes.some((box) => boxContains(box, centre))) inLegend.add(group);
      else outside.add(group);
    });
    for (const group of outside) inLegend.delete(group);
  }
  const colourGroups = [...wanted].some((index) => model.groups[index].layer === null);
  const airLegend = colourGroups ? readAirDuctLegend(model) : null;
  const air = airLegend && airLegend.codes.length >= AIR_LEGEND_MIN_CODES ? airLegend.colors : [];
  // The colours of the page's networks (keyword, legend, labels, rules, document; Decisions at its accepted margin).
  const networkColours = [...new Set(reading.groups.flatMap((group) => (isMeasuredNetwork(group) ? group.colors : [])))];
  // Its colour, a tint or shade of it, or the colour it is a tint of (a band pipe's outline beside its classed fill); never
  // the colour it is a shade of: the red of an extract duct beside a dark red heating pipe stays a duct.
  const ofNetwork = (color: string) => networkColours.some((network) => color === network || isTintOrShade(color, network) || isTint(network, color));
  const isAirColour = (color: string) => !ofNetwork(color) && air.some((duct) => color === duct || isTint(color, duct));
  for (const index of wanted) {
    const group = model.groups[index];
    const layerKind = group.layerName === null ? null : nonNetworkLayerKind(group.layerName);
    let reason: CandidateFilterReason | null = null;
    if (group.grey) reason = "grey";
    else if (group.colors.every((color) => color === "pattern")) reason = "pattern";
    else if (layerKind === "frame") reason = "frame_layer";
    else if (layerKind === "architecture") reason = "architecture_layer";
    else if (inLegend.has(index) || sampleStrip(index)) reason = "legend_sample";
    else if (group.layer === null && air.length > 0 && group.colors.every(isAirColour)) reason = "air_duct";
    reasons[index] = reason;
  }
  return reasons;
}

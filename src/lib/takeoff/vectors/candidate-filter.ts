import { isMeasuredNetwork } from "@/lib/takeoff/vectors/classify";
import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { boxContains, boxesOverlap, emptyBox, extendBox, type Box } from "@/lib/takeoff/vectors/geometry";
import { isTint, isTintOrShade, readAirDuctLegend } from "@/lib/takeoff/vectors/legend";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { nonNetworkLayerKind, parsePipeLabel } from "@/lib/takeoff/vectors/vocabulary";

// The groups never sent to Decisions (TI-704): they can never be a network. On
// the 8 development plans, 135 of the 171 groups sent were no network and none
// was classed by Decisions at 0.8 or more; these rules leave out 110 of them,
// and none of the 36 real networks. A filtered group keeps no class: it stays
// « à revoir », as without a model. Trade-off: a grey group is no longer asked
// whether it is a wall (fill.ts takes a Decisions « mur » or « cloison » at 0.8
// or more as a room barrier); none of the 89 grey answers of the 5/11 runs was.
// - grey: every colour grey or near-white (the background, frames, tables and
//   the insulation hatches drawn along the pipes): the reading never makes a
//   network of a grey group, whatever Decisions answers (classify.ts);
// - pattern: every colour a pattern (a hatch, « pattern » in the extraction):
//   it has no colour to compare with a legend;
// - frame_layer, architecture_layer: a layer named as a frame or title block,
//   or as furniture, tiling or joinery (vocabulary.ts nonNetworkLayerKind);
// - legend_sample: every visible stroke inside the legend box (which the
//   measure leaves out), or the whole group a short thin strip beside a text
//   of the page that is no pipe label (no network nor size): at most 25 text
//   heights long, 1.5 thick, within one text height of it, along it (the
//   sample of a legend whose code is no network, on a page with layers too);
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
  // A pipe label sits beside its pipe: never the text of a legend sample.
  const texts = model.extraction.texts.filter((text) => {
    if (text.str.trim().length === 0 || text.height <= 0) return false;
    const label = parsePipeLabel(text.str);
    return label.network === null && label.dn === null;
  }).map((text) => ({ ...textBox(text), height: text.height }));
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
  // The colours of the page's networks (keyword, legend, labels, document; Decisions at 0.8 or more).
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
    else if (inLegend.has(index) || isSampleStrip(group.bbox, texts)) reason = "legend_sample";
    else if (group.layer === null && air.length > 0 && group.colors.every(isAirColour)) reason = "air_duct";
    reasons[index] = reason;
  }
  return reasons;
}

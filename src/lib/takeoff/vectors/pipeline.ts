import {
  applyCorrespondences, applyDecisions, classifyByKeywords, detectionShare, groupsToReview, isMeasuredNetwork, type DecisionsAnswer, type GroupClass,
} from "@/lib/takeoff/vectors/classify";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { SegmentIndex, boxContains } from "@/lib/takeoff/vectors/geometry";
import { readLabelBlocks } from "@/lib/takeoff/vectors/labels";
import { LEGEND_RULE_VERSION, readLegend, type PageLegend } from "@/lib/takeoff/vectors/legend";
import { classifyByLabels, measureNetworks, type NetworkMeasure } from "@/lib/takeoff/vectors/measure";
import { buildPageModel, type GroupStats } from "@/lib/takeoff/vectors/page-model";
import { readPageScale, type PageCalibration, type PageScale } from "@/lib/takeoff/vectors/scale";
import { readRoomSurfaces, type RoomSurface } from "@/lib/takeoff/vectors/surfaces";
import type { VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// The vector reading of one page (TI-662 steps 1 to 4):
// extraction → groups → scale → legend, keyword and label-vote classes, then
// Decisions answers when given (group-decisions-server.ts), then document or
// user correspondences → network centrelines, labels, DN → room surfaces
// (rings, else the floor filled between walls).
// A page whose raster images cover ≥ 90 % of it is « raster »: its vectors are
// read (texts, scale) but no network is measured from them; the level C
// reading stays the source (TI-658 pipeline step 5).

// 11 (TI-683): runs and totals keep the notation their labels print a size in.
export const VECTOR_READING_VERSION = 11;
export const RASTER_COVERAGE = 0.9;

/** A page whose raster images cover RASTER_COVERAGE of it, known from its extraction alone (its reading's « raster » mode). */
export function isRasterExtraction(extraction: Pick<VectorPageExtraction, "counts">) {
  return extraction.counts.imageCoverage >= RASTER_COVERAGE;
}

export type VectorGroupReading = Pick<GroupStats, "id" | "layer" | "layerName" | "colors" | "width" | "dash" | "paths" | "segments" | "closed" | "nearWhite" | "grey"> & {
  length_pt: number;
  bbox: [number, number, number, number] | null;
} & GroupClass;

export type VectorPageReading = {
  version: number;
  page: number;
  mode: "layers" | "colours" | "raster";
  size_pt: [number, number];
  userUnit: number;
  rotate: number;
  /** `to_review`: groups the review must still decide (classify.ts groupsToReview). */
  counts: VectorPageExtraction["counts"] & { texts: number; groups: number; groups_visible: number; to_review: number };
  scale: PageScale;
  legend: PageLegend;
  groups: VectorGroupReading[];
  detection: number | null;
  networks: NetworkMeasure | null;
  surfaces: RoomSurface[];
  timings: VectorPageExtraction["timings"] & { reading_ms: number };
  memory: VectorPageExtraction["memory"];
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function readVectorPage(extraction: VectorPageExtraction, options: {
  calibration?: PageCalibration | null;
  correspondences?: ReadonlyMap<string, VectorClass>;
  correspondenceSource?: "document" | "user";
  /** Decisions answers by group id (classify.ts applyDecisions): only groups without class nor candidates take them. */
  decisions?: ReadonlyMap<string, DecisionsAnswer>;
  clock?: () => number;
} = {}): VectorPageReading {
  const clock = options.clock ?? (() => performance.now());
  const startedAt = clock();
  const model = buildPageModel(extraction);
  const mode = isRasterExtraction(extraction) ? "raster" : extraction.layers.length > 0 && model.groups.some((group) => group.layer !== null) ? "layers" : "colours";
  const index = new SegmentIndex(model.segments, Math.max(extraction.width, 1));
  const scale = readPageScale({ texts: extraction.texts, index, width: extraction.width, height: extraction.height, calibration: options.calibration ?? null });
  const legend = mode === "colours" ? readLegend(model) : { version: LEGEND_RULE_VERSION, entries: [], colors: [], boxes: [] };
  // The legend's own codes are not pipe labels.
  const labels = mode === "raster" ? [] : readLabelBlocks(extraction.texts)
    .filter((block) => !legend.boxes.some((box) => boxContains(box, block.centre)));
  let classes: GroupClass[] = classifyByKeywords(model, legend);
  if (mode === "colours") classes = classifyByLabels(model, classes, labels);
  if (mode !== "raster" && options.decisions && options.decisions.size > 0) classes = applyDecisions(model, classes, options.decisions);
  if (options.correspondences && options.correspondences.size > 0) {
    classes = applyCorrespondences(model, classes, options.correspondences, options.correspondenceSource ?? "document");
  }
  const networks = mode === "raster" ? null : measureNetworks({
    model, classes, legendBoxes: legend.boxes, labels, denominator: scale.denominator,
  });
  // Raster pages give no wall to fill between.
  const surfaces = readRoomSurfaces(extraction, scale.denominator, mode === "raster" ? undefined : { model, classes });
  const groups: VectorGroupReading[] = model.groups.map((group, position) => ({
    id: group.id, layer: group.layer, layerName: group.layerName, colors: group.colors, width: group.width, dash: group.dash,
    paths: group.paths, segments: group.segments, closed: group.closed, nearWhite: group.nearWhite, grey: group.grey,
    length_pt: round(group.length_pt),
    bbox: Number.isFinite(group.bbox.x0) ? [round(group.bbox.x0), round(group.bbox.y0), round(group.bbox.x1), round(group.bbox.y1)] : null,
    ...classes[position],
  }));
  return {
    version: VECTOR_READING_VERSION, page: extraction.page, mode, size_pt: [round(extraction.width), round(extraction.height)],
    userUnit: extraction.userUnit, rotate: extraction.rotate,
    counts: { ...extraction.counts, texts: extraction.texts.length, groups: model.groups.length,
      groups_visible: model.groups.filter((group) => !group.nearWhite).length, to_review: groupsToReview(model, classes) },
    scale, legend, groups, detection: detectionShare(model, classes), networks, surfaces,
    timings: { ...extraction.timings, reading_ms: Math.round(clock() - startedAt) },
    memory: extraction.memory,
  };
}

/** Groups measured as a network by this reading (a Decisions proposal under its accepted margin is not). */
export function networkGroups(reading: VectorPageReading) {
  return reading.groups.filter((group) => isMeasuredNetwork(group));
}

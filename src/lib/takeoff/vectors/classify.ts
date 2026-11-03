import type { NetworkCode } from "@/lib/takeoff/bench/keys";
import { NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import { matchLegendColor, type PageLegend } from "@/lib/takeoff/vectors/legend";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import { classOfLayerName, OTHER_CLASSES, type VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// Class of each group (TI-662 step 3). Keywords first: the layer name
// (vocabulary.ts), else the legend colour (legend.ts), else the labels whose
// leaders end on the group (measure.ts classifyByLabels). A near-white or grey
// group is never a network by keyword. Then, in this order of precedence, a
// correspondence of the document (bench truth/groups, or the user's choice in
// the product) replaces it; Decisions (later step) only fills groups still
// without class. « Classé » (detection badge): a class other than « autre »
// from keywords, the user, or Decisions with confidence ≥ 0.8.

export const CLASSIFIED_DECISIONS_CONFIDENCE = 0.8;

export type ClassSource = "keyword" | "legend" | "label" | "document" | "user" | "decisions";
export type GroupClass = {
  class: VectorClass | null;
  source: ClassSource | null;
  confidence: number | null;
  /** Networks a shared legend colour hesitates between: the labels decide per run. */
  candidates: NetworkCode[];
};

const NETWORKS = new Set<string>(NETWORK_CODES);

export function isNetworkClass(value: VectorClass | null): value is NetworkCode {
  return value !== null && NETWORKS.has(value);
}

export function isVectorClass(value: string): value is VectorClass {
  return NETWORKS.has(value) || (OTHER_CLASSES as readonly string[]).includes(value);
}

/** True when the class counts as « classé » in the detection badge. */
export function isClassified(entry: GroupClass) {
  if (entry.class === null || entry.class === "autre") return false;
  if (entry.source === "decisions") return (entry.confidence ?? 0) >= CLASSIFIED_DECISIONS_CONFIDENCE;
  return true;
}

export function classifyByKeywords(model: PageModel, legend: PageLegend): GroupClass[] {
  return model.groups.map((group) => {
    const none: GroupClass = { class: null, source: null, confidence: null, candidates: [] };
    if (group.layer !== null) {
      const found = group.layerName ? classOfLayerName(group.layerName) : null;
      if (found === null || (isNetworkClass(found) && group.grey)) return none;
      return { class: found, source: "keyword", confidence: null, candidates: [] };
    }
    if (group.nearWhite || group.grey) return none;
    const entry = matchLegendColor(legend, group.key.color);
    if (!entry) return none;
    if (entry.network) return { class: entry.network, source: "legend", confidence: null, candidates: [] };
    return { ...none, candidates: entry.candidates };
  });
}

/** Applies document or user correspondences (group id → class) over keywords; never a network on a near-white group. */
export function applyCorrespondences(model: PageModel, classes: readonly GroupClass[], correspondences: ReadonlyMap<string, VectorClass>,
  source: "document" | "user"): GroupClass[] {
  return classes.map((entry, index) => {
    const chosen = correspondences.get(model.groups[index].id);
    if (chosen === undefined) return entry;
    if (isNetworkClass(chosen) && model.groups[index].nearWhite) return entry;
    return { class: chosen, source, confidence: null, candidates: [] };
  });
}

/** Detection badge: classified length ÷ stroke length of the page without near-white strokes, filters ignored. */
export function detectionShare(model: PageModel, classes: readonly GroupClass[]) {
  if (model.visibleLength_pt <= 0) return null;
  let classified = 0;
  model.groups.forEach((group, index) => {
    if (!group.nearWhite && isClassified(classes[index])) classified += group.length_pt;
  });
  return classified / model.visibleLength_pt;
}

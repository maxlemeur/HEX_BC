import type { NetworkCode } from "@/lib/takeoff/bench/keys";
import { NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import { matchLegendColor, type PageLegend } from "@/lib/takeoff/vectors/legend";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import { classOfLayerName, OTHER_CLASSES, type VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// Class of each group (TI-662 step 3). Keywords first: the layer name
// (vocabulary.ts), else the legend colour (legend.ts), else the labels whose
// leaders end on the group (measure.ts classifyByLabels). A near-white or grey
// group is never a network by keyword. Decisions (group-decisions-server.ts)
// then fills only the groups still without class nor legend candidates (a
// shared colour is decided per run by the labels), never with a network on a
// near-white, grey or hidden group; a correspondence of the document (bench
// truth/groups, or the user's choice in the product) replaces any of them.
// « Classé » (detection badge): a class other than « autre » from keywords, the
// document, the user, or Decisions with confidence ≥ 0.8. A Decisions network
// under 0.8 is a proposal shown with its confidence: it is never measured
// (isMeasuredNetwork), nor kept out of the leaders and diagram frames.

export const CLASSIFIED_DECISIONS_CONFIDENCE = 0.8;

export type ClassSource = "keyword" | "legend" | "label" | "document" | "user" | "decisions";
/** How the lab and the review name the source of a class. */
export const CLASS_SOURCE_LABELS: Record<ClassSource, string> = {
  keyword: "mots-clés", legend: "légende", label: "libellés", document: "document", user: "utilisateur", decisions: "Decisions",
};
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

/** A network the measure takes: any network class, a Decisions one only at confidence ≥ CLASSIFIED_DECISIONS_CONFIDENCE. */
export function isMeasuredNetwork(entry: GroupClass): entry is GroupClass & { class: NetworkCode } {
  if (!isNetworkClass(entry.class)) return false;
  return entry.source !== "decisions" || (entry.confidence ?? 0) >= CLASSIFIED_DECISIONS_CONFIDENCE;
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
    if (group.hidden) return none;
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
    if (isNetworkClass(chosen) && (model.groups[index].nearWhite || model.groups[index].hidden)) return entry;
    return { class: chosen, source, confidence: null, candidates: [] };
  });
}

export type DecisionsAnswer = { class: VectorClass; confidence: number };

/**
 * Applies Decisions answers (group id → class and confidence) to the groups left without class nor candidates,
 * after keywords and label votes, before the correspondences. A network answer on a near-white, grey or hidden
 * group is dropped (TI-658: the background is never a network); so is an answer outside the classes or with a
 * confidence outside [0, 1].
 */
export function applyDecisions(model: PageModel, classes: readonly GroupClass[], decisions: ReadonlyMap<string, DecisionsAnswer>): GroupClass[] {
  return classes.map((entry, index) => {
    const group = model.groups[index];
    const answer = decisions.get(group.id);
    if (!answer || entry.class !== null || entry.candidates.length > 0) return entry;
    if (!isVectorClass(answer.class) || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) return entry;
    if (isNetworkClass(answer.class) && (group.nearWhite || group.grey || group.hidden)) return entry;
    return { class: answer.class, source: "decisions", confidence: answer.confidence, candidates: [] };
  });
}

/** Detection badge: classified length ÷ stroke length of the page without near-white strokes, filters ignored. */
export function detectionShare(model: PageModel, classes: readonly GroupClass[]) {
  if (model.visibleLength_pt <= 0) return null;
  let classified = 0;
  model.groups.forEach((group, index) => {
    if (!group.hidden && isClassified(classes[index])) classified += group.visibleLength_pt;
  });
  return classified / model.visibleLength_pt;
}

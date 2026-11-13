import type { NetworkCode } from "@/lib/takeoff/bench/keys";
import { NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import { matchLegendColor, type PageLegend } from "@/lib/takeoff/vectors/legend";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import { classOfLayerName, OTHER_CLASSES, type VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// Class of each group (TI-662 step 3). Keywords first: the layer name
// (vocabulary.ts), else the legend colour (legend.ts), else the labels whose
// leaders end on the group (measure.ts classifyByLabels). A near-white or grey
// group is never a network by keyword. The classification of the candidates
// (group-decisions-server.ts, TI-704) then fills only the groups still without
// class nor legend candidates (a shared colour is decided per run by the
// labels): its rules (group-rules.ts: same colour, band, propagation; source
// « rule », always accepted) and Decisions' answers, never with a network on a
// near-white, grey or hidden group; a correspondence of the document (bench
// truth/groups, or the user's choice in the product) replaces any of them.
// Decisions' `confidence` is the margin p1 − p2 between its two most probable
// classes, never the probability of its answer (measured 12/11/2026: 0.58 /
// 0.42 gives 0.16). A Decisions class counts from DECISIONS_ACCEPTED_MARGIN
// (0.5, TI-704: every answer above it was right on the development plans, and
// no false network; provisional until the reserve pass). « Classé » (detection
// badge): a class other than « autre » from keywords, rules, the document, the
// user, or Decisions at its accepted margin. A Decisions network under it is a
// proposal shown with its confidence: it is never measured (isMeasuredNetwork),
// nor kept out of the leaders and diagram frames. A group left « à revoir » may
// carry a proposal in words (« canalisation hors nomenclature : E-M. ») for the
// person who maps it.

/** Decisions' margin p1 − p2 from which its class is accepted (TI-704, provisional until the reserve pass). */
export const DECISIONS_ACCEPTED_MARGIN = 0.5;
/** Smallest share of the page's visible stroke length a group needs to be asked of Decisions, or counted « à revoir ». */
export const DECISIONS_MIN_SHARE = 0.001;

export type ClassSource = "keyword" | "legend" | "label" | "rule" | "document" | "user" | "decisions";
/** How the lab and the review name the source of a class. */
export const CLASS_SOURCE_LABELS: Record<ClassSource, string> = {
  keyword: "mots-clés", legend: "légende", label: "libellés", rule: "règles", document: "document", user: "utilisateur", decisions: "Decisions",
};
export type GroupClass = {
  class: VectorClass | null;
  source: ClassSource | null;
  confidence: number | null;
  /** Networks a shared legend colour hesitates between: the labels decide per run. */
  candidates: NetworkCode[];
  /** A group left « à revoir » with what the classification proposes in words (TI-704 « hors_liste »). */
  proposal?: string;
};

/** The confidence a class of this source needs to count; null when every class of it counts. */
export function acceptedConfidence(source: ClassSource | null): number | null {
  return source === "decisions" ? DECISIONS_ACCEPTED_MARGIN : null;
}

function accepted(entry: GroupClass) {
  const needed = acceptedConfidence(entry.source);
  return needed === null || (entry.confidence ?? 0) >= needed;
}

const NETWORKS = new Set<string>(NETWORK_CODES);

export function isNetworkClass(value: VectorClass | null): value is NetworkCode {
  return value !== null && NETWORKS.has(value);
}

export function isVectorClass(value: string): value is VectorClass {
  return NETWORKS.has(value) || (OTHER_CLASSES as readonly string[]).includes(value);
}

/** A network the measure takes: any network class, a Decisions one only at its accepted margin (DECISIONS_ACCEPTED_MARGIN). */
export function isMeasuredNetwork(entry: GroupClass): entry is GroupClass & { class: NetworkCode } {
  return isNetworkClass(entry.class) && accepted(entry);
}

/** True when the class counts as « classé » in the detection badge. */
export function isClassified(entry: GroupClass) {
  if (entry.class === null || entry.class === "autre") return false;
  return accepted(entry);
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

/**
 * What the classification of the candidates gives a group (group-decisions-server.ts): a class, from the rules (source
 * « rule », no confidence) or Decisions (its margin); or none, with a proposal in words. Without source, Decisions.
 */
export type DecisionsAnswer = { class: VectorClass | null; confidence: number | null; source?: "decisions" | "rule"; proposal?: string };

/**
 * Applies the classification's answers (group id → class, source and confidence) to the groups left without class nor
 * candidates, after keywords and label votes, before the correspondences. A network on a near-white, grey or hidden
 * group is dropped (TI-658: the background is never a network); so is a class outside the classes, a Decisions class
 * without a confidence in [0, 1], or a rule's class with one. An answer without class gives its proposal only.
 */
export function applyDecisions(model: PageModel, classes: readonly GroupClass[], decisions: ReadonlyMap<string, DecisionsAnswer>): GroupClass[] {
  return classes.map((entry, index) => {
    const group = model.groups[index];
    const answer = decisions.get(group.id);
    if (!answer || entry.class !== null || entry.candidates.length > 0) return entry;
    if (answer.class === null) return answer.proposal ? { ...entry, proposal: answer.proposal.slice(0, 120) } : entry;
    const source = answer.source ?? "decisions";
    if (!isVectorClass(answer.class)) return entry;
    if (source === "decisions" && (answer.confidence === null || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) return entry;
    if (source === "rule" && answer.confidence !== null) return entry;
    if (isNetworkClass(answer.class) && (group.nearWhite || group.grey || group.hidden)) return entry;
    return { class: answer.class, source, confidence: source === "rule" ? null : answer.confidence, candidates: [] };
  });
}

/**
 * Groups the review must still decide (TI-662 L3d): visible (neither hidden nor near-white), without legend candidates
 * (the labels decide them per run), of at least DECISIONS_MIN_SHARE of the page's visible stroke length, with no class
 * or a Decisions class under its accepted margin. Counted on the whole page, before the page record keeps its longest groups.
 */
export function groupsToReview(model: PageModel, classes: readonly GroupClass[]) {
  if (model.visibleLength_pt <= 0) return 0;
  return model.groups.filter((group, index) => {
    const entry = classes[index];
    if (group.hidden || group.nearWhite || entry.candidates.length > 0) return false;
    if (group.visibleLength_pt / model.visibleLength_pt < DECISIONS_MIN_SHARE) return false;
    return entry.class === null || !accepted(entry);
  }).length;
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

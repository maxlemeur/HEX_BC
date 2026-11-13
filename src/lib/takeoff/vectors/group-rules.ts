import { NETWORK_CODES, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { isNetworkClass } from "@/lib/takeoff/vectors/classify";
import { GROUP_EVIDENCE, labelHeadCode, OTHER_ANSWERS, type CandidateEvidence, type PageEvidence } from "@/lib/takeoff/vectors/group-evidence";
import { PARENT_NETWORK } from "@/lib/takeoff/vectors/legend";
import type { VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// The classification of a page's candidates around the model (TI-704, option
// A of 12/11/2026), pure:
// - rules first, without a model: the same colour as a network of the keyword
//   reading gives that network (its exact class: the colour carries the
//   direction); else a band along a network (GROUP_EVIDENCE.band: at least
//   half of its length parallel within 3° at ≤ 4 pt, 80 % agreeing) gives its
//   family (the band never shows the direction: along a supply alone, it may
//   be the return beside it). Never on a grey group nor on a group whose
//   every colour is pale;
// - a model's answer is read as a distribution over classes: the answers that
//   give one class add up (« gaine » and « symbole » are « autre »), « inconnu »
//   gives none, « hors_liste » stays apart. The decided class is the most
//   probable, its confidence the margin p1 − p2 over the next class. A
//   network under the threshold whose family (CHW-S, CHW-R and CHW, whichever
//   leads) clears it gives the parent, at the family's margin over the best
//   class outside it;
// - « inconnu » and « hors_liste » give no class: the group stays « à revoir »,
//   « hors_liste » with its proposal (« canalisation hors nomenclature : E-M. »,
//   the code its labels start with), for a person to map;
// - a network answer on a pale group of a colour page is dropped (a sanitary
//   fixture's beige outline was the only false network of the measures);
// - propagation, until nothing changes: a candidate still open whose every
//   key colour (group-evidence.ts keyColors: never black, grey or near-white)
//   is a colour of accepted candidates takes their network, when they all give
//   the same one, never on a grey or pale group.

export type RuleSource = "same_colour" | "band" | "propagated";
export type RuleClass = { class: NetworkCode; rule: RuleSource };
/** A model's answer read: the class (null: « inconnu », « hors_liste » or none), its margin, and a « hors_liste » proposal. */
export type ReadAnswer = { class: VectorClass | null; confidence: number | null; proposal: string | null };

const single = (value: CandidateEvidence["rules"]["same_colour"]) => (typeof value === "string" ? value : null);

/** Whether the rules and the propagation may give this candidate a network: never a grey group nor a pale one. */
export function mayTakeRule(candidate: Pick<CandidateEvidence, "stats" | "pale">) {
  return !candidate.stats.grey && !candidate.pale;
}

/** The class the rules give a candidate before any model, or null: same colour, then band. */
export function ruleClassOf(candidate: Pick<CandidateEvidence, "stats" | "pale" | "rules">): RuleClass | null {
  if (!mayTakeRule(candidate)) return null;
  const same = single(candidate.rules.same_colour);
  if (same) return { class: same, rule: "same_colour" };
  const { band } = candidate.rules;
  if (band.network && band.share >= GROUP_EVIDENCE.band.minShare && (band.agreement ?? 0) >= GROUP_EVIDENCE.band.minAgreement) {
    // The family, never a direction: a band along a supply alone may be the return beside it.
    return { class: PARENT_NETWORK[band.network] ?? band.network, rule: "band" };
  }
  return null;
}

const NETWORKS = new Set<string>(NETWORK_CODES);
const OTHER_CLASS = new Map<string, VectorClass | "hors_liste" | null>(OTHER_ANSWERS.map((entry) => [entry.value, entry.value === "hors_liste" ? "hors_liste" : entry.class]));

/** The class an answer value gives: a network, a class of OTHER_ANSWERS, « hors_liste », or null (« inconnu », unknown value). */
export function classOfAnswer(value: string): VectorClass | "hors_liste" | null {
  if (NETWORKS.has(value)) return value as NetworkCode;
  return OTHER_CLASS.get(value) ?? null;
}

/** A label's head that names a network, never its size (« DN250 », « Ø40 »). */
function codeOf(text: string) {
  const head = labelHeadCode(text);
  return head && !/^(?:DN|D|Ø|ø)\s?\d/i.test(head) ? head : null;
}

/** The code a « hors_liste » group's labels start with (« E-M. »), the most frequent, else the first of its nearby texts. */
export function proposalCode(candidate: Pick<CandidateEvidence, "leader_labels" | "texts">) {
  const counts = new Map<string, number>();
  for (const entry of candidate.leader_labels) {
    const head = codeOf(entry.text);
    if (head) counts.set(head, (counts.get(head) ?? 0) + entry.count);
  }
  const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (best) return best;
  for (const entry of candidate.texts) {
    const head = codeOf(entry.text);
    if (head) return head;
  }
  return null;
}

export function horsListeProposal(candidate: Pick<CandidateEvidence, "leader_labels" | "texts">) {
  const code = proposalCode(candidate);
  return code ? `canalisation hors nomenclature : ${code}` : "canalisation hors nomenclature";
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * An answer's distribution read at `threshold` (module comment). `probabilities` are the provider's per answer value;
 * without them, the answered value alone at its confidence.
 */
export function readAnswerDistribution(probabilities: ReadonlyArray<{ value: string | boolean | number; probability: number }>, threshold: number,
  candidate: Pick<CandidateEvidence, "leader_labels" | "texts">): ReadAnswer {
  const mass = new Map<VectorClass | "hors_liste" | null, number>();
  for (const entry of probabilities) {
    if (!Number.isFinite(entry.probability) || entry.probability < 0) continue;
    const value = classOfAnswer(String(entry.value));
    mass.set(value, (mass.get(value) ?? 0) + entry.probability);
  }
  const sorted = [...mass.entries()].sort((left, right) => right[1] - left[1]);
  if (sorted.length === 0) return { class: null, confidence: null, proposal: null };
  const [top, second] = [sorted[0], sorted[1] ?? [null, 0] as const];
  // Margins are rounded before they meet the threshold: the stored confidence and the decision always agree.
  let decided: { class: VectorClass | "hors_liste" | null; margin: number } = { class: top[0], margin: round(top[1] - second[1]) };
  if (isNetworkClass(decided.class as VectorClass | null) && decided.margin < threshold) {
    // The family of the most probable network (a supply, its return and their parent), whichever of them leads.
    const leading = decided.class as NetworkCode;
    const parent = PARENT_NETWORK[leading] ?? leading;
    const family = (value: VectorClass | "hors_liste" | null) => value !== null && (value === parent || PARENT_NETWORK[value as NetworkCode] === parent);
    const familyMass = sorted.filter(([value]) => family(value)).reduce((sum, [, share]) => sum + share, 0);
    const outside = sorted.find(([value]) => !family(value))?.[1] ?? 0;
    const margin = round(familyMass - outside);
    if (margin >= threshold) decided = { class: parent, margin };
  }
  if (decided.class === "hors_liste") return { class: null, confidence: decided.margin, proposal: horsListeProposal(candidate) };
  return { class: decided.class, confidence: decided.margin, proposal: null };
}

export type ChainEntry = {
  class: VectorClass | null;
  confidence: number | null;
  source: "rule" | "model";
  rule?: RuleSource;
  proposal?: string;
};

/**
 * Propagation (module comment) over a page's candidates: `entries` by group id, each accepted when `accepted` says so;
 * returns the groups it gave a network, with that network. `colours` are the candidates' own colours.
 */
export function propagateSameColour(candidates: ReadonlyArray<Pick<CandidateEvidence, "id" | "stats" | "pale" | "keyColors">>, entries: Map<string, ChainEntry>,
  accepted: (entry: ChainEntry) => boolean) {
  const given = new Map<string, NetworkCode>();
  for (let round = 0; round < candidates.length + 1; round += 1) {
    const byColour = new Map<string, Set<NetworkCode>>();
    for (const candidate of candidates) {
      const entry = entries.get(candidate.id);
      if (!entry || !accepted(entry) || !isNetworkClass(entry.class)) continue;
      for (const color of candidate.keyColors) byColour.set(color, new Set([...(byColour.get(color) ?? []), entry.class]));
    }
    let changed = false;
    for (const candidate of candidates) {
      const entry = entries.get(candidate.id);
      if ((entry && accepted(entry)) || !mayTakeRule(candidate)) continue;
      if (candidate.keyColors.length === 0 || !candidate.keyColors.every((color) => byColour.has(color))) continue;
      const networks = new Set(candidate.keyColors.flatMap((color) => [...(byColour.get(color) ?? [])]));
      if (networks.size !== 1) continue;
      const [network] = networks;
      entries.set(candidate.id, { class: network, confidence: null, source: "rule", rule: "propagated" });
      given.set(candidate.id, network);
      changed = true;
    }
    if (!changed) break;
  }
  return given;
}

/** Whether a network answer of the model is dropped by the pale guard (a colour page, every visible colour pale). */
export function paleGuardDrops(evidence: Pick<PageEvidence, "mode">, candidate: Pick<CandidateEvidence, "pale">, value: VectorClass | null) {
  return evidence.mode === "colours" && candidate.pale && isNetworkClass(value);
}

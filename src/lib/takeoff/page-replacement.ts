// TI-682 lot D, PR 2: re-measuring a page replaces its earlier measure, line by line. Pure and shared by the server
// proposal (page-replacement-server.ts), the wizard's step and the measurement on stored bench outputs.
//
// For each page another takeoff already brought, the server proposes which new line replaces which earlier estimate
// line; the estimator sees it and corrects it. An earlier estimate line keeps its identity, title, price, category and
// settings: its quantity loses the page's earlier part and receives the new one (the database computes it the same way,
// private.takeoff_replace_pages). Pairs are proposed between a new line and an earlier source line of the page:
// 1. the same designation and the same unit as the source line (not the estimate line's title, which the estimator may
//    have renamed);
// 2. for a vector line, the same network identity (kind, network, material, DN) and the same unit;
// 3. the same unit and a close designation (Jaccard index of the words ≥ 0.5, against the source line or the estimate
//    line's title), the best one.
// Each earlier source line serves once; several new lines may replace the sources of one estimate line (a length merged
// once rounded). A different unit is never paired: it is another quantity. A DPGF target is never paired: its own policy
// replaces it per takeoff. A new line known only by its file name is not paired on a page where two identified documents
// of that name meet: the database refuses to replace across two documents.

import { normalizeMeasurementUnit, measurementUnitToken } from "@/lib/units/normalize";
import { isSameDocument, isSamePage, type TakeoffPageDocument, type TakeoffPageIdentity } from "@/lib/takeoff/page-contributions";

export type RuleIdentity = { kind?: string | null; network?: string | null; material?: string | null; dn?: string | number | null } | null;

/** A line of the new takeoff on the page. */
export type ReplacementNewLine = {
  id: string;
  designation: string;
  unit: string;
  quantity: number;
  rule_inputs?: RuleIdentity;
  identity: TakeoffPageIdentity | null;
};
/** A frozen line of an earlier takeoff the estimate line names, on the page. */
export type ReplacementSourceLine = {
  id: string;
  job_id: string;
  designation: string;
  unit: string;
  quantity: number;
  rule_inputs?: RuleIdentity;
  identity: TakeoffPageIdentity | null;
};
/** An earlier estimate line of the page, with its source lines there (none for an engine 1/2 line). */
export type ReplacementCandidate = {
  id: string;
  title: string;
  unit_code: string | null;
  description: string | null;
  pricing_status: string;
  source_provider: string | null;
  sources: ReplacementSourceLine[];
};
export type ProposedPair = {
  takeoff_item_id: string;
  estimate_item_id: string;
  /** The earlier source line it replaces; null for an engine 1/2 line. */
  source_item_id: string | null;
  reason: "same_designation" | "same_network" | "similar_designation" | "merge";
};

const LENGTH_FACTORS: Record<string, number> = { m: 1, ml: 1, metre: 1, metres: 1, cm: 0.01, mm: 0.001, km: 1000 };

/** The unit a quantity is counted in: a unit code, or a status mention; null when the referential does not know it. */
export function unitKey(raw: string | null | undefined): string | null {
  const resolved = normalizeMeasurementUnit(raw);
  return resolved.unitCode ?? (resolved.pricingStatus ? `status:${resolved.pricingStatus}` : null);
}

/** An estimate line's unit, as the database reads it (its code, else its v1/v2 description, else its status). */
export function estimateLineUnitKey(line: { unit_code: string | null; description: string | null; pricing_status: string }) {
  return line.unit_code ?? normalizeMeasurementUnit(line.description).unitCode ?? `status:${line.pricing_status}`;
}

/** Metres per unit of a length (the factor finalize_takeoff_lengths rounds with), null for any other unit. */
export function lengthFactor(line: { unit_code: string | null; description: string | null }) {
  const raw = line.unit_code ?? line.description;
  if (!raw) return null;
  const code = normalizeMeasurementUnit(raw).unitCode ?? measurementUnitToken(raw);
  return LENGTH_FACTORS[code] ?? null;
}

/** A measured quantity as the estimate holds it: a length rounded up once to its unit. */
export function roundedMeasure(raw: number, factor: number | null) {
  if (factor === null) return raw;
  return Math.ceil(raw * factor - 1e-9) / factor;
}

const normalizedDesignation = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
/** Words of a designation without accents; a one-letter word only when it is a digit. */
export function designationTokens(value: string) {
  const ascii = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return new Set((ascii.match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 1 || /^\d$/.test(token)));
}
export function jaccard(left: string, right: string) {
  const a = designationTokens(left);
  const b = designationTokens(right);
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / union;
}
const sameRuleIdentity = (left: RuleIdentity | undefined, right: RuleIdentity | undefined) => {
  if (!left?.kind || !right?.kind) return false;
  return String(left.kind) === String(right.kind) && String(left.network ?? "") === String(right.network ?? "")
    && String(left.material ?? "") === String(right.material ?? "") && String(left.dn ?? "") === String(right.dn ?? "");
};

const identified = (document: TakeoffPageDocument | undefined) => Boolean(document?.plan_file_id || document?.content_hash);

/**
 * Whether a new line may replace an earlier source line: the same document (never across two documents), and, for a new
 * line known only by its file name, no other identified document of that name on the page.
 */
export function mayReplaceAcrossDocuments(newLine: ReplacementNewLine, source: ReplacementSourceLine | null,
  pageSources: readonly ReplacementSourceLine[]) {
  if (!source) return true;
  if (!newLine.identity || !source.identity) return false;
  if (!isSameDocument(newLine.identity.document, source.identity.document)) return false;
  if (identified(newLine.identity.document)) return true;
  return !pageSources.some((other) => other.identity && identified(other.identity.document)
    && isSamePage(newLine.identity!, other.identity) && !isSameDocument(other.identity.document, source.identity!.document));
}

/**
 * The pairs proposed on one page: each new line with at most one earlier source line (or one engine 1/2 estimate line),
 * in three passes from the strictest. `forced` pairs (those « Fusionner » makes on a DPGF version) come first and are kept.
 */
export function proposePagePairs(input: {
  newLines: readonly ReplacementNewLine[];
  candidates: readonly ReplacementCandidate[];
  forced?: readonly ProposedPair[];
}): ProposedPair[] {
  const pairs: ProposedPair[] = [...(input.forced ?? [])];
  const paired = new Set(pairs.map((pair) => pair.takeoff_item_id));
  const usedSources = new Set(pairs.flatMap((pair) => (pair.source_item_id ? [pair.source_item_id] : [])));
  const usedLegacy = new Set(pairs.filter((pair) => pair.source_item_id === null).map((pair) => pair.estimate_item_id));
  const candidates = input.candidates.filter((candidate) => candidate.source_provider !== "dpgf");
  const pageSources = candidates.flatMap((candidate) => candidate.sources);
  type Slot = { candidate: ReplacementCandidate; source: ReplacementSourceLine | null; unit: string };
  const slots: Slot[] = candidates.flatMap((candidate): Slot[] => {
    const lineUnit = estimateLineUnitKey(candidate);
    if (candidate.sources.length === 0) return [{ candidate, source: null, unit: lineUnit }];
    return candidate.sources.map((source) => ({ candidate, source, unit: lineUnit }));
  });
  const free = (slot: Slot) => (slot.source ? !usedSources.has(slot.source.id) : !usedLegacy.has(slot.candidate.id));
  const take = (line: ReplacementNewLine, slot: Slot, reason: ProposedPair["reason"]) => {
    pairs.push({ takeoff_item_id: line.id, estimate_item_id: slot.candidate.id, source_item_id: slot.source?.id ?? null, reason });
    paired.add(line.id);
    if (slot.source) usedSources.add(slot.source.id);
    else usedLegacy.add(slot.candidate.id);
  };
  const eligible = (line: ReplacementNewLine, slot: Slot) => {
    const unit = unitKey(line.unit);
    if (unit === null || unit !== slot.unit) return false;
    if (slot.source && unitKey(slot.source.unit) !== unit) return false;
    return mayReplaceAcrossDocuments(line, slot.source, pageSources);
  };
  const passes: Array<[ProposedPair["reason"], (line: ReplacementNewLine, slot: Slot) => number]> = [
    ["same_designation", (line, slot) => (normalizedDesignation(slot.source?.designation ?? slot.candidate.title)
      === normalizedDesignation(line.designation) ? 1 : 0)],
    ["same_network", (line, slot) => (slot.source && sameRuleIdentity(line.rule_inputs, slot.source.rule_inputs) ? 1 : 0)],
    ["similar_designation", (line, slot) => {
      const score = Math.max(slot.source ? jaccard(line.designation, slot.source.designation) : 0, jaccard(line.designation, slot.candidate.title));
      return score >= 0.5 ? score : 0;
    }],
  ];
  for (const [reason, score] of passes) {
    for (const line of input.newLines) {
      if (paired.has(line.id)) continue;
      let best: Slot | null = null;
      let bestScore = 0;
      for (const slot of slots) {
        if (!free(slot) || !eligible(line, slot)) continue;
        const value = score(line, slot);
        if (value > bestScore) {
          best = slot;
          bestScore = value;
        }
      }
      if (best) take(line, best, reason);
    }
  }
  return pairs;
}

/**
 * What « Fusionner » (merge) would do on the target section, as private.takeoff_apply_v3_lines does it: a new line and an
 * existing line of the section with the same title (spaces reduced, lower case) and unit, at the same rank. On a DPGF
 * version, where merging is required, these pairs are imposed.
 */
export function mergeMatches(newLines: ReadonlyArray<{ id: string; designation: string; unit: string }>,
  sectionLines: ReadonlyArray<{ id: string; title: string; unit_code: string | null; pricing_status: string; position: number }>) {
  const key = (title: string, unit: string) => `${normalizedDesignation(title)}\u0000${unit}`;
  const existing = new Map<string, string[]>();
  for (const line of [...sectionLines].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    const unit = line.unit_code ?? `status:${line.pricing_status}`;
    const list = existing.get(key(line.title, unit)) ?? [];
    list.push(line.id);
    existing.set(key(line.title, unit), list);
  }
  const ranks = new Map<string, number>();
  const matches = new Map<string, string>();
  for (const line of newLines) {
    const resolved = normalizeMeasurementUnit(line.unit);
    const unit = resolved.unitCode ?? (resolved.pricingStatus ? `status:${resolved.pricingStatus}` : null);
    if (!unit) continue;
    const lineKey = key(line.designation, unit);
    const rank = ranks.get(lineKey) ?? 0;
    ranks.set(lineKey, rank + 1);
    const target = existing.get(lineKey)?.[rank];
    if (target) matches.set(line.id, target);
  }
  return matches;
}

/** The quantities a decision gives an earlier line: its measure now, the part the replaced pages remove, the new one. */
export function replacementQuantities(input: {
  quantity: number | null;
  /** Metres per unit of a length (lengthFactor), null for any other unit. */
  factor: number | null;
  /** Every source line of the estimate line, with its quantity (none for an engine 1/2 line). */
  sources: ReadonlyArray<{ id: string; quantity: number }>;
  removedSourceIds: ReadonlySet<string>;
  added: ReadonlyArray<{ quantity: number }>;
}) {
  const factor = input.factor;
  const current = input.quantity ?? 0;
  const legacy = input.sources.length === 0;
  const measuredRaw = legacy ? current : input.sources.reduce((total, source) => total + source.quantity, 0);
  const measured = legacy ? current : roundedMeasure(measuredRaw, factor);
  const keptRaw = legacy ? 0 : input.sources.filter((source) => !input.removedSourceIds.has(source.id))
    .reduce((total, source) => total + source.quantity, 0);
  const addedRaw = input.added.reduce((total, line) => total + line.quantity, 0);
  return {
    current,
    measured,
    /** The estimator typed another quantity than the one its sources give (never for an engine 1/2 line). */
    changedByHand: !legacy && Math.abs(current - measured) > 1e-9,
    next: roundedMeasure(keptRaw + addedRaw, factor),
  };
}

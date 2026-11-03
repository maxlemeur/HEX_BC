import { DEFAULT_LOW_CONFIDENCE_THRESHOLD, MEDIUM_CONFIDENCE_CEILING, checkApplyGuard } from "@/lib/takeoff/guards";
import { isRuleBlocked } from "@/lib/takeoff/rules/blocking";
import { evaluateTakeoffRules, type RuleLine } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffItem } from "@/lib/takeoff/types";

// The fixed rules on the bench (TI-664 acceptance): each line of a reading is
// rejected, uncertain or at high confidence, as the apply guard would see it
// with nobody's decision yet (not verified, not excluded):
// - rejected: in the guard's blocked items (confidence under the threshold or
//   missing, missing proof or page), and after the rules a failed rule too;
// - uncertain: in its medium items (threshold ≤ confidence < 0.8);
// - high confidence: neither, confidence ≥ 0.8.
// Before the rules a line is classed by the guard alone, after them by the
// guard and its rule results. Lines without precomputed results (a level C
// answer) are read in their designation: DN × network and non-observable
// quantities; the geometry rules run in the vector pipeline (vector-run.ts).

export type GuardTier = "rejected" | "uncertain" | "high";
export type TierCounts = Record<GuardTier, number>;

export function emptyTierCounts(): TierCounts {
  return { rejected: 0, uncertain: 0, high: 0 };
}

export function countTiers(tiers: readonly GuardTier[]): TierCounts {
  const counts = emptyTierCounts();
  for (const tier of tiers) counts[tier] += 1;
  return counts;
}

/** Tiers of a document's lines, before (results null) or after the rules. */
export function guardTiers(items: readonly TakeoffItem[], results: ReadonlyArray<readonly TakeoffRuleResult[] | null> | null,
  threshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD): GuardTier[] {
  const rows = items.map((item, index) => ({
    id: String(index), designation: item.designation, confidence: item.confidence ?? null, evidence: item.evidence ?? null,
    source_page: item.source_page ?? null, is_verified: false, is_excluded: false,
  }));
  const guard = checkApplyGuard(rows, threshold);
  const blocked = new Set(guard.blocked_items.map((entry) => entry.item_id));
  const medium = new Set(guard.medium_items.map((entry) => entry.item_id));
  return items.map((item, index) => {
    if (blocked.has(String(index)) || (results !== null && isRuleBlocked(results[index], false, false))) return "rejected";
    if (medium.has(String(index))) return "uncertain";
    return typeof item.confidence === "number" && item.confidence >= MEDIUM_CONFIDENCE_CEILING ? "high" : "uncertain";
  });
}

/** Rule results of lines read in their designation only (no page, no geometry): DN × network, non-observable. */
export function designationRuleResults(items: readonly TakeoffItem[]): TakeoffRuleResult[][] {
  const lines: RuleLine[] = items.map((item, index) => ({
    id: String(index), job_id: "bench", page_key: null, designation: item.designation, unit: item.unit, quantity: item.quantity,
    is_excluded: false, frozen: false, geometry: null,
    inputs: ruleInputsFromDesignation({ designation: item.designation, category: item.category ?? null, evidence: item.evidence ?? null,
      unit: item.unit, quantity: item.quantity }),
  }));
  const { results } = evaluateTakeoffRules({ lines, pages: [] });
  return items.map((_, index) => results.get(String(index)) ?? []);
}

/** Failed rule codes of a document's lines, counted. */
export function failedCodes(results: ReadonlyArray<readonly TakeoffRuleResult[] | null>) {
  const counts: Record<string, number> = {};
  for (const entry of results.flatMap((list) => list ?? [])) {
    if (entry.status === "fail") counts[entry.code] = (counts[entry.code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (left < right ? -1 : 1)));
}

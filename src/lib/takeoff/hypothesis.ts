// TI-682 lot B (D11, D12): what an hypothesis is, once. A line's quantity is an hypothesis when nothing attests it:
// - its author entered it as one (quantity_entry_category « hypothesis », TI-686 D12);
// - or nobody attested it (no entry category) and either the takeoff was asked for an estimate
//   (metadata.quantity_nature « estimated », written by the worker from the preparation's objective), or the plan
//   cannot show it (metadata.rule_inputs.non_observable: a weld, a support, a vertical run…, TI-664).
// An entry attested on anything else (a site survey, another drawing…) is no hypothesis any more.
// The same reading runs in SQL (public.takeoff_item_hypothesis_cause, migration
// 20261111035718_takeoff_hypothesis_preselection.sql), on the vectors of
// supabase/tests/database/takeoff-hypothesis-preselection.test.sql, which hypothesis.test.ts reads.
//
// An hypothesis is never preselected (D11): the worker inserts it excluded, with the reason below, and the insert
// trigger does the same for any other writer. It stays in the targeted review until someone decides it: entering its
// quantity with what it rests on, or including it, is that decision.

export type TakeoffHypothesisCause = "entered_hypothesis" | "estimated" | "non_observable";

type HypothesisLine = { metadata?: unknown; quantity_entry_category?: string | null };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Why a line's quantity is an hypothesis, or null when it is not one. */
export function takeoffHypothesisCause(line: HypothesisLine): TakeoffHypothesisCause | null {
  const category = line.quantity_entry_category ?? null;
  if (category === "hypothesis") return "entered_hypothesis";
  if (category !== null) return null;
  const metadata = record(line.metadata);
  if (metadata.quantity_nature === "estimated") return "estimated";
  const cause = record(metadata.rule_inputs).non_observable;
  return typeof cause === "string" && cause !== "" ? "non_observable" : null;
}

/**
 * The exclusion reasons of a line that arrives as an hypothesis; the insert trigger writes the same texts. They are
 * stored with each line and read back to tell an hypothesis nobody decided (isUndecidedHypothesis): rewording one
 * needs a migration of the stored reasons.
 */
export const TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS = {
  estimated: "Hypothèse non présélectionnée : quantité estimée, sans mesure sur un plan. Incluez la ligne pour la compter.",
  non_observable: "Hypothèse non présélectionnée : quantité non lisible sur un plan. Saisissez-la avec sa justification pour la compter.",
} as const;

/** The exclusion a new line starts with: an hypothesis nobody attested is excluded with its reason; any other line is left as given. */
export function hypothesisPreselection(line: HypothesisLine): { is_excluded: true; exclusion_reason: string } | null {
  const cause = takeoffHypothesisCause(line);
  return cause === "estimated" || cause === "non_observable"
    ? { is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS[cause] } : null;
}

/**
 * An hypothesis still excluded as it arrived: nobody decided it. A line someone excluded carries their own reason,
 * and a line someone included is no longer excluded.
 */
export function isUndecidedHypothesis(line: { is_excluded: boolean; exclusion_reason?: string | null }) {
  return line.is_excluded && (line.exclusion_reason === TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated
    || line.exclusion_reason === TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable);
}

/**
 * The lines as the worker's source selection reads them (TI-681): an hypothesis that arrived excluded still is an
 * alternative reading of its page. Read as included, it is paired with a comparable vector measure as any other line,
 * and the application refuses both together.
 */
export function withUndecidedHypothesesAsAlternatives<T extends { is_excluded: boolean; exclusion_reason?: string | null }>(lines: readonly T[]): T[] {
  return lines.map((line) => (isUndecidedHypothesis(line) ? { ...line, is_excluded: false } : line));
}

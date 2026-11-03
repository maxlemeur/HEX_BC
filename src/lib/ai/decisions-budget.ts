/**
 * Token ceiling for a series of OpenAI Decisions calls (bench
 * `--max-decisions-tokens`, product per-run caps such as the page triage).
 *
 * Decisions has no max-tokens parameter, so the ceiling is enforced before
 * each call: a call may start only if the tokens already spent, plus one
 * reserve per call in flight and per new call, stay within the ceiling. The
 * reserve is the largest `total_tokens` observed so far, or the initial
 * estimate before the first answer. A failed call (`usage: null`) counts as a
 * call with no known tokens.
 */
export type DecisionsTokenBudget = {
  readonly maxTokens: number;
  /** Reserves a slot; false means the next call could exceed the ceiling. */
  tryStart(): boolean;
  /** Releases the slot of a started call and records its usage. */
  finish(usage: { total_tokens: number } | null): void;
  snapshot(): DecisionsTokenBudgetSnapshot;
};

export type DecisionsTokenBudgetSnapshot = {
  max_tokens: number;
  spent_tokens: number;
  calls: number;
  calls_without_usage: number;
  refused_starts: number;
  largest_call_tokens: number;
};

export function createDecisionsTokenBudget(maxTokens: number, initialEstimate: number): DecisionsTokenBudget {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error("Le plafond de jetons Decisions doit être un entier positif.");
  if (!Number.isSafeInteger(initialEstimate) || initialEstimate < 1) throw new Error("L’estimation initiale d’un appel Decisions doit être un entier positif.");
  let spent = 0;
  let inFlight = 0;
  let calls = 0;
  let withoutUsage = 0;
  let refused = 0;
  let largest = 0;
  const reserve = () => Math.max(largest, initialEstimate);
  return {
    maxTokens,
    tryStart() {
      if (spent + (inFlight + 1) * reserve() > maxTokens) {
        refused += 1;
        return false;
      }
      inFlight += 1;
      return true;
    },
    finish(usage) {
      if (inFlight < 1) throw new Error("Aucun appel Decisions en cours pour ce budget.");
      inFlight -= 1;
      calls += 1;
      if (!usage) {
        withoutUsage += 1;
        return;
      }
      spent += usage.total_tokens;
      largest = Math.max(largest, usage.total_tokens);
    },
    snapshot: () => ({
      max_tokens: maxTokens, spent_tokens: spent, calls, calls_without_usage: withoutUsage,
      refused_starts: refused, largest_call_tokens: largest,
    }),
  };
}

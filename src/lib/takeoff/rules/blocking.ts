import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// When a line's rule results block its application (TI-664 step 2), the one
// predicate the apply guard and the database trigger share:
// - results not recalculated since the line changed (« stale ») block;
// - a failed rule blocks while the line is not verified, and always when it is
//   not acceptable (a quantity to be entered: verifying never settles it).
// An excluded line never blocks; the caller filters it, as for every reason.

export function failedRules(results: readonly TakeoffRuleResult[] | null | undefined) {
  return (results ?? []).filter((entry) => entry.status === "fail");
}

/** The failed rules that still block this line (empty when none does). */
export function blockingRules(results: readonly TakeoffRuleResult[] | null | undefined, isVerified: boolean) {
  return failedRules(results).filter((entry) => !entry.acceptable || !isVerified);
}

export function isRuleBlocked(results: readonly TakeoffRuleResult[] | null | undefined, stale: boolean, isVerified: boolean) {
  return stale || blockingRules(results, isVerified).length > 0;
}

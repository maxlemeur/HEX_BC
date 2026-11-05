import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// When a line's rule results block its application (TI-664 step 2), the one
// predicate the apply guard and the database trigger share:
// - results not recalculated since the line changed (« stale ») block;
// - a failed rule blocks while the line is not verified, and always when it is
//   not acceptable (a quantity to be entered: verifying never settles it).
// An excluded line never blocks; the caller filters it, as for every reason.
// - A cross-line failure (a duplicate, an overlapping room) that names all its
//   partners no longer blocks once every one of them is left out (TI-677):
//   the rules would then pass the line. The mapping plan skips a partner, the
//   application excludes it before the trigger counts. Only a whole list (its
//   count stored beside it) of distinct line ids settles it; zones never
//   registered, a cut list or a partner whose state is unknown keep blocking.
//   takeoff_rule_failure_left_out is the same test in SQL; the TS test lives in
//   partner-exclusions.ts, passed by the callers that guard planned exclusions
//   (the server, the apply wizard, the targeted review), so that the review
//   page's bundle, which guards its included lines only, does not carry it.

export function failedRules(results: readonly TakeoffRuleResult[] | null | undefined) {
  return (results ?? []).filter((entry) => entry.status === "fail");
}

/** Whether a line is left out now (excluded, or excluded by the plan being applied); undefined when unknown. */
export type PartnerExclusion = (itemId: string) => boolean | undefined;

/** Whether a failed rule no longer holds because every partner it names is left out (partner-exclusions.ts). */
export type LeftOut = (result: TakeoffRuleResult) => boolean;

/** The failed rules that still block this line (empty when none does). */
export function blockingRules(results: readonly TakeoffRuleResult[] | null | undefined, isVerified: boolean, leftOut?: LeftOut) {
  return failedRules(results).filter((entry) => (!entry.acceptable || !isVerified) && !leftOut?.(entry));
}

export function isRuleBlocked(results: readonly TakeoffRuleResult[] | null | undefined, stale: boolean, isVerified: boolean,
  leftOut?: LeftOut) {
  return stale || blockingRules(results, isVerified, leftOut).length > 0;
}

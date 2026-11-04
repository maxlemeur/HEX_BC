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
//   takeoff_rule_failure_left_out is the same test in SQL.

export function failedRules(results: readonly TakeoffRuleResult[] | null | undefined) {
  return (results ?? []).filter((entry) => entry.status === "fail");
}

/** Whether a line is left out now (excluded, or excluded by the plan being applied); undefined when unknown. */
export type PartnerExclusion = (itemId: string) => boolean | undefined;

const LINE_ID = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

/** A line id as stored (a uuid, any case). */
export function isLineId(value: unknown): value is string {
  return typeof value === "string" && LINE_ID.test(value);
}

/** The partners a cross-line failure names, with their stored count; null for any other result. */
export function failurePartners(result: TakeoffRuleResult): { ids: unknown[]; count: unknown } | null {
  if (result.code === "ZONE_OVERLAP_DUPLICATE") {
    const partners = result.details?.partners;
    return Array.isArray(partners) ? { ids: partners.map((partner) => partner?.item_id), count: result.details?.partner_count } : null;
  }
  if (result.code === "ROOM_OVERLAP") {
    const rooms = result.details?.overlapping_item_ids;
    return Array.isArray(rooms) ? { ids: rooms, count: result.details?.overlap_count } : null;
  }
  return null;
}

/** A cross-line failure whose partners, all named, are all left out: the rules would pass the line. */
export function leftOutByPartners(result: TakeoffRuleResult, excluded: PartnerExclusion | undefined) {
  const named = excluded ? failurePartners(result) : null;
  if (!named || !excluded) return false;
  const { ids, count } = named;
  if (ids.length === 0 || typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 999_999 || count !== ids.length) return false;
  if (!ids.every((id): id is string => typeof id === "string" && LINE_ID.test(id))) return false;
  // An id whatever its case is one line (the database reads it as a uuid): never two partners.
  const lines = ids.map((id) => id.toLowerCase());
  if (new Set(lines).size !== lines.length) return false;
  return lines.every((id) => excluded(id) === true);
}

/** The failed rules that still block this line (empty when none does). */
export function blockingRules(results: readonly TakeoffRuleResult[] | null | undefined, isVerified: boolean, excluded?: PartnerExclusion) {
  return failedRules(results).filter((entry) => (!entry.acceptable || !isVerified) && !leftOutByPartners(entry, excluded));
}

export function isRuleBlocked(results: readonly TakeoffRuleResult[] | null | undefined, stale: boolean, isVerified: boolean,
  excluded?: PartnerExclusion) {
  return stale || blockingRules(results, isVerified, excluded).length > 0;
}

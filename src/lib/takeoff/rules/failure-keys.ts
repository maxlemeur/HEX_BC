// The failed rules of a line as keys (TI-677 PR D, memo Q2 and Q3 validated on 5 Nov. 2026): one key per failed
// rule, code, version and partner, « rule|code|version|partner » (no partner: « rule|code|version| »). SQL reads the
// same keys (takeoff_rule_failure_keys, migration 20261105020000) from the stored JSON:
// - the rule writer withdraws a line's verification when a computation brings it a key it did not have (another
//   rule, code or version, or a new partner): a failure nobody saw never passes for settled. A failure, or a partner,
//   that disappears closes by itself;
// - an admin override records the keys of each line it lifts, and the apply trigger compares them.
// Read as written, never through the results' schema (whose limits a stored value may not meet): a rule or code that
// is not a name, a version that is not an integer of 0 to 2^31 - 1, a partner that is not an identifier, reads « ? ».
// Identifiers are lowered (ASCII only, as SQL translate), keys deduplicated and sorted by byte (SQL collate "C").

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const IDENTIFIER = /^[0-9A-Za-z-]{1,64}$/;
const VERSION_MAX = 2147483647;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function name(value: unknown) {
  return typeof value === "string" && NAME.test(value) ? value : "?";
}

function version(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= VERSION_MAX ? String(value) : "?";
}

function identifier(value: unknown) {
  return typeof value === "string" && IDENTIFIER.test(value) ? value.toLowerCase() : "?";
}

function partners(details: unknown): string[] {
  if (!isObject(details)) return [];
  const named = Array.isArray(details.partners)
    ? details.partners.map((partner) => identifier(isObject(partner) ? partner.item_id : undefined))
    : [];
  const rooms = Array.isArray(details.overlapping_item_ids) ? details.overlapping_item_ids.map(identifier) : [];
  return [...named, ...rooms];
}

/** The keys of the failed rules in stored results (any JSON), sorted and without duplicates. */
export function ruleFailureKeys(results: unknown): string[] {
  if (!Array.isArray(results)) return [];
  const keys = new Set<string>();
  for (const entry of results) {
    if (!isObject(entry) || entry.status !== "fail") continue;
    const prefix = `${name(entry.rule)}|${name(entry.code)}|${version(entry.version)}|`;
    const ids = partners(entry.details);
    for (const id of ids.length > 0 ? ids : [""]) keys.add(`${prefix}${id}`);
  }
  return [...keys].sort();
}

/** Whether results written over stored ones bring a failure key the stored ones did not have (SQL takeoff_rule_failures_reopen). */
export function ruleFailuresReopen(previous: unknown, next: unknown): boolean {
  const known = new Set(ruleFailureKeys(previous));
  return ruleFailureKeys(next).some((key) => !known.has(key));
}

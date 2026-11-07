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

function failureDigest(results: unknown): string | undefined {
  if (!Array.isArray(results)) return undefined;
  for (const entry of results) {
    if (!isObject(entry) || entry.status !== "fail" || !isObject(entry.details)) continue;
    const digest = entry.details.failure_keys_sha256;
    if (typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) return digest;
  }
}

/** An override identifies the full set even when a line can display only some partners. */
export function ruleOverrideFailureKeys(results: unknown): string[] {
  const digest = failureDigest(results);
  return digest ? [`sha256:${digest}`] : ruleFailureKeys(results);
}

function mayHidePartners(entry: unknown): boolean {
  if (!isObject(entry) || entry.status !== "fail" || !isObject(entry.details)) return false;
  const details = entry.details;
  if ("failure_keys_sha256" in details) return true;
  if (entry.code !== "ZONE_OVERLAP_DUPLICATE" && entry.code !== "ROOM_OVERLAP") return false;
  const zone = entry.code === "ZONE_OVERLAP_DUPLICATE";
  const count = zone ? details.partner_count : details.overlap_count;
  const ids = zone ? details.partners : details.overlapping_item_ids;
  const shown = Array.isArray(ids) ? ids.length : 0;
  if (count !== undefined) return count !== shown;
  // Older results carried no count. At one of the bounding steps the list may be incomplete.
  return (zone ? [0, 5, 20, 50] : [0, 20, 100, 500]).includes(shown);
}

/** Whether a pending verification must be reconsidered before replaying it over a new server revision.
 * SQL compares the exact sets when deciding whether to withdraw an already stored verification. The browser
 * sees only the displayed identities and their digest: it replays only when inclusion can be proved. */
export function ruleFailuresReopen(previous: unknown, next: unknown): boolean {
  const digest = failureDigest(next);
  if (digest && digest === failureDigest(previous)) return false;
  if (Array.isArray(next) && next.some(mayHidePartners)) return true;
  const known = new Set(ruleFailureKeys(previous));
  return ruleFailureKeys(next).some((key) => !known.has(key));
}

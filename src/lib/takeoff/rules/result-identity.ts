import { createHash } from "node:crypto";

import { boundRuleResults } from "@/lib/takeoff/rules/contracts";
import { ruleFailureKeys } from "@/lib/takeoff/rules/failure-keys";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

type ResultWrite = { results: TakeoffRuleResult[]; complete_failure_keys?: string[] };

/** Full identities travel to the writer only when bounding removes a failed rule's partners. */
export function prepareRuleResultWrite(full: readonly TakeoffRuleResult[]): ResultWrite {
  const results = boundRuleResults(full);
  const truncated = full.findIndex((entry, i) => entry.status === "fail" && (
    (entry.details?.partners?.length ?? 0) > (results[i].details?.partners?.length ?? 0) ||
    (entry.details?.overlapping_item_ids?.length ?? 0) > (results[i].details?.overlapping_item_ids?.length ?? 0)
  ));
  if (truncated < 0) return { results };

  const keys = ruleFailureKeys(full);
  // ASCII keys cannot contain a newline. SQL hashes the same sorted sequence.
  const digest = createHash("sha256").update(keys.join("\n"), "utf8").digest("hex");
  const marked = full.map((entry, i) => i === truncated ?
    { ...entry, details: { ...entry.details, failure_keys_sha256: digest } } : entry);
  return { results: boundRuleResults(marked), complete_failure_keys: keys };
}

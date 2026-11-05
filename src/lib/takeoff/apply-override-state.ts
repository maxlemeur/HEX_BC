import { ruleFailureKeys } from "@/lib/takeoff/rules/failure-keys";

/**
 * What an admin override records of each line it lifts (TI-677 PR D, memo Q2): the apply trigger refuses the override
 * once one of them changed (takeoff_apply_override_state_holds) — its quantity, its unit, any save of it (updated_at and
 * designation, except the application's own renaming), the keys of its failed rules, their freshness, its evidence,
 * page, verification or entry. Read from the stored row as the trigger reads it: the results' keys from the stored
 * JSON, the stored stale flag (not the guard's fail-closed reading of unreadable results).
 */
export type TakeoffApplyOverrideItemState = {
  item_id: string;
  quantity: number;
  unit: string;
  updated_at: string;
  rule_failures: string[];
  rules_stale: boolean;
  /** What proves the line: a change of any of them after the override needs a new one, even unjournaled. */
  designation: string;
  evidence: string | null;
  source_page: number | null;
  is_verified: boolean;
  quantity_entered_by: string | null;
};

export function takeoffApplyOverrideItemState(row: {
  id: string;
  quantity: unknown;
  unit: unknown;
  updated_at: unknown;
  rule_results: unknown;
  rules_stale: unknown;
  designation: unknown;
  evidence?: unknown;
  source_page?: unknown;
  is_verified: unknown;
  quantity_entered_by?: unknown;
}): TakeoffApplyOverrideItemState {
  return {
    item_id: row.id,
    quantity: Number(row.quantity),
    unit: String(row.unit),
    updated_at: String(row.updated_at),
    rule_failures: ruleFailureKeys(row.rule_results),
    rules_stale: row.rules_stale === true,
    designation: String(row.designation),
    evidence: typeof row.evidence === "string" ? row.evidence : null,
    source_page: typeof row.source_page === "number" ? row.source_page : null,
    is_verified: row.is_verified === true,
    quantity_entered_by: typeof row.quantity_entered_by === "string" ? row.quantity_entered_by : null,
  };
}

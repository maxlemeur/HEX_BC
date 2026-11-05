import { ruleFailureKeys } from "@/lib/takeoff/rules/failure-keys";

/**
 * What an admin override records of each line it lifts (TI-677 PR D, memo Q2): the apply trigger refuses the override
 * once one of them changed (takeoff_apply_override_state_holds) — its quantity, its unit, any save of it (updated_at,
 * except the application's own renaming), the keys of its failed rules, or their freshness. Read from the stored row
 * as the trigger reads it: the results' keys from the stored JSON, the stored stale flag (not the guard's fail-closed
 * reading of unreadable results).
 */
export type TakeoffApplyOverrideItemState = {
  item_id: string;
  quantity: number;
  unit: string;
  updated_at: string;
  rule_failures: string[];
  rules_stale: boolean;
};

export function takeoffApplyOverrideItemState(row: {
  id: string;
  quantity: unknown;
  unit: unknown;
  updated_at: unknown;
  rule_results: unknown;
  rules_stale: unknown;
}): TakeoffApplyOverrideItemState {
  return {
    item_id: row.id,
    quantity: Number(row.quantity),
    unit: String(row.unit),
    updated_at: String(row.updated_at),
    rule_failures: ruleFailureKeys(row.rule_results),
    rules_stale: row.rules_stale === true,
  };
}

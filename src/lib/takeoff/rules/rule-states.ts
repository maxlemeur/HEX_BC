import type { TakeoffItemRuleState, TakeoffJobItem } from "@/lib/takeoff/types";

type RuleLine = Pick<TakeoffJobItem, "id" | "rule_results" | "rules_evaluated_at" | "rules_stale">;

/**
 * The lines with the rule state a PATCH read after its computation (TI-664 L5c): a saved line's partners (a run on
 * two zone plans, two rooms of one page) show what the server now holds, settled or failed, and a failed computation
 * leaves them « à recalculer ». A line `keep` names (one the user is still editing or saving) keeps its own: its save
 * reads it again. Lines the answer does not name are left as they are.
 */
export function withRuleStates<T extends RuleLine>(items: readonly T[], states: readonly TakeoffItemRuleState[] | undefined,
  keep: (item: T) => boolean = () => false): T[] {
  if (!states || states.length === 0) return [...items];
  const byId = new Map(states.map((state) => [state.item_id, state]));
  return items.map((item) => {
    const state = byId.get(item.id);
    if (!state || keep(item)) return item;
    return { ...item, rule_results: state.rule_results, rules_evaluated_at: state.rules_evaluated_at, rules_stale: state.rules_stale };
  });
}

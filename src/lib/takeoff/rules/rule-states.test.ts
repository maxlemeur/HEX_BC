import { describe, expect, it } from "vitest";

import { withRuleStates } from "@/lib/takeoff/rules/rule-states";
import type { TakeoffItemRuleState, TakeoffJobItem } from "@/lib/takeoff/types";

// TI-677 (PR D): the server may reopen a partner line (its verification withdrawn) or move its save when its failures
// grow. The review takes the line's state as the server read it, with its updated_at, for every line it is not editing:
// a reopened line no longer shows « déjà acceptée », and the review saves it from what it shows.
const line = (id: string, overrides: Partial<TakeoffJobItem> = {}) => ({
  id, designation: "EF cuivre 20/22", quantity: 4, unit: "ml", source_page: 2, is_excluded: false, exclusion_reason: null,
  is_verified: true, verified_at: "2026-11-05T01:00:00.000Z", verified_by: "11111111-1111-4111-8111-111111111111",
  evidence: "Repère localisé", updated_at: "2026-11-05T01:00:00.000Z", rule_results: [], rules_evaluated_at: null,
  rules_stale: false, ...overrides,
});

const reopened: TakeoffItemRuleState = {
  item_id: "22222222-2222-4222-8222-222222222222",
  rule_results: [{ rule: "room_overlap", status: "fail", code: "ROOM_OVERLAP", version: 1, acceptable: true, reason: "Fictif." }],
  rules_evaluated_at: "2026-11-05T02:00:00.000Z", rules_stale: false, designation: "EF cuivre 20/22", quantity: 4, unit: "ml",
  source_page: 2, is_excluded: false, exclusion_reason: null, is_verified: false, verified_at: null, verified_by: null,
  evidence: "Repère localisé", updated_at: "2026-11-05T02:00:00.000Z", quantity_entered_at: null, quantity_entered_by: null,
};

describe("rule states read after a save", () => {
  it("take the line's state and save as the server read them", () => {
    const [partner] = withRuleStates([line(reopened.item_id)], [reopened]);
    expect(partner).toMatchObject({ is_verified: false, verified_at: null, verified_by: null,
      updated_at: "2026-11-05T02:00:00.000Z", rule_results: reopened.rule_results });
    expect(partner).not.toHaveProperty("item_id");
  });

  it("leave a line the user is editing as it is", () => {
    const editing = line(reopened.item_id, { quantity: 3 });
    expect(withRuleStates([editing], [reopened], () => true)).toEqual([editing]);
  });

  it("take only the rule fields an older answer carries", () => {
    const { item_id, rule_results, rules_evaluated_at, rules_stale } = reopened;
    const [partner] = withRuleStates([line(item_id)], [{ item_id, rule_results, rules_evaluated_at, rules_stale }]);
    expect(partner).toMatchObject({ is_verified: true, updated_at: "2026-11-05T01:00:00.000Z", rule_results });
  });
});

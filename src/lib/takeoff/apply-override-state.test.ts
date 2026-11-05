import { describe, expect, it } from "vitest";

import { takeoffApplyOverrideItemState } from "@/lib/takeoff/apply-override-state";

// TI-677 (PR D): an admin override records the state of each line it lifts, as the apply trigger reads it
// (takeoff_apply_override_state_holds): a line that changes after the override (its quantity, its unit, any save, its
// failed rules or their freshness) needs a new override.
describe("the state an override records for a blocked line", () => {
  const row = {
    id: "66666666-6666-4666-8666-666666666666",
    quantity: 12.5,
    unit: "ml",
    updated_at: "2026-11-05T01:38:31.124567+00:00",
    rules_stale: false,
    designation: "EF cuivre 20/22",
    evidence: "Repère localisé",
    source_page: 2,
    is_verified: false,
    quantity_entered_by: null,
    rule_results: [{ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 1, acceptable: true,
      reason: "Fictif.", details: { partners: [{ item_id: "0B000000-0000-4000-8000-00000000000B" }] } }],
  };

  // The review found that a change no decision journals (another transaction's) slipped past an override when the
  // application renamed the line: every field that can change the decision is recorded and compared.
  it("records the quantity, the unit, the save, the keys of the failed rules and what proves the line", () => {
    expect(takeoffApplyOverrideItemState(row)).toEqual({
      item_id: row.id,
      quantity: 12.5,
      unit: "ml",
      updated_at: row.updated_at,
      rule_failures: ["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|0b000000-0000-4000-8000-00000000000b"],
      rules_stale: false,
      designation: "EF cuivre 20/22",
      evidence: "Repère localisé",
      source_page: 2,
      is_verified: false,
      quantity_entered_by: null,
    });
  });

  it("reads the stored results and flag as the trigger does, not as the guard's schema does", () => {
    const state = takeoffApplyOverrideItemState({
      ...row, quantity: "3.000", rules_stale: null, evidence: undefined, source_page: undefined, quantity_entered_by: undefined,
      rule_results: [{ rule: "dn_network", status: "fail", code: "DN_NETWORK_DN_MISSING", version: 1.5 }],
    });
    expect(state).toMatchObject({ quantity: 3, rule_failures: ["dn_network|DN_NETWORK_DN_MISSING|?|"], rules_stale: false,
      evidence: null, source_page: null, quantity_entered_by: null });
  });
});

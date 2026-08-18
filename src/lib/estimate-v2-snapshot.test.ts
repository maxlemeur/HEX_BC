import { describe, expect, it } from "vitest";

import { buildStoredEstimateBreakdown } from "@/lib/estimate-v2-snapshot";
import type { EstimateItemRecord } from "@/lib/estimate-calculations";

describe("stored estimate v2 rounding", () => {
  it("keeps accounting tax separate from commercial rounding", () => {
    const items = [
      {
        id: "line-1",
        item_type: "line",
        parent_id: null,
        quantity: 1,
        line_total_ht_cents: 10_000,
        line_tax_cents: 2_050,
        line_total_ttc_cents: 12_050,
        snapshot_pu_ht_cents: 10_000,
        snapshot_fo_ht_cents: 10_000,
        snapshot_mo_ht_cents: 0,
        snapshot_mo_atelier_ht_cents: 0,
        snapshot_mo_chantier_ht_cents: 0,
      } as EstimateItemRecord,
    ];

    const breakdown = buildStoredEstimateBreakdown({
      items,
      version: {
        margin_multiplier: 1,
        discount_mode: "simple",
        global_coefficient: 1,
        total_ht_cents: 10_000,
        total_tax_cents: 2_050,
        total_ttc_cents: 12_050,
        rounding_adjustment_cents: 50,
      },
    });

    expect(breakdown.totals.taxCents).toBe(2_000);
    expect(breakdown.totals.ttcCents).toBe(12_000);
    expect(breakdown.totals.roundingAdjustmentCents).toBe(50);
    expect(breakdown.totals.roundedTtcCents).toBe(12_050);
    expect(breakdown.lineById.get("line-1")?.taxCents).toBe(2_000);
    expect(breakdown.invariants.matchesFooter).toBe(true);
  });
});

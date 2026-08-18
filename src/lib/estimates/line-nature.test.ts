import { describe, expect, it } from "vitest";

import { resolveEstimateLineNature } from "@/lib/estimates/line-nature";

describe("resolveEstimateLineNature", () => {
  it("keeps an explicit nature", () => {
    expect(
      resolveEstimateLineNature({
        line_nature: "supply_and_labor",
        unit_price_ht_cents: 0,
        h_mo: 0,
      }),
    ).toBe("supply_and_labor");
  });

  it("derives supply-only for a legacy priced line without labor", () => {
    expect(
      resolveEstimateLineNature({ unit_price_ht_cents: 1200, h_mo: 0 }),
    ).toBe("supply_only");
  });

  it("derives labor-only when a legacy line has labor and no supply", () => {
    expect(
      resolveEstimateLineNature({ unit_price_ht_cents: 0, h_mo: 2 }),
    ).toBe("labor_only");
  });
});

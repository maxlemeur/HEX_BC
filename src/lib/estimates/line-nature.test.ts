import { describe, expect, it } from "vitest";

import {
  resolveEstimateLineNature,
  resolvePromotedEstimateLineNature,
} from "@/lib/estimates/line-nature";

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

describe("resolvePromotedEstimateLineNature", () => {
  it("promotes a supply-only line when labor is entered", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_only",
          unit_price_ht_cents: 1200,
          h_mo: 0,
        },
        { h_mo: 0.5 },
      ),
    ).toBe("supply_and_labor");
  });

  it("promotes a labor-only line when supply is entered", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "labor_only",
          unit_price_ht_cents: 0,
          h_mo: 2,
        },
        { unit_price_ht_cents: 1200 },
      ),
    ).toBe("supply_and_labor");
  });

  it("never demotes a mixed line when a component is cleared", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_and_labor",
          unit_price_ht_cents: 1200,
          h_mo: 2,
        },
        { h_mo: 0, labor_role_id: null },
      ),
    ).toBe("supply_and_labor");
  });

  it("keeps an explicit manual nature even when values disagree", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_and_labor",
          unit_price_ht_cents: 1200,
          h_mo: 2,
        },
        { line_nature: "supply_only" },
      ),
    ).toBe("supply_only");
  });

  it("does not promote an inconsistent legacy line on an unrelated edit", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_only",
          unit_price_ht_cents: 1200,
          h_mo: 2,
        },
        {},
      ),
    ).toBe("supply_only");
  });
});

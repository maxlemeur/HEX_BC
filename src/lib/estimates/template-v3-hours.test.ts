import { describe, expect, it } from "vitest";

import { hoursPerUnitHalfUp, listTemplateLinesConvertedForV3 } from "@/lib/estimates/template-v3-hours";

const line = (title: string, quantity: number | null, hours: number | null, perUnit?: number | null) => ({
  item_type: "line",
  title,
  quantity,
  h_mo: hours,
  h_mo_per_unit: perUnit,
});

describe("2.8 template lines converted for a v3 (P-12)", () => {
  it("lists only the lines whose hours change through h / Q at 4 decimals", () => {
    expect(listTemplateLinesConvertedForV3([
      line("tube", 10, 5),
      line("collier", 3000, 1),
      line("dalle", 2, 0),
      { item_type: "section", title: "lot", quantity: null, h_mo: null },
    ])).toEqual([{ title: "collier", template_hours: 1, converted_hours: 0.9 }]);
  });

  it("rounds h / Q half up, like round(numeric) in M6", () => {
    // 1 / 6 = 0,16666… → 0,1667 h/u, 6 × 0,1667 = 1,0002 → 1 h: unchanged.
    // 0,00005 h/u exactly (1 h for 20 000 u) rounds up to 0,0001: 2 h.
    expect(listTemplateLinesConvertedForV3([
      line("six", 6, 1),
      line("demi", 20000, 1),
    ])).toEqual([{ title: "demi", template_hours: 1, converted_hours: 2 }]);
  });

  it("keeps the hours per unit of a template saved from a v3 and skips a line without quantity", () => {
    expect(listTemplateLinesConvertedForV3([
      line("v3", 3000, 0.9, 0.0003),
      line("sans quantité", 0, 0),
      line("quantité absente", null, 2),
    ])).toEqual([]);
  });
});

describe("2.8 hours per unit from line hours (generated ouvrages, M6)", () => {
  it("rounds h / Q half up to 4 decimals and refuses hours without quantity", () => {
    expect([hoursPerUnitHalfUp(54, 120), hoursPerUnitHalfUp(1, 20000), hoursPerUnitHalfUp(1, 3), hoursPerUnitHalfUp(0, 0),
      hoursPerUnitHalfUp(2, 0)]).toEqual([0.45, 0.0001, 0.3333, 0, null]);
  });
});

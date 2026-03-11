import { describe, expect, it } from "vitest";

import { getSpreadsheetColumnKeys } from "@/components/estimates/components/EstimateEditorRow";

describe("getSpreadsheetColumnKeys", () => {
  it("returns only the title column for sections", () => {
    expect(getSpreadsheetColumnKeys("section", false)).toEqual(["title"]);
  });

  it("returns the standard line columns when labor split is disabled", () => {
    expect(getSpreadsheetColumnKeys("line", false)).toEqual([
      "title",
      "quantity",
      "unit",
      "unit_price",
      "supply_type",
      "k_fo",
      "h_mo",
      "h_mo_majoration",
      "labor_role",
      "k_mo",
      "pu_ht",
      "line_total_ht",
    ]);
  });

  it("returns the labor split line columns when labor split is enabled", () => {
    expect(getSpreadsheetColumnKeys("line", true)).toEqual([
      "title",
      "quantity",
      "unit",
      "unit_price",
      "supply_type",
      "k_fo",
      "h_mo_majoration",
      "h_mo_atelier",
      "labor_role_atelier",
      "k_mo_atelier",
      "h_mo_chantier",
      "labor_role_chantier",
      "k_mo_chantier",
      "pu_ht",
      "line_total_ht",
    ]);
  });
});

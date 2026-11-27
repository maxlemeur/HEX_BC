import { describe, expect, it } from "vitest";

import { compileWorkbookColumnFilter, inspectWorkbookColumnFilter, workbookFilterValue } from "./workbook-preview-filter";

describe("workbook preview filters", () => {
  it("offers exact scores and distinguishes zero from ten and empty cells", () => {
    const values = [0, 10, "0", null, " "];
    const profile = inspectWorkbookColumnFilter(values, "Fiabilité (/10)");
    expect(profile.suggestedMode).toBe("values");
    expect(profile.options.map(({ label }) => label)).toEqual(["0", "10", "Cellules vides"]);
    expect(values.filter(compileWorkbookColumnFilter({ mode: "values", value: workbookFilterValue(0) })!)).toEqual([0, "0"]);
    expect(values.filter(compileWorkbookColumnFilter({ mode: "values", value: workbookFilterValue(null) })!)).toEqual([null, " "]);
  });

  it("lets users switch dimensions between exact and partial matching", () => {
    const values = ["DN15", "DN150", "DN15/20"];
    expect(inspectWorkbookColumnFilter(values, "Dimension").suggestedMode).toBe("values");
    expect(values.filter(compileWorkbookColumnFilter({ mode: "values", value: workbookFilterValue("DN15") })!)).toEqual(["DN15"]);
    expect(values.filter(compileWorkbookColumnFilter({ mode: "exact", value: "DN15" })!)).toEqual(["DN15"]);
    expect(values.filter(compileWorkbookColumnFilter({ mode: "contains", value: "dn15" })!)).toEqual(values);
  });

  it("proposes numeric modes for a column of many numeric cells and handles French decimals", () => {
    const values = Array.from({ length: 45 }, (_, index) => index / 2);
    expect(inspectWorkbookColumnFilter(values)).toMatchObject({ suggestedMode: "number", numeric: true });
    const pick = compileWorkbookColumnFilter({ mode: "range", min: "10,5", max: "11" })!;
    expect(values.filter(pick)).toEqual([10.5, 11]);
    expect(pick(null)).toBe(false);
    expect(compileWorkbookColumnFilter({ mode: "range", min: "4", max: "2" })).toBeNull();
    expect(compileWorkbookColumnFilter({ mode: "number", value: " " })).toBeNull();
  });

  it("keeps digit-only strings as codes when the column is unknown", () => {
    expect(inspectWorkbookColumnFilter(["0012", "12", "0013"])).toMatchObject({ suggestedMode: "values", numeric: false });
    expect(inspectWorkbookColumnFilter(Array.from({ length: 60 }, (_, index) => String(index)))).toMatchObject({
      suggestedMode: "contains", numeric: false,
    });
    const pick = compileWorkbookColumnFilter({ mode: "values", value: workbookFilterValue("0012") })!;
    expect(pick("0012")).toBe(true);
    expect(pick(12)).toBe(false);
  });
});

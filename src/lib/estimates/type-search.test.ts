import { describe, expect, it } from "vitest";
import { resolveUniqueEstimateType, searchEstimateTypes } from "./type-search";

const options = [
  { id: "1", code: "cat_42", label: "Tube acier" },
  { id: "2", code: "TUB", label: "Fourniture tube" },
  { id: "3", code: "tube", label: "Tube" },
  { id: "4", label: "Électricien" },
  { id: "5", label: "Plombier" },
  { id: "6", label: "Plaquiste" },
];

describe("estimate type search", () => {
  it("ignores accents and case without inventing MO codes", () => {
    expect(resolveUniqueEstimateType(options, "ELEC")?.id).toBe("4");
    expect(searchEstimateTypes(options, "MAC")).toEqual([]);
  });
  it("does not resolve empty, ambiguous, unknown or disabled options", () => {
    for (const query of ["", "pl", "inconnu"]) expect(resolveUniqueEstimateType(options, query)).toBeUndefined();
    expect(resolveUniqueEstimateType([{ ...options[3], disabled: true }], "elec")).toBeUndefined();
    expect(resolveUniqueEstimateType([
      { id: "1", code: "é", label: "Premier" },
      { id: "2", code: "E", label: "Second" },
    ], "e")).toBeUndefined();
  });
  it("accepts an exact unique code among prefix matches, but no arbitrary first result", () => {
    expect(resolveUniqueEstimateType(options, "tub")?.id).toBe("2");
    expect(resolveUniqueEstimateType(options, "tu")).toBeUndefined();
  });
});

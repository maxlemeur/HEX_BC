import { describe, expect, it } from "vitest";

import { dedupeLabels } from "@/lib/text/dedupe-labels";
import { levenshteinDistance, normalizeCompareText } from "@/lib/text/fuzzy-compare";

describe("normalizeCompareText", () => {
  it("removes accents, case and punctuation, and collapses spaces", () => {
    expect(normalizeCompareText("  Béton armé — C25/30 (dalle)  ")).toBe("beton arme c25 30 dalle");
    expect(normalizeCompareText("Ø 32 mm")).toBe("32 mm");
    expect(normalizeCompareText("!!!")).toBe("");
  });
});

describe("levenshteinDistance", () => {
  it.each([
    ["", "", 0],
    ["", "abc", 3],
    ["abc", "", 3],
    ["chape", "chape", 0],
    ["kitten", "sitting", 3],
    ["dalle", "dale", 1],
    ["ab", "ba", 2],
  ])("distance(%j, %j) = %i", (left, right, expected) => {
    expect(levenshteinDistance(left, right)).toBe(expected);
    expect(levenshteinDistance(right, left)).toBe(expected);
  });
});

describe("dedupeLabels", () => {
  it("trims, drops blanks and keeps the first spelling of case variants in order", () => {
    expect(dedupeLabels([" Lot 02 ", "", "lot 02", "   ", "Électricité", "ÉLECTRICITÉ", "Lot 01"])).toEqual([
      "Lot 02",
      "Électricité",
      "Lot 01",
    ]);
  });
});

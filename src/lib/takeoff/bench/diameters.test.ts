import { describe, expect, it } from "vitest";

import {
  dnKeysOf,
  findDiameterEntries,
  knownDnKeys,
} from "@/lib/takeoff/bench/diameters";

// Ways the diameter correspondence could mislead the bench, written before the
// table: a French decimal comma read as two numbers ("22x1,2" -> 22x1 and 2);
// an ID/OD pair ("20/22", "20/27") or an inch size (3/4") not recognised; an
// outer diameter written without its decimal ("76x2" for 76.1) missed; one
// candidate silently chosen when a material has two series with different
// outer diameters for the same DN; a DN accepted for a material that has no
// such size (a typo in the truth passes).
// Then, from the real plans: a plan rounds an outer diameter to the millimetre
// ("DN 76" on press stainless 76.1x2, "DN 89" for 88.9) and the plan reading
// never reaches its truth key; that rounding leaks into a series printed by
// nominal DN (steel "DN 76" taken for the 76.1 tube, whose plans say DN 65);
// the rounded label accepted as a truth key, so one pipe gets two keys
// ("DN 76" and "DN 76.1"); a multilayer pair whose second number is no wall
// ("20x25", "15x20") read as outer diameter x wall, or falling back to "Ø 20",
// so an unmapped notation gets a size instead of going to the reviewer.

function keys(text: string, material: Parameters<typeof findDiameterEntries>[1]) {
  return [...new Set(findDiameterEntries(text, material).flatMap(dnKeysOf))].sort();
}

function outerDiameters(text: string, material: Parameters<typeof findDiameterEntries>[1]) {
  return [...new Set(findDiameterEntries(text, material).map((entry) => entry.od_mm))].sort((a, b) => a - b);
}

describe("diameter correspondence table", () => {
  it.each([
    ["22x1,2", "inox-316l", [22]],
    ["Tube 22 x 1,2 mm", "inox", [22]],
    ["20/22", "cuivre", [22]],
    ["Ø 76,1", "inox", [76.1]],
    ["76x2", "inox", [76.1]],
    ["26,9x2,6", "acier", [26.9]],
    ["20/27", "acier", [26.9]],
    ["3/4\"", "acier", [26.9]],
    ["1\"1/4", "acier-galvanise", [42.4]],
    ["DN 100", "fonte", [110]],
    ["PVC Ø100", "pvc", [100]],
  ] as const)("reads %s for %s", (text, material, expected) => {
    expect(outerDiameters(text, material)).toEqual(expected);
  });

  it("maps a press stainless size to the DN printed on plans and to its nominal DN", () => {
    expect(keys("22x1,2", "inox-316l")).toEqual(["DN 20", "DN 22"]);
    expect(keys("26,9x2,6", "acier")).toEqual(["DN 20"]);
  });

  it("returns every candidate when one DN covers two outer diameters", () => {
    expect(outerDiameters("DN 100", "inox")).toEqual([108, 114.3]);
  });

  it("finds nothing for a size the material does not have", () => {
    expect(findDiameterEntries("DN 22", "acier")).toEqual([]);
    expect(findDiameterEntries("Cuivre sans diametre", "cuivre")).toEqual([]);
  });

  it.each([
    ["DN 76", "inox-316l", [76.1]],
    ["Inox 316L DN 76", "inox", [76.1]],
    ["EG-A DN89", "inox-316l", [88.9]],
    ["DN 140", "inox-304l", [139.7]],
    ["Ø 140", "inox-304l", [139.7]],
    ["DN 76", "cuivre", [76.1]],
  ] as const)("resolves the rounded plan label %s for %s to its outer diameter", (text, material, expected) => {
    expect(outerDiameters(text, material)).toEqual(expected);
  });

  it("resolves the rounded plan label to the outer-diameter truth key, never a key of its own", () => {
    expect(keys("DN 76", "inox-316l")).toEqual(["DN 65", "DN 76.1"]);
    expect(knownDnKeys("inox-316l").has("DN 76.1")).toBe(true);
    expect(knownDnKeys("inox-316l").has("DN 76")).toBe(false);
  });

  it("keeps the rounding to series printed by their outer diameter", () => {
    expect(findDiameterEntries("DN 76", "acier")).toEqual([]);
    expect(outerDiameters("DN 65", "acier")).toEqual([76.1]);
    expect(outerDiameters("DN 100", "inox")).toEqual([108, 114.3]);
  });

  it.each([
    ["20x25", "multicouche"],
    ["Multicouche 15x20", "multicouche"],
    ["Ø 20x25", "multicouche"],
    ["16 x 20", "per"],
  ] as const)("leaves the unmapped pair %s for %s without a size (ambiguous, diameter_notation)", (text, material) => {
    expect(findDiameterEntries(text, material)).toEqual([]);
  });

  it("still reads a multilayer outer diameter x wall", () => {
    expect(outerDiameters("Multicouche 20x2", "multicouche")).toEqual([20]);
    expect(outerDiameters("26 x 3", "multicouche")).toEqual([26]);
  });

  it("knows DN keys by material", () => {
    expect(knownDnKeys("cuivre").has("DN 22")).toBe(true);
    expect(knownDnKeys("cuivre").has("DN 26")).toBe(false);
    expect(knownDnKeys(null).has("DN 26")).toBe(true);
    expect(knownDnKeys(null).has("DN 23")).toBe(false);
  });
});

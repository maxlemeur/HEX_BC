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

  it("knows DN keys by material", () => {
    expect(knownDnKeys("cuivre").has("DN 22")).toBe(true);
    expect(knownDnKeys("cuivre").has("DN 26")).toBe(false);
    expect(knownDnKeys(null).has("DN 26")).toBe(true);
    expect(knownDnKeys(null).has("DN 23")).toBe(false);
  });
});

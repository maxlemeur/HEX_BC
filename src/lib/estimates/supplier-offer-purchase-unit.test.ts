import { describe, expect, it } from "vitest";

import {
  hasPurchaseUnitConversion,
  offerEstimateUnit,
  offerEstimateUnitPriceCents,
  purchaseQuantity,
  purchaseUnitPriceCents,
} from "@/lib/estimates/supplier-offer-purchase-unit";

// T-UNIT3 (sub-lot 2.9). Isolation exception: the conversion arithmetic (division and half-up
// rounding to the cent, whole-unit rounding, unrepresentable quantities, negotiated prices) has a
// SQL twin in migration M7 that must give the same numbers; its edge cases cost little here and a
// full journey each in E2E. Journeys: docs/testing/estimate-engine-v3-2.9.md (PU01 to PU03).
const castIronBar = { unit: "barre", estimate_unit_code: "ml", estimate_units_per_purchase_unit: "3.000000", purchase_rounding: "ceil" };
const exactBar = { ...castIronBar, purchase_rounding: "none" };
const plain = { unit: "ml" };

describe("purchase unit conversion (T-UNIT3)", () => {
  it("prices a bar of 3 m at 262,45 € as 87,48 € per linear metre, half-up to the cent", () => {
    expect(hasPurchaseUnitConversion(castIronBar)).toBe(true);
    expect(offerEstimateUnit(castIronBar)).toBe("ml");
    expect(offerEstimateUnitPriceCents(castIronBar, 26245)).toBe(8748);
    expect(offerEstimateUnitPriceCents({ ...castIronBar, estimate_units_per_purchase_unit: "2" }, 1)).toBe(1);
    expect(offerEstimateUnitPriceCents({ ...castIronBar, estimate_units_per_purchase_unit: "2" }, 3)).toBe(2);
  });
  it("orders whole bars when rounding up: 282 ml → 94 bars, 10 ml → 4 bars", () => {
    expect(purchaseQuantity(castIronBar, 282)).toBe(94);
    expect(purchaseQuantity(castIronBar, 10)).toBe(4);
    expect(purchaseQuantity(castIronBar, 0.001)).toBe(1);
  });
  it("orders an exact quantity without rounding, and refuses one that is not a multiple of 0.001", () => {
    expect(purchaseQuantity(exactBar, 282)).toBe(94);
    expect(purchaseQuantity(exactBar, 4.5)).toBe(1.5);
    expect(purchaseQuantity(exactBar, 10)).toBeNull();
  });
  it("orders at the offer price unless the line price was negotiated", () => {
    expect(purchaseUnitPriceCents(castIronBar, 26245, 8748)).toBe(26245);
    expect(purchaseUnitPriceCents(castIronBar, 26245, 8000)).toBe(24000);
    const thirdOfAUnit = { ...castIronBar, estimate_units_per_purchase_unit: "0.333333" };
    expect(offerEstimateUnitPriceCents(thirdOfAUnit, 1000)).toBe(3000);
    expect(purchaseUnitPriceCents(thirdOfAUnit, 1000, 3000)).toBe(1000);
    expect(purchaseUnitPriceCents(thirdOfAUnit, 1000, 3300)).toBe(1100);
  });
  it("leaves an offer without conversion unchanged", () => {
    expect(hasPurchaseUnitConversion(plain)).toBe(false);
    expect(offerEstimateUnit(plain)).toBe("ml");
    expect(offerEstimateUnitPriceCents(plain, 26245)).toBe(26245);
    expect(purchaseQuantity(plain, 282)).toBe(282);
    expect(purchaseUnitPriceCents(plain, 26245, 8000)).toBe(8000);
  });
});

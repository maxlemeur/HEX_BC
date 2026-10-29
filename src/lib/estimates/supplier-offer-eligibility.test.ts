import { describe, expect, it } from "vitest";
import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";

// Isolation exception: value/quantity safety must remain verifiable while the
// authenticated E2E setup is unavailable; browser contract is catalogue-demo.spec.
// Sub-lot 2.2: this predicate is shared by six price paths (eligibility, best
// price, preselection, suggestion popover, article sheet, purchase preparation);
// its edge cases (zero price with or without marking, unit spellings) are cheaper
// to pin here than in E2E. Journeys: docs/testing/estimate-engine-v3-2.2.md.
const context = { currency: "EUR", quantity: 30, unit: "m", today: "2026-10-02" };
const priced = { unit_price_cents: 1240 };

describe("supplier offer applicability", () => {
  it("refuses a quantity below the supplier minimum and permits the boundary", () => {
    const offer = { ...priced, currency: "EUR", unit: "m", min_quantity: 100 };
    expect(supplierOfferIneligibility(offer, context)).toBe("Minimum 100 m");
    expect(supplierOfferIneligibility(offer, { ...context, quantity: 100 })).toBeNull();
    expect(supplierOfferIneligibility(offer, { ...context, quantity: null })).toBe("Quantité du devis à préciser");
  });
  it("refuses inactive, future and expired offers, with inclusive validity dates", () => {
    expect(supplierOfferIneligibility({ ...priced, is_active: false }, context)).toBe("Offre archivée");
    expect(supplierOfferIneligibility({ ...priced, valid_from: "2026-10-03" }, context)).toBe("Offre pas encore valable");
    expect(supplierOfferIneligibility({ ...priced, valid_to: "2026-10-01" }, context)).toBe("Offre expirée");
    expect(supplierOfferIneligibility({ ...priced, valid_from: context.today, valid_to: context.today }, context)).toBeNull();
  });
  it("keeps the currency fence consistent with manual selection", () => {
    expect(supplierOfferIneligibility({ ...priced, currency: "USD" }, context)).toBe("Conversion de devise requise");
    expect(supplierOfferIneligibility({ ...priced, currency: "EUR" }, context)).toBeNull();
  });
});

describe("linear metre spellings (P-08, T-UNIT2)", () => {
  // Transposes docs/audit-independant-2026-10-14/reproductions/rules.audit.test.ts:101.
  it.each([
    ["ML", "ml"], ["mL", "ml"], ["Ml", "ml"], [" ML ", "m"], ["m", "ML"], ["ml", "M"],
  ])("treats line unit %j and offer unit %j as the same metre", (lineUnit, offerUnit) => {
    expect(supplierOfferIneligibility({ ...priced, unit: offerUnit }, { ...context, unit: lineUnit })).toBeNull();
  });
  it("keeps refusing units that are not metres", () => {
    expect(supplierOfferIneligibility({ ...priced, unit: "m2" }, { ...context, unit: "ML" })).toBe("Unité différente du devis");
    expect(supplierOfferIneligibility({ ...priced, unit: "u" }, { ...context, unit: "ml" })).toBe("Unité différente du devis");
  });
});

describe("shared unit referential and purchase units (sub-lot 2.9)", () => {
  // D9, point 30 of estimate-engine-v3-2.4.md: offers compare units through the shared referential.
  it.each([
    ["m.l.", "ml"], ["mètre linéaire", "m"], ["Pce", "u"], ["pièce", "U"], ["forfait", "fft"], ["Ft", "forfait"],
  ])("treats line unit %j and offer unit %j as the same unit", (lineUnit, offerUnit) => {
    expect(supplierOfferIneligibility({ ...priced, unit: offerUnit }, { ...context, unit: lineUnit })).toBeNull();
  });
  it("still compares units outside the referential by their spelling", () => {
    expect(supplierOfferIneligibility({ ...priced, unit: "Barre" }, { ...context, unit: "barre" })).toBeNull();
    expect(supplierOfferIneligibility({ ...priced, unit: "sac" }, { ...context, unit: "barre" })).toBe("Unité différente du devis");
  });
  it("applies the minimum order to the purchase quantity", () => {
    const bar = { ...priced, unit: "barre", estimate_unit_code: "ml", estimate_units_per_purchase_unit: "3.000000",
      purchase_rounding: "ceil", min_quantity: 5 };
    expect(supplierOfferIneligibility(bar, { ...context, unit: "ml", quantity: 12 })).toBe("Minimum 5 barre");
    expect(supplierOfferIneligibility(bar, { ...context, unit: "ml", quantity: 13 })).toBeNull();
  });
});

describe("purchase units after review (sub-lot 2.9)", () => {
  const bar = { ...priced, unit: "barre", estimate_unit_code: "ml", estimate_units_per_purchase_unit: "3", purchase_rounding: "ceil" };
  it("refuses an unrepresentable purchase quantity even without a minimum", () => {
    const exact = { ...bar, purchase_rounding: "none", min_quantity: null };
    expect(supplierOfferIneligibility(exact, { ...context, unit: "ml", quantity: 10 })).toBe("Quantité non convertible en barre");
    expect(supplierOfferIneligibility(exact, { ...context, unit: "ml", quantity: 9 })).toBeNull();
  });
});

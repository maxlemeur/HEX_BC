import { describe, expect, it } from "vitest";
import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";

// Isolation exception: value/quantity safety must remain verifiable while the
// authenticated E2E setup is unavailable; browser contract is catalogue-demo.spec.
const context = { currency: "EUR", quantity: 30, unit: "m", today: "2026-10-02" };

describe("supplier offer applicability", () => {
  it("refuses a quantity below the supplier minimum and permits the boundary", () => {
    const offer = { currency: "EUR", unit: "m", min_quantity: 100 };
    expect(supplierOfferIneligibility(offer, context)).toBe("Minimum 100 m");
    expect(supplierOfferIneligibility(offer, { ...context, quantity: 100 })).toBeNull();
    expect(supplierOfferIneligibility(offer, { ...context, quantity: null })).toBe("Quantité du devis à préciser");
  });
  it("permits metre aliases but never invents a conversion from kilograms", () => {
    expect(supplierOfferIneligibility({ unit: "ml" }, context)).toBeNull();
    expect(supplierOfferIneligibility({ unit: "kg" }, context)).toBe("Unité différente du devis");
  });
  it("refuses inactive, future and expired offers, with inclusive validity dates", () => {
    expect(supplierOfferIneligibility({ is_active: false }, context)).toBe("Offre archivée");
    expect(supplierOfferIneligibility({ valid_from: "2026-10-03" }, context)).toBe("Offre pas encore valable");
    expect(supplierOfferIneligibility({ valid_to: "2026-10-01" }, context)).toBe("Offre expirée");
    expect(supplierOfferIneligibility({ valid_from: context.today, valid_to: context.today }, context)).toBeNull();
  });
  it("keeps the currency fence consistent with manual selection", () => {
    expect(supplierOfferIneligibility({ currency: "USD" }, context)).toBe("Conversion de devise requise");
    expect(supplierOfferIneligibility({ currency: "EUR" }, context)).toBeNull();
  });
});

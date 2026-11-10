import { describe, expect, it } from "vitest";

import { commercialLengthQuantity, financialReviewRecommended, isQuantityWarning, quantityConfidence } from "@/lib/takeoff/quantity-review-policy";

describe("TI-681 quantity review policy", () => {
  it.each([
    [49_999, 5_000_000, false], [50_000, 5_000_000, true],
    [99_999, 20_000_000, false], [100_000, 20_000_000, true],
    [60_000, 5_000_000, true], [0, 5_000_000, false],
  ])("recommends the first financial threshold, including equality (%s / %s)", (post, lot, expected) => {
    expect(financialReviewRecommended(post, lot)).toBe(expected);
  });

  it("keeps an unavailable amount unknown, while a known 1000 EUR post always qualifies", () => {
    expect(financialReviewRecommended(null, 5_000_000)).toBeNull();
    expect(financialReviewRecommended(60_000, null)).toBeNull();
    expect(financialReviewRecommended(100_000, null)).toBe(true);
  });

  it("rounds the consolidated length once and keeps other dimensions unchanged", () => {
    expect(commercialLengthQuantity(2.2 + 2.2, "ml")).toBe(5);
    expect(commercialLengthQuantity(12.14, "m")).toBe(13);
    expect(commercialLengthQuantity(12, "m")).toBe(12);
    expect(commercialLengthQuantity(12.14, "m²")).toBe(12.14);
    expect(commercialLengthQuantity(12.14, "u")).toBe(12.14);
    expect(commercialLengthQuantity(214, "cm")).toBe(300);
    expect(commercialLengthQuantity(0, "m")).toBe(0);
  });

  it("reports explained confidence without claiming measured reliability", () => {
    expect(quantityConfidence(0.95, [])).toBe("high");
    expect(quantityConfidence(0.6, [])).toBe("medium");
    expect(quantityConfidence(null, [])).toBe("low");
    expect(quantityConfidence(0.95, ["Texte illisible"])).toBe("low");
    expect(quantityConfidence(0.95, ["Écart entre deux lectures"])).toBe("medium");
  });

  it("separates quantity uncertainty from technical protections and unknown rules", () => {
    expect(isQuantityWarning("ZONE_OVERLAP_DUPLICATE")).toBe(true);
    expect(isQuantityWarning("NON_OBSERVABLE_TO_ENTER")).toBe(true);
    expect(isQuantityWarning("DN_NETWORK_MATERIAL_BLOCKED")).toBe(false);
    expect(isQuantityWarning("DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION")).toBe(false);
    expect(isQuantityWarning("UNKNOWN_FUTURE_RULE")).toBe(false);
  });
});

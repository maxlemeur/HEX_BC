import { describe, expect, it } from "vitest";

import { prepareEstimateBulkItems } from "@/lib/estimates/item-bulk-plan";
import { prepareEstimateVersionSettingsPatch } from "@/lib/estimates/version-settings-plan";
import {
  extractPatchedEstimateTotals,
  getEstimateTotalsInvariantViolation,
  mergeEstimateTotalsForPatch,
} from "@/lib/estimates/version-totals-invariant";
import { normalizeEstimateCurrencyOrThrow, toNullableText } from "@/lib/estimates/version-write-normalization";

const persistedTotals = { total_ht_cents: 1000, total_tax_cents: 200, total_ttc_cents: 1200 };

describe("version write intentions", () => {
  it("merges only supplied totals and preserves nulls in persisted historical totals", () => {
    const incompleteTotals = { ...persistedTotals, total_tax_cents: null };
    const patch = { total_ht_cents: 900 };
    expect(mergeEstimateTotalsForPatch({ persistedTotals: incompleteTotals, patch })).toEqual({
      total_ht_cents: 900, total_tax_cents: null, total_ttc_cents: 1200,
    });
    expect(extractPatchedEstimateTotals(patch)).toEqual(patch);
    expect(incompleteTotals.total_ht_cents).toBe(1000);
  });

  it.each([
    [{ total_ht_cents: 1000, total_tax_cents: -1, total_ttc_cents: 900 }, "total_ttc_gte_total_ht"],
    [{ total_ht_cents: 1000, total_tax_cents: -1, total_ttc_cents: 1200 }, "total_tax_non_negative"],
    [{ total_ht_cents: 1000, total_tax_cents: 200, total_ttc_cents: 1201 }, "total_ttc_equals_total_ht_plus_total_tax"],
  ] as const)("reports the first violated historical total invariant", (totals, rule) => {
    expect(getEstimateTotalsInvariantViolation(totals)?.rule).toBe(rule);
  });

  it("accepts coherent or incomplete historical totals without inventing amounts", () => {
    expect(getEstimateTotalsInvariantViolation(persistedTotals)).toBeNull();
    expect(getEstimateTotalsInvariantViolation({ ...persistedTotals, total_tax_cents: null })).toBeNull();
    expect(getEstimateTotalsInvariantViolation({ total_ht_cents: null, total_tax_cents: null, total_ttc_cents: null })).toBeNull();
  });

  it("projects settings without caller totals or revision metadata", () => {
    expect(prepareEstimateVersionSettingsPatch({
      expected_content_revision: 7,
      title: "  Offre actualisée  ",
      exclusions: " \n ",
      currency: "USD",
      sale_coefficient_fo: 1.3,
      sale_coefficient_mo: 1.2,
      discount_amount_cents: null,
      total_ht_cents: 999,
      total_tax_cents: 99,
      total_ttc_cents: 1098,
      apply_tax_rate_to_lines: true,
    })).toEqual({
      title: "Offre actualisée",
      exclusions: null,
      currency: "USD",
      sale_coefficient_fo: 1.3,
      sale_coefficient_mo: 1.2,
      discount_amount_cents: null,
    });
    expect(prepareEstimateVersionSettingsPatch({ expected_content_revision: 7 })).toEqual({});
  });

  it("keeps absent product links untouched and validates explicitly supplied links once", () => {
    const items = [
      { id: "line-1", aid: "  A1  ", product_id: "product-1", selected_supplier_price_id: null },
      { id: "line-2", product_id: "product-1" },
      { id: "line-3", title: "No linked-field change" },
    ];
    const result = prepareEstimateBulkItems(items, /^A\d+$/);
    expect(result.updatesPayload[0].aid).toBe("A1");
    expect(items[0].aid).toBe("  A1  ");
    expect(result.updatesPayload[2]).not.toHaveProperty("product_id");
    expect([...result.productIdsToValidate]).toEqual(["product-1"]);
    expect([...result.supplierPriceIdsToValidate]).toEqual([null]);
    expect(() => prepareEstimateBulkItems([{ id: "line-1", aid: "invalid" }], /^A\d+$/))
      .toThrow("AID invalide");
  });

  it("retains currency fallback policy and nullable text semantics", () => {
    expect(normalizeEstimateCurrencyOrThrow(" usd ")).toBe("USD");
    expect(normalizeEstimateCurrencyOrThrow(" gbp ")).toBe("GBP");
    expect(normalizeEstimateCurrencyOrThrow(null, { fallback: "EUR" })).toBe("EUR");
    expect(normalizeEstimateCurrencyOrThrow("JPY", { fallback: "EUR", fallbackOnInvalid: true })).toBe("EUR");
    expect(() => normalizeEstimateCurrencyOrThrow("JPY", { fallback: "EUR" })).toThrow("Devise invalide");
    expect(() => normalizeEstimateCurrencyOrThrow(" ")).toThrow("Devise invalide");
    expect(toNullableText(undefined)).toBeNull();
    expect(toNullableText("  ")).toBeNull();
    expect(toNullableText("  Texte  ")).toBe("Texte");
  });
});

import { describe, expect, it } from "vitest";

import { prepareEstimateBulkItems } from "@/lib/estimates/item-bulk-plan";
import { prepareEstimateVersionSettingsPatch } from "@/lib/estimates/version-settings-plan";

describe("version write intentions", () => {
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
});

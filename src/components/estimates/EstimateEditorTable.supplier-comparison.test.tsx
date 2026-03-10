import { describe, expect, it } from "vitest";

import { parseSupplierComparisonResult } from "@/components/estimates/EstimateEditorTable";

describe("parseSupplierComparisonResult", () => {
  it("preserves enriched supplier comparison alternatives instead of truncating them", () => {
    const result = parseSupplierComparisonResult(
      {
        data: {
          comparisons: [
            {
              item_id: "item-1",
              best_supplier_price_id: "price-best",
              selected_supplier_price_id: "price-old",
              alternatives: [
                {
                  kind: "best_price",
                  supplier_price_id: "price-best",
                  supplier_id: "supplier-best",
                  supplier_name: "Best Supplier",
                  adjusted_unit_price_cents: 900,
                  supplier_reference: "BEST-1",
                  updated_at: "2026-02-20T00:00:00.000Z",
                  is_stale: false,
                  catalogue_url: "https://example.com/best",
                  product_designation: "Faux plafond acoustique",
                  is_selected: false,
                },
                {
                  kind: "most_recent",
                  supplier_price_id: "price-recent",
                  supplier_id: "supplier-recent",
                  supplier_name: "Recent Supplier",
                  adjusted_unit_price_cents: 1200,
                  supplier_reference: "RECENT-1",
                  updated_at: "2026-03-05T00:00:00.000Z",
                  is_stale: false,
                  catalogue_url: "https://example.com/recent",
                  product_designation: "Faux plafond acoustique",
                  is_selected: false,
                },
                {
                  kind: "preferred_supplier",
                  supplier_price_id: "price-preferred",
                  supplier_id: "supplier-preferred",
                  supplier_name: "Preferred Supplier",
                  adjusted_unit_price_cents: 1000,
                  supplier_reference: "PREF-1",
                  updated_at: "2026-02-10T00:00:00.000Z",
                  is_stale: false,
                  catalogue_url: "https://example.com/preferred",
                  product_designation: "Faux plafond acoustique",
                  is_selected: false,
                },
                {
                  kind: "selected_current",
                  supplier_price_id: "price-old",
                  supplier_id: "supplier-old",
                  supplier_name: "Old Supplier",
                  adjusted_unit_price_cents: 1100,
                  supplier_reference: "OLD-1",
                  updated_at: "2025-10-01T00:00:00.000Z",
                  is_stale: true,
                  catalogue_url: "https://example.com/old",
                  product_designation: "Faux plafond acoustique",
                  is_selected: true,
                },
              ],
            },
          ],
        },
      },
      "item-1"
    );

    expect(result.alternatives).toHaveLength(4);
    expect(result.alternatives.map((alternative) => alternative.kind)).toEqual([
      "best_price",
      "most_recent",
      "preferred_supplier",
      "selected_current",
    ]);
    expect(result.alternatives[3]).toMatchObject({
      supplier_price_id: "price-old",
      supplier_id: "supplier-old",
      is_selected: true,
      is_stale: true,
      kind: "selected_current",
    });
  });
});

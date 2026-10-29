import { describe, expect, it } from "vitest";

import {
  mergeCatalogueProductSuggestions,
  type CatalogueProductSuggestionRecord,
} from "@/lib/estimates/catalogue-suggestions";

function product(
  partial: Partial<CatalogueProductSuggestionRecord>,
): CatalogueProductSuggestionRecord {
  return {
    id: "product-1",
    designation: "Produit",
    reference: null,
    category: null,
    product_type: null,
    material: null,
    grade: null,
    dimensions: null,
    standard: null,
    unit: "u",
    unit_price_cents: 0,
    updated_at: "2026-08-20T19:34:00.000Z",
    ...partial,
  };
}

describe("mergeCatalogueProductSuggestions", () => {
  it("conserve un produit sans aucun prix comme résultat sélectionnable", () => {
    const suggestions = mergeCatalogueProductSuggestions({
      query: "rouge",
      stalePriceDays: 90,
      products: [product({ id: "red-no-price", designation: "Rouge" })],
      supplierSuggestions: [],
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      price_source: "none",
      supplier_price_id: null,
      supplier_id: null,
      adjusted_unit_price_cents: 0,
      alternatives: [],
    });
  });
});

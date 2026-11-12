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

  // TI-690. Failure mode: a draft reached by a deliberate search is returned without its status, so the
  // panel cannot label it and the operator links an unreviewed article unknowingly.
  it("porte l’état brouillon d’un article, et considère validé un article sans état", () => {
    const suggestions = mergeCatalogueProductSuggestions({
      query: "cheville",
      stalePriceDays: 90,
      products: [
        product({ id: "draft", designation: "Cheville M10", catalogue_status: "draft" }),
        product({ id: "legacy", designation: "Cheville M12" }),
      ],
      supplierSuggestions: [],
    });

    expect(
      Object.fromEntries(suggestions.map((entry) => [entry.product_id, entry.product_catalogue_status])),
    ).toEqual({ draft: "draft", legacy: "validated" });
  });
});

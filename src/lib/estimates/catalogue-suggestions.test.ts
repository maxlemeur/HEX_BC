import { describe, expect, it } from "vitest";

import {
  mergeCatalogueProductSuggestions,
  type CataloguePriceSuggestion,
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

function supplierSuggestion(
  partial: Partial<CataloguePriceSuggestion>,
): CataloguePriceSuggestion {
  return {
    price_source: "supplier",
    supplier_price_id: "price-1",
    product_id: "supplier-product",
    product_designation: "Té droit inox",
    product_reference: "TE-DROIT",
    product_category: "Raccords",
    product_type: "Té droit",
    product_material: "Inox",
    product_grade: null,
    product_dimensions: null,
    product_standard: null,
    supplier_id: "supplier-1",
    supplier_name: "Fournisseur",
    supplier_reference: "SUP-1",
    unit: "u",
    unit_price_cents: 1250,
    adjusted_unit_price_cents: 1250,
    currency: "EUR",
    updated_at: "2026-08-20T20:00:00.000Z",
    is_stale: false,
    stale_days: 90,
    relevance_score: 60,
    has_material_index_adjustment: false,
    material_index_code: null,
    material_index_value: null,
    catalogue_url: null,
    supplier_offer_count: 1,
    alternatives: [],
    ...partial,
  };
}

describe("mergeCatalogueProductSuggestions", () => {
  it("classe un produit commençant par la recherche avant une correspondance partielle fournisseur", () => {
    const suggestions = mergeCatalogueProductSuggestions({
      query: "ro",
      stalePriceDays: 90,
      products: [
        product({
          id: "red",
          designation: "Rouge",
          unit_price_cents: 2000,
        }),
        product({
          id: "protection",
          designation:
            "Adhésif de protection 50mm x 33m - PVC blanc — Ruban / Adhésif",
          product_type: "Protection",
        }),
      ],
      supplierSuggestions: [supplierSuggestion({})],
    });

    expect(suggestions.map((suggestion) => suggestion.product_designation)).toEqual([
      "Rouge",
      "Adhésif de protection 50mm x 33m - PVC blanc — Ruban / Adhésif",
      "Té droit inox",
    ]);
    expect(suggestions[0]).toMatchObject({
      price_source: "reference",
      supplier_price_id: null,
      adjusted_unit_price_cents: 2000,
      supplier_offer_count: 0,
    });
  });

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

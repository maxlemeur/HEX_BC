export type CatalogueSuggestionPriceSource =
  | "supplier"
  | "reference"
  | "none";

export type SupplierAlternativeKind =
  | "best_price"
  | "most_recent"
  | "preferred_supplier";

export type SupplierAlternative = {
  kind: SupplierAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  supplier_reference: string | null;
  unit: string | null;
  updated_at: string | null;
  is_stale: boolean;
  catalogue_url: string | null;
};

export type CataloguePriceSuggestion = {
  price_source: CatalogueSuggestionPriceSource;
  supplier_price_id: string | null;
  product_id: string;
  product_designation: string;
  product_reference: string | null;
  product_category?: string | null;
  product_type?: string | null;
  product_material?: string | null;
  product_grade?: string | null;
  product_dimensions?: string | null;
  product_standard?: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_reference: string | null;
  unit: string | null;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  updated_at: string | null;
  is_stale: boolean;
  stale_days: number;
  relevance_score: number;
  has_material_index_adjustment: boolean;
  material_index_code: string | null;
  material_index_value: number | null;
  catalogue_url: string | null;
  supplier_offer_count: number;
  alternatives: SupplierAlternative[];
};

export type SupplierBackedCatalogueSuggestion = CataloguePriceSuggestion & {
  price_source: "supplier";
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
};

export function isSupplierBackedCatalogueSuggestion(
  suggestion: CataloguePriceSuggestion,
): suggestion is SupplierBackedCatalogueSuggestion {
  return (
    suggestion.price_source === "supplier" &&
    suggestion.supplier_price_id !== null &&
    suggestion.supplier_id !== null &&
    suggestion.supplier_name !== null
  );
}

export type CatalogueProductSuggestionRecord = {
  id: string;
  designation: string;
  reference: string | null;
  category: string | null;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
  unit: string;
  unit_price_cents: number;
  updated_at: string;
};

type SearchRelevanceInput = {
  query: string;
  designation: string;
  supplierName: string;
  supplierSku: string | null;
  productReference: string | null;
  category?: string | null;
  productType?: string | null;
  material?: string | null;
  grade?: string | null;
  dimensions?: string | null;
  standard?: string | null;
};

export function computeCatalogueSearchRelevance(
  input: SearchRelevanceInput,
) {
  const query = input.query.toLowerCase();
  const designation = input.designation.toLowerCase();
  const supplierName = input.supplierName.toLowerCase();
  const supplierSku = (input.supplierSku ?? "").toLowerCase();
  const productReference = (input.productReference ?? "").toLowerCase();
  const technicalDetails = [
    input.category,
    input.productType,
    input.material,
    input.grade,
    input.dimensions,
    input.standard,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  let primaryMatchRank = 0;

  if (designation === query) {
    primaryMatchRank = Math.max(primaryMatchRank, 6);
  } else if (designation.startsWith(query)) {
    primaryMatchRank = Math.max(primaryMatchRank, 4);
  } else if (designation.includes(query)) {
    primaryMatchRank = Math.max(primaryMatchRank, 2);
  }

  if (productReference === query) {
    primaryMatchRank = Math.max(primaryMatchRank, 5);
  } else if (productReference.startsWith(query)) {
    primaryMatchRank = Math.max(primaryMatchRank, 3);
  } else if (productReference.includes(query)) {
    primaryMatchRank = Math.max(primaryMatchRank, 1);
  }

  let secondaryScore = 0;

  if (supplierName === query) {
    secondaryScore += 300;
  } else if (supplierName.includes(query)) {
    secondaryScore += 200;
  }

  if (supplierSku === query) {
    secondaryScore += 150;
  } else if (supplierSku.includes(query)) {
    secondaryScore += 100;
  }

  technicalDetails.forEach((detail) => {
    if (detail === query) {
      secondaryScore += 50;
    } else if (detail.includes(query)) {
      secondaryScore += 25;
    }
  });

  return primaryMatchRank * 1_000 + secondaryScore;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

const PRICE_SOURCE_PRIORITY: Record<CatalogueSuggestionPriceSource, number> = {
  supplier: 2,
  reference: 1,
  none: 0,
};

export function mergeCatalogueProductSuggestions(input: {
  query: string;
  stalePriceDays: number;
  products: CatalogueProductSuggestionRecord[];
  supplierSuggestions: CataloguePriceSuggestion[];
  limit?: number;
}) {
  const suggestionByProductId = new Map(
    input.supplierSuggestions.map((suggestion) => [
      suggestion.product_id,
      suggestion,
    ]),
  );

  input.products.forEach((product) => {
    if (suggestionByProductId.has(product.id)) return;

    const relevanceScore = computeCatalogueSearchRelevance({
      query: input.query,
      designation: product.designation,
      supplierName: "",
      supplierSku: null,
      productReference: product.reference,
      category: product.category,
      productType: product.product_type,
      material: product.material,
      grade: product.grade,
      dimensions: product.dimensions,
      standard: product.standard,
    });

    if (relevanceScore <= 0) return;

    const priceSource: CatalogueSuggestionPriceSource =
      product.unit_price_cents > 0 ? "reference" : "none";

    suggestionByProductId.set(product.id, {
      price_source: priceSource,
      supplier_price_id: null,
      product_id: product.id,
      product_designation: product.designation,
      product_reference: product.reference,
      product_category: product.category,
      product_type: product.product_type,
      product_material: product.material,
      product_grade: product.grade,
      product_dimensions: product.dimensions,
      product_standard: product.standard,
      supplier_id: null,
      supplier_name: null,
      supplier_reference: null,
      unit: product.unit,
      unit_price_cents: product.unit_price_cents,
      adjusted_unit_price_cents: product.unit_price_cents,
      currency: null,
      updated_at: product.updated_at,
      is_stale: false,
      stale_days: input.stalePriceDays,
      relevance_score: relevanceScore,
      has_material_index_adjustment: false,
      material_index_code: null,
      material_index_value: null,
      catalogue_url: null,
      supplier_offer_count: 0,
      alternatives: [],
    });
  });

  return [...suggestionByProductId.values()]
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }

      const pricePriorityDifference =
        PRICE_SOURCE_PRIORITY[right.price_source] -
        PRICE_SOURCE_PRIORITY[left.price_source];
      if (pricePriorityDifference !== 0) return pricePriorityDifference;

      const updatedAtDifference =
        toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
      if (updatedAtDifference !== 0) return updatedAtDifference;

      return left.product_designation.localeCompare(
        right.product_designation,
        "fr",
      );
    })
    .slice(0, input.limit ?? 10);
}

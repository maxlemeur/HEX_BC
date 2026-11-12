/**
 * An article is a draft or validated (TI-690). Drafts come from an imported price base or from a material
 * request; they stay out of the estimate editor's suggestions until an administrator validates them.
 *
 * The database is the authority on the draft -> validated step (trigger validate_product_catalogue_status,
 * PRODUCT_VALIDATION_INCOMPLETE). This module mirrors its rule so a screen can highlight what is missing
 * before the refusal, and turns that refusal into a sentence.
 */

export const PRODUCT_CATALOGUE_STATUSES = ["draft", "validated"] as const;
export type ProductCatalogueStatus = (typeof PRODUCT_CATALOGUE_STATUSES)[number];

/** What a draft needs to be validated. Dimension, reference, supplier and price are deliberately absent. */
export const PRODUCT_VALIDATION_FIELDS = [
  "product_type",
  "material",
  "unit",
  "supply_type_id",
] as const;
export type ProductValidationField = (typeof PRODUCT_VALIDATION_FIELDS)[number];

const FIELD_LABELS: Record<ProductValidationField, string> = {
  product_type: "le type d’article",
  material: "la matière",
  unit: "l’unité",
  supply_type_id: "le type de fourniture",
};

export const PRODUCT_VALIDATION_INCOMPLETE = "PRODUCT_VALIDATION_INCOMPLETE";
export const PRODUCT_SUPPLY_TYPE_INVALID = "PRODUCT_SUPPLY_TYPE_INVALID";

type ValidationCandidate = Partial<Record<ProductValidationField, string | null | undefined>>;

function isBlank(value: string | null | undefined) {
  return typeof value !== "string" || value.trim().length === 0;
}

export function missingProductValidationFields(
  product: ValidationCandidate,
): ProductValidationField[] {
  return PRODUCT_VALIDATION_FIELDS.filter((field) => isBlank(product[field]));
}

/** Reads the `detail` of the database refusal: a comma-separated list of column names. */
export function productValidationFieldsFromDetail(
  detail: string | null | undefined,
): ProductValidationField[] {
  if (typeof detail !== "string") return [];
  const named = new Set(detail.split(",").map((part) => part.trim()));
  return PRODUCT_VALIDATION_FIELDS.filter((field) => named.has(field));
}

export function productValidationMessage(missing: readonly ProductValidationField[]) {
  if (missing.length === 0) {
    return "Cet article est incomplet : renseignez le type d’article, la matière, l’unité et le type de fourniture avant de le valider.";
  }
  return `Pour valider cet article, renseignez : ${missing.map((field) => FIELD_LABELS[field]).join(", ")}.`;
}

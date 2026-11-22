import { z } from "zod";

import { productParamsSchema, uuidParamSchema } from "@/lib/http/request";
import { formatDecimalInput, parseQuantity } from "@/lib/numeric-input/parsers";

/**
 * Sale packagings of a catalogue article (« conditionnements de vente »): a label and how many units of the article
 * one packaging holds, in the article's unit (« Barre » of 6 for an article in ml). At most one is the usual one.
 * Informative only: no quantity, price, estimate or order reads them. Stored in `public.product_packagings`
 * (migration 20261122092341_product_packagings.sql), whose trigger takes the tenant and the unit from the article,
 * trims the label, computes its key and position, and moves the usual mark. A packaging keeps its article's unit:
 * the unit of an article that has packagings cannot change (foreign key ON UPDATE RESTRICT).
 */

/** `product_packagings.label`: 1 to 80 characters once trimmed. */
export const PRODUCT_PACKAGING_LABEL_MAX = 80;
/** `numeric(14, 3)`: eleven integer digits and three decimals. */
export const PRODUCT_PACKAGING_QUANTITY_MAX = 99_999_999_999.999;

/** Offered while typing a label; any other word is accepted. */
export const PRODUCT_PACKAGING_LABEL_SUGGESTIONS = [
  "Barre",
  "Touret",
  "Couronne",
  "Bobine",
  "Rouleau",
  "Boîte",
  "Carton",
  "Sac",
  "Palette",
  "Lot",
] as const;

export type ProductPackaging = {
  id: string;
  label: string;
  /** Units of the article in one packaging, in `unit`. */
  quantity: number;
  is_usual: boolean;
  /** The article's unit, which the quantity is expressed in. */
  unit: string;
};

/** The packagings of an article in the order they were added, and whether the caller may change them. */
export type ProductPackagings = { items: ProductPackaging[]; can_edit: boolean };

/** Spaces trimmed and collapsed, as the database stores the label. */
export function normalizePackagingLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

/** What makes two packagings of an article the same: their label folded for case and accents, and their quantity. */
export function packagingKey(label: string, quantity: number): string {
  const folded = normalizePackagingLabel(label)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return `${folded}|${quantity}`;
}

const label = z
  .string()
  .transform(normalizePackagingLabel)
  .pipe(
    z
      .string()
      .min(1, "Renseignez le conditionnement (par exemple « Barre »).")
      .max(PRODUCT_PACKAGING_LABEL_MAX, `${PRODUCT_PACKAGING_LABEL_MAX} caractères au plus.`),
  );

const quantity = z
  .number()
  .positive("La quantité doit être supérieure à zéro.")
  .max(PRODUCT_PACKAGING_QUANTITY_MAX, "Quantité trop grande.")
  .refine((value) => parseQuantity(value) === value, { message: "Trois décimales au plus." });

export const createProductPackagingSchema = z
  .object({ label, quantity, is_usual: z.boolean().optional() })
  .strict();
export type CreateProductPackagingInput = z.input<typeof createProductPackagingSchema>;
export type CreateProductPackagingData = z.output<typeof createProductPackagingSchema>;

/** A key left out keeps what is stored. `is_usual: true` moves the mark here; false removes it. */
export const updateProductPackagingSchema = z
  .object({ label: label.optional(), quantity: quantity.optional(), is_usual: z.boolean().optional() })
  .strict()
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "Aucun champ de mise à jour fourni.",
  });
export type UpdateProductPackagingInput = z.input<typeof updateProductPackagingSchema>;
export type UpdateProductPackagingData = z.output<typeof updateProductPackagingSchema>;

/** `{ productId, packagingId }` of the routes of one packaging. */
export const productPackagingParamsSchema = productParamsSchema.extend({ packagingId: uuidParamSchema("packagingId") });

/** Refusal of a second packaging with the same label and quantity (unique index of the article). */
export const PRODUCT_PACKAGING_DUPLICATE = "Ce conditionnement existe déjà pour cet article.";

/** An article without a unit (a draft) gets no packaging (trigger: PRODUCT_PACKAGING_UNIT_REQUIRED). */
export const PRODUCT_PACKAGING_UNIT_REQUIRED = "PRODUCT_PACKAGING_UNIT_REQUIRED";
export const PRODUCT_PACKAGING_UNIT_REQUIRED_MESSAGE =
  "Renseignez et enregistrez l’unité de l’article avant d’ajouter ses conditionnements de vente.";

/** The unit of an article that has packagings does not change (foreign key product_packagings_article_unit_fkey). */
export const PRODUCT_UNIT_HAS_PACKAGINGS = "PRODUCT_UNIT_HAS_PACKAGINGS";
export const PRODUCT_UNIT_HAS_PACKAGINGS_MESSAGE =
  "Retirez les conditionnements de vente avant de changer l’unité de l’article : leurs quantités sont exprimées dans l’unité actuelle.";

/** The refusal of a write that would change the unit of an article that has packagings. */
export function isProductUnitHeldByPackagings(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === "23503" && (error.message ?? "").includes("product_packagings_article_unit_fkey");
}

const UNIT_LABELS: Record<string, string> = { m2: "m²", m3: "m³" };

/** The article's unit as the form shows it. */
export function packagingUnitLabel(unit: string | null | undefined): string {
  const trimmed = unit?.trim() ?? "";
  return UNIT_LABELS[trimmed] ?? trimmed;
}

/** « Barre de 6 ml », « Touret de 100 ml », « Boîte de 2,5 kg ». */
export function describePackaging(packaging: Pick<ProductPackaging, "label" | "quantity">, unit: string | null | undefined) {
  const unitLabel = packagingUnitLabel(unit);
  const amount = formatDecimalInput(packaging.quantity);
  return `${packaging.label} de ${amount}${unitLabel ? ` ${unitLabel}` : ""}`;
}

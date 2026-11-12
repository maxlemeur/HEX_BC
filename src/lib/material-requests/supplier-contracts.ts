import { z } from "zod";

/**
 * Suppliers of material request lines (TI-691, lot 2 « l'achat », delivery 1): the supplier a line will be
 * bought from is purchasing information chosen by the office, not what the technician asked. This module is
 * the contract shared by the server, the API and the screens; nothing here touches the network.
 *
 * A line with an article and no supplier gets a proposed supplier, in this order (owner's decision):
 *  1. technician: the supplier the technician named for the request (`presumed_supplier_id`);
 *  2. article: the exception set on the article (`products.preferred_supplier_id`);
 *  3. supply_type: the preferred supplier of the article's supply type (`supply_types.preferred_supplier_id`);
 *  4. last_purchase: the supplier of the latest confirmed or received order carrying the article.
 * A proposal is never applied by itself: the office sets the line's supplier with the line PATCH, and may
 * always change it. A validated line stays validated when its supplier changes.
 */

export const LINE_SUPPLIER_REASONS = ["technician", "article", "supply_type", "last_purchase"] as const;
export type LineSupplierReason = (typeof LINE_SUPPLIER_REASONS)[number];

/** The article's reference and address at one supplier, from its active supplier item; null when there is none. */
export type LineSupplierReference = {
  supplier_sku: string | null;
  product_url: string | null;
};

export type LineSupplierProposal = LineSupplierReference & {
  supplier_id: string;
  supplier_name: string;
  reason: LineSupplierReason;
};

/** Answer of the proposals route. */
export type LineSupplierProposals = {
  /** One entry per line that has an article and no supplier yet (null: no source has one). */
  lines: Record<string, LineSupplierProposal | null>;
  /** One entry per line that has an article and a supplier: the article's reference at that supplier. */
  references: Record<string, LineSupplierReference>;
};

/** One supplier of an article, with its reference there (no price: prices live in the price book). */
export type ArticleSupplierItem = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_sku: string | null;
  product_url: string | null;
  is_active: boolean;
  /** At least one price row of the price book uses this item. */
  has_price: boolean;
};

/** Answer of the article's suppliers: its items, and its supplier exception (proposed before its supply type's). */
export type ArticleSuppliers = {
  items: ArticleSupplierItem[];
  preferred_supplier_id: string | null;
};

/**
 * Answer of a save: the item as stored, and the article's exception after it (withdrawing the supplier the
 * article names as its exception clears that exception in the same operation).
 */
export type ArticleSupplierItemSaved = {
  item: ArticleSupplierItem;
  preferred_supplier_id: string | null;
};

export const SUPPLIER_SKU_MAX = 255;
export const SUPPLIER_PRODUCT_URL_MAX = 2000;

const uuid = z.string().uuid("Identifiant invalide.");

/** Blank becomes null; an omitted key stays omitted (undefined), so that the save keeps the stored value. */
function optionalText(max: number, message: string) {
  return z
    .union([z.string().max(max, message), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    });
}

/**
 * Adds or changes the reference of an article at a supplier, without any price. Per key: omitted keeps what is
 * stored, null (or blank) clears it, a value replaces it. An active item keeps a reference or an address: a new
 * one needs one, and a save cannot clear both (the database checks it against the stored item; this schema
 * refuses the case it can see, both sent empty). `is_active` (true when omitted) withdraws or restores the
 * supplier: withdrawing needs no reference, so an item that only carries prices can be withdrawn as it is.
 * Nothing is deleted, and the prices stay in the price book.
 */
export const saveArticleSupplierItemSchema = z
  .object({
    supplier_id: uuid,
    supplier_sku: optionalText(SUPPLIER_SKU_MAX, `${SUPPLIER_SKU_MAX} caractères au plus.`),
    product_url: optionalText(SUPPLIER_PRODUCT_URL_MAX, `${SUPPLIER_PRODUCT_URL_MAX} caractères au plus.`).refine(
      (value) => value === undefined || value === null || /^https?:\/\/\S+$/i.test(value),
      { message: "L’adresse doit commencer par http:// ou https:// et ne pas contenir d’espace." },
    ),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (payload) => payload.is_active === false || payload.supplier_sku !== null || payload.product_url !== null,
    { message: "Renseignez la référence chez le fournisseur ou l’adresse de l’article.", path: ["supplier_sku"] },
  );
export type SaveArticleSupplierItemInput = z.input<typeof saveArticleSupplierItemSchema>;
export type SaveArticleSupplierItemData = z.output<typeof saveArticleSupplierItemSchema>;

/** The preferred supplier of a supply type; null removes it. */
export const supplyTypePreferredSupplierSchema = z
  .object({ preferred_supplier_id: z.union([uuid, z.null()]) })
  .strict();
export type SupplyTypePreferredSupplierInput = z.input<typeof supplyTypePreferredSupplierSchema>;

/** The supplier exception of an article, which wins over its supply type's; null removes it. */
export const productPreferredSupplierSchema = z
  .object({ preferred_supplier_id: z.union([uuid, z.null()]) })
  .strict();
export type ProductPreferredSupplierInput = z.input<typeof productPreferredSupplierSchema>;

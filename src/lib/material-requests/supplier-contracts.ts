import { z } from "zod";

import { MATERIAL_REQUEST_MAX_LINES, type MaterialRequestLine } from "./contracts";

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
 * A source is skipped, and the next one applies, when its supplier is archived or was withdrawn from the article
 * (the article's item at that supplier exists and is inactive). A proposal is never applied by itself: the office
 * sets the line's supplier with the line PATCH, or retains several proposals with `retain-suppliers`, which only
 * writes lines that still have none; it may always change it. A validated line stays validated when its supplier
 * changes.
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
  /** False only for the technician's supplier while the request has not confirmed it (« à confirmer »). */
  confirmed: boolean;
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
 * supplier: withdrawing needs no reference, so an item that only carries prices can be withdrawn as it is, and it
 * also clears the article's exception when it names that supplier. Nothing is deleted: the prices stay recorded but
 * are no longer proposed while the supplier is withdrawn from the article, and recording a price restores it.
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

/**
 * The supplier exception of an article, which wins over its supply type's; null removes it. A supplier needs an
 * active item for the article (422 PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED otherwise).
 */
export const productPreferredSupplierSchema = z
  .object({ preferred_supplier_id: z.union([uuid, z.null()]) })
  .strict();
export type ProductPreferredSupplierInput = z.input<typeof productPreferredSupplierSchema>;

/** Error code of an exception set to a supplier that has no active item for the article. */
export const PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED = "PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED";

/**
 * Retains a supplier for several lines at once (« Retenir », « Retenir les fournisseurs proposés »). Only the lines
 * that still have no supplier are written: one another session gave a supplier in the meantime is left alone, like
 * a line that is not in this request; both are listed in `skipped`. A line is named once.
 */
export const retainLineSuppliersSchema = z
  .object({
    choices: z
      .array(z.object({ line_id: uuid, supplier_id: uuid }).strict())
      .min(1, "Aucune ligne à renseigner.")
      .max(MATERIAL_REQUEST_MAX_LINES, `${MATERIAL_REQUEST_MAX_LINES} lignes au plus.`)
      .refine((choices) => new Set(choices.map((choice) => choice.line_id)).size === choices.length, {
        message: "Une ligne n’est nommée qu’une fois.",
      }),
  })
  .strict();
export type RetainLineSuppliersInput = z.input<typeof retainLineSuppliersSchema>;
export type RetainLineSuppliersData = z.output<typeof retainLineSuppliersSchema>;

export type RetainLineSuppliersResult = {
  /** The lines written, in the order of the request. */
  lines: MaterialRequestLine[];
  /** The lines named but not written: they already had a supplier, or are not lines of this request. */
  skipped: string[];
};

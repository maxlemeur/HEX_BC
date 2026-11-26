import { z } from "zod";

/**
 * What the office does after an import of the costing workbook (TI-711), shared by the screens and the routes:
 * it remembers the supplier a workbook name stands for, checks the imported supplier references together
 * instead of article by article, validates the complete drafts of an import together, gives a supply type to
 * several articles, and undoes an import that nobody touched yet.
 */

const id = z.uuid("Identifiant invalide.");

/** POST /api/catalogue/supplier-aliases: the workbook's name for a supplier of the catalogue. */
export const createSupplierAliasSchema = z.object({
  supplier_id: id,
  alias: z.string().trim().min(1, "Le nom à associer est requis.").max(255, "Le nom à associer ne peut pas dépasser 255 caractères."),
}).strict();
export type CreateSupplierAliasInput = z.infer<typeof createSupplierAliasSchema>;

export type SupplierAlias = { id: string; supplier_id: string; supplier_name: string; alias: string; created_at: string };

export const PENDING_REFERENCE_PAGE_SIZES = [25, 50, 100] as const;

const referenceFilterShape = {
  supplier_id: id.optional(),
  import_batch_id: id.optional(),
  /** Part of a supplier code. */
  q: z.string().trim().max(100).optional(),
};

/** GET /api/catalogue/supplier-references: the references imported and not yet checked. */
export const pendingReferencesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().refine((size) => (PENDING_REFERENCE_PAGE_SIZES as readonly number[]).includes(size)).default(50),
  ...referenceFilterShape,
});
export type PendingReferencesQuery = z.infer<typeof pendingReferencesQuerySchema>;

const pendingSupplierReferenceSchema = z.object({
  id,
  product_id: id,
  product_reference: z.string().nullable(),
  product_designation: z.string(),
  supplier_id: id,
  supplier_name: z.string(),
  supplier_sku: z.string().nullable(),
  product_url: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  import_batch_id: id.nullable(),
  can_review: z.boolean().describe("L’appelant peut vérifier cette référence."),
});
export type PendingSupplierReference = z.infer<typeof pendingSupplierReferenceSchema>;

const referenceSelectionSignatureSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const REFERENCE_QUEUE_CHANGED = "La liste des références à vérifier a changé. Actualisez-la avant de confirmer à nouveau.";

export const pendingSupplierReferencePageSchema = z.object({
  items: z.array(pendingSupplierReferenceSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    size: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
  selection_signature: referenceSelectionSignatureSchema.nullable().describe(
    "Empreinte des références de toutes les pages du filtre. Si elle est absente (null), actualisez la liste avant de valider l’ensemble.",
  ),
});
export type PendingSupplierReferencePage = z.infer<typeof pendingSupplierReferencePageSchema>;

/** References one request reviews: the database function's own limit. */
export const REVIEW_REFERENCES_MAX = 5000;

/**
 * POST /api/catalogue/supplier-references: checks references together. `validate` makes them usable for
 * purchasing as they are; `withdraw` discards them. Either the references named, or every pending reference the
 * filter matches (the whole queue with an empty filter).
 */
const referenceReviewAction = z.enum(["validate", "withdraw"]);
export const reviewReferencesSchema = z.union([
  z.object({ action: referenceReviewAction, ids: z.array(id).min(1).max(REVIEW_REFERENCES_MAX) }).strict(),
  z.object({
    action: referenceReviewAction,
    filter: z.object(referenceFilterShape).strict(),
    expected_count: z.number().int().nonnegative(),
    // A previously opened page may still send only the count. The server refuses that request with 409.
    expected_selection: referenceSelectionSignatureSchema.optional().describe("Empreinte renvoyée par la liste. Obligatoire pour valider ; son absence entraîne un conflit (409)."),
  }).strict(),
]);
export type ReviewReferencesInput = z.infer<typeof reviewReferencesSchema>;
export type ReviewReferencesResult = { reviewed: number; skipped: number };

export const BULK_PRODUCTS_MAX = 5000;

/**
 * POST /api/products/bulk. `validate`: the complete drafts among the articles named, or among those of an
 * import; an incomplete draft stays a draft and is counted. `assign-supply-type`: one supply type for the
 * articles named that the member may edit.
 */
const bulkProductIds = z.array(id).min(1).max(BULK_PRODUCTS_MAX);
export const bulkProductsSchema = z.union([
  z.object({ action: z.literal("validate"), ids: bulkProductIds }).strict(),
  z.object({ action: z.literal("validate"), import_batch_id: id }).strict(),
  z.object({ action: z.literal("assign-supply-type"), ids: bulkProductIds, supply_type_id: id }).strict(),
]);
export type BulkProductsInput = z.infer<typeof bulkProductsSchema>;
export type BulkValidateResult = { action: "validate"; validated: number; incomplete: number; skipped: number };
export type BulkAssignResult = { action: "assign-supply-type"; updated: number };
export type BulkProductsResult = BulkValidateResult | BulkAssignResult;

export type CatalogueImportBatchKind = "workbook_articles" | "workbook_supplier_references";

/** An import of the costing workbook, with what is left to do on it. */
export type CatalogueImportBatch = {
  id: string;
  kind: CatalogueImportBatchKind;
  source_name: string | null;
  created_at: string;
  undo_started_at: string | null;
  undone_at: string | null;
  /** Articles or references the import created that still exist. */
  total: number;
  /** Among them: drafts not yet validated, references not yet checked. */
  open: number;
  /** The member may undo it: an administrator, or its author. */
  can_undo: boolean;
};

export type UndoImportResult = { deleted: number; kept: number };

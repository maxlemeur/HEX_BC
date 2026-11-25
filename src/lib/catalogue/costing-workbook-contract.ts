import { z } from "zod";

import { COSTING_WORKBOOK_SUPPLY_KINDS, type CostingWorkbookIssue } from "./costing-workbook";

/**
 * Contract of POST /api/catalogue/workbook-import (TI-690, lot 1), shared by the catalogue screen and the route.
 * The browser reads the sheet « All_data » of the office's costing workbook with SheetJS
 * (`sheet_to_json(ws, { header: 1, raw: true, defval: null })`) and sends its rows as they are; the server reads
 * them again (costing-workbook.ts) and answers a report. `confirm: false` is the preview: nothing is written.
 */

/** The workbook lists about 2,600 articles: a sheet longer than this is not the costing workbook. */
export const COSTING_WORKBOOK_MAX_ROWS = 6000;

/**
 * Largest request body the route reads: below the 4.5 MB a Vercel function accepts (the proxy buffers up to
 * 10 MB). The real sheet is about 1.5 MB of JSON. A larger body answers 413 before anything is read.
 */
export const COSTING_WORKBOOK_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Issues the report lists, in sheet order; `issue_count` counts them all. */
export const COSTING_WORKBOOK_REPORTED_ISSUES = 100;

/** 422: the sheet is not the costing workbook's; the message is the reader's sentence. */
export const COSTING_WORKBOOK_FORMAT = "COSTING_WORKBOOK_FORMAT";

/**
 * A confirmed import that stopped on a refused chunk of drafts after earlier chunks were created. The message
 * says how many; the error's `details` is a `CostingWorkbookImportIncompleteDetails`. Running the same workbook
 * again creates the rest: it skips the articles already in the catalogue.
 */
export const COSTING_WORKBOOK_IMPORT_INCOMPLETE = "COSTING_WORKBOOK_IMPORT_INCOMPLETE";

const cellSchema = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

export const costingWorkbookImportSchema = z.object({
  rows: z.array(z.array(cellSchema).max(60)).min(1).max(COSTING_WORKBOOK_MAX_ROWS),
  /** false: preview, nothing written. */
  confirm: z.boolean(),
  /** The file's name, kept with the import so that the office recognises it later. */
  source_name: z.string().max(255).optional(),
}).strict();

export type CostingWorkbookImportInput = z.infer<typeof costingWorkbookImportSchema>;

/** 422: a supply type chosen in the screen is not one of the company's. */
export const COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN = "COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN";

/**
 * The draft import (POST /api/catalogue/workbook-import). `supply_types` gives, for a code the reader proposes
 * (« tube », « calorifuge »…), the company's supply type the office chose in the screen: it replaces the type with
 * that code, or stands in when the company has none. `supply_type_rows` gives it for the articles of given sheet
 * rows. The workbook's family (supply_type_families) overrides the inferred kind, and a row's own choice
 * comes first.
 */
export const costingWorkbookArticlesSchema = costingWorkbookImportSchema.extend({
  supply_types: z.partialRecord(z.enum(COSTING_WORKBOOK_SUPPLY_KINDS), z.uuid()).optional(),
  supply_type_families: z.array(z.object({ family_code: z.string().min(1).max(4000), supply_type_id: z.uuid() }).strict())
    .max(COSTING_WORKBOOK_MAX_ROWS).optional(),
  supply_type_rows: z.array(z.object({ row: z.number().int().positive(), supply_type_id: z.uuid() }).strict())
    .max(COSTING_WORKBOOK_MAX_ROWS).optional(),
});

export type CostingWorkbookArticlesInput = z.infer<typeof costingWorkbookArticlesSchema>;

export type CostingWorkbookImportReport = {
  confirmed: boolean;
  /** Articles read from the sheet. */
  articles: number;
  /** Drafts to create (preview) or created (confirmed). */
  new_articles: number;
  /** Workbook rows of the proposed drafts, available in the preview. */
  proposed_articles?: Array<{ row: number; without_supply_type: boolean }>;
  /** The company's supply types, for the screen to offer one where a proposed code has none (preview only). */
  supply_types?: Array<{ id: string; code: string; name: string }>;
  /**
   * Articles the catalogue already holds whose reference price or unit is not the workbook's (preview only).
   * The import never changes them: the screen lists the gaps and opens the article, where a price is validated.
   */
  catalogue_differences?: Array<{
    row: number;
    product_id: string;
    unit_price_cents: number;
    unit: string | null;
    is_active: boolean;
  }>;
  /** Articles whose reference the catalogue already holds: skipped, unchanged. */
  already_in_catalogue: number;
  /** Among new_articles: the company has no supply type with the code the workbook proposes. */
  without_supply_type: number;
  /**
   * Supplier references the workbook gives for the new articles, counted by the draft import.
   */
  supplier_references_not_imported: number;
  /** The first COSTING_WORKBOOK_REPORTED_ISSUES issues of the reading, in sheet order. */
  issues: CostingWorkbookIssue[];
  issue_count: number;
  /** Section title rows (« Rub ») of the sheet. */
  sections: number;
  /** The import the created drafts belong to (confirmed, with at least one draft): what an undo removes. */
  import_batch_id?: string | null;
};

/** `details` of a COSTING_WORKBOOK_IMPORT_INCOMPLETE error: the report of what was written before the stop. */
export type CostingWorkbookImportIncompleteDetails = { report: CostingWorkbookImportReport };


export const costingWorkbookSupplierReferencesSchema = costingWorkbookImportSchema.extend({
  preview_token: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine((input) => !input.confirm || Boolean(input.preview_token), {
  path: ["preview_token"],
  message: "Vérifiez l’aperçu avant de confirmer.",
});

export type CostingWorkbookSupplierReferencesInput = z.infer<typeof costingWorkbookSupplierReferencesSchema>;

export const costingWorkbookSupplierReferenceDecision = z.enum([
  "invalid_article_reference",
  // The article is one the draft import would create: its references wait for that import.
  "article_to_create",
  "article_not_found",
  "ambiguous_article",
  "invalid_supplier_name",
  "supplier_not_found",
  "ambiguous_supplier",
  "invalid_supplier_sku",
  "price_source_reference",
  "article_locked",
  "different_existing_reference",
  "withdrawn_reference",
  "conflicting_workbook_references",
]);

export const costingWorkbookSupplierReferenceReportSchema = z.object({
  confirmed: z.boolean(),
  to_import: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  already_registered: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  preview_token: z.string().nullable(),
  /** The import the references belong to (confirmed, with at least one reference). */
  import_batch_id: z.string().nullable().optional(),
  /** The references to import (preview) or just imported (confirmed), one source cell each. */
  proposed: z.array(z.object({
    row: z.number().int().positive(),
    slot: z.number().int().min(1).max(3),
    article_reference: z.string(),
    supplier_name: z.string(),
    product_id: z.string().optional(),
    /** Several different non-empty product URLs were given for this reference. */
    product_url_omitted: z.boolean().optional(),
  })).optional(),
  for_decision: z.array(z.object({
    row: z.number().int().positive(),
    slot: z.number().int().min(1).max(3),
    // The preview resolves these coordinates against the workbook it already holds.
    reason: costingWorkbookSupplierReferenceDecision,
    /** The catalogue article and supplier the cell was matched to, when it was. */
    product_id: z.string().optional(),
    supplier_id: z.string().optional(),
    /** `supplier_not_found` when the name is associated with an archived supplier. */
    archived_supplier_alias: z.object({ id: z.string(), supplier_name: z.string(), can_remove: z.boolean() }).optional(),
    /** `different_existing_reference`: the code the catalogue holds for this article at this supplier. */
    existing_supplier_sku: z.string().nullable().optional(),
    /** `ambiguous_article`, `ambiguous_supplier`: the catalogue records that share the identifier or the name. */
    candidates: z.array(z.object({ id: z.string(), label: z.string() })).max(20).optional(),
  })),
});

export type CostingWorkbookSupplierReferenceReport = z.infer<typeof costingWorkbookSupplierReferenceReportSchema>;

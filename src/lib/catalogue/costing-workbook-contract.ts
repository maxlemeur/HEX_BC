import { z } from "zod";

import type { CostingWorkbookIssue } from "./costing-workbook";

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
}).strict();

export type CostingWorkbookImportInput = z.infer<typeof costingWorkbookImportSchema>;

export type CostingWorkbookImportReport = {
  confirmed: boolean;
  /** Articles read from the sheet. */
  articles: number;
  /** Drafts to create (preview) or created (confirmed). */
  new_articles: number;
  /** Articles whose reference the catalogue already holds: skipped, unchanged. */
  already_in_catalogue: number;
  /** Among new_articles: the company has no supply type with the code the workbook proposes. */
  without_supply_type: number;
  /**
   * Supplier references the workbook gives for the new articles: not imported. They come with purchasing
   * (lot 2), together with dated prices.
   */
  supplier_references_not_imported: number;
  /** The first COSTING_WORKBOOK_REPORTED_ISSUES issues of the reading, in sheet order. */
  issues: CostingWorkbookIssue[];
  issue_count: number;
  /** Section title rows (« Rub ») of the sheet. */
  sections: number;
};

/** `details` of a COSTING_WORKBOOK_IMPORT_INCOMPLETE error: the report of what was written before the stop. */
export type CostingWorkbookImportIncompleteDetails = { report: CostingWorkbookImportReport };

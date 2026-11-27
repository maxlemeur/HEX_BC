import { z } from "zod";

export const SUPPLIER_BASE_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const SUPPLIER_BASE_FILE_TOO_LARGE = "Choisissez un classeur Excel de 4 Mo au plus.";

export const supplierBaseUploadSchema = z.object({
  file: z.file().min(1).max(SUPPLIER_BASE_MAX_FILE_BYTES),
});

const rowIssueSchema = z.enum([
  "missing_supplier", "missing_designation", "missing_reference", "duplicate_reference",
  "invalid_price", "missing_price_date", "invalid_price_date", "unknown_price_unit",
  "invalid_packaging_quantity",
]);

const sourcePositionSchema = z.object({ sheet: z.string(), row: z.number().int().positive() });
const priceDateSchema = z.iso.date();
const workbookRowSchema = sourcePositionSchema.extend({
  supplier_name: z.string().nullable(),
  designation: z.string().nullable(),
  supplier_reference: z.string().nullable(),
  unit_price_cents: z.number().int().nonnegative().max(2147483647).nullable(),
  price_unit: z.string().nullable(),
  price_unit_code: z.string().nullable(),
  packaging_label: z.string().nullable(),
  packaging_quantity: z.number().positive().nullable(),
  price_date: priceDateSchema.nullable(),
  document: z.object({ text: z.string(), kind: z.string().nullable(), number: z.string().nullable() }).nullable(),
  observations: z.string().nullable(),
  source_file_text: z.string().nullable(),
  fragile: z.boolean(),
  fragile_reasons: z.array(z.enum(["old_version_missing_document", "ocr_scan", "price_per_100"])),
  issues: z.array(rowIssueSchema),
});

const articleSchema = z.object({
  id: z.string().uuid(),
  designation: z.string(),
  reference: z.string().nullable(),
});
const proposalDetails = {
  designation: z.string(),
  gaps: z.array(z.string()),
};
const proposalSchema = z.discriminatedUnion("source", [
  articleSchema.extend({ ...proposalDetails, source: z.literal("catalogue") }),
  sourcePositionSchema.extend({ ...proposalDetails, source: z.literal("workbook"), supplier_name: z.string() }),
]);
const plannedRowSchema = z.object({
  row: workbookRowSchema,
  known_reference: z.object({
    id: z.string().uuid(),
    article: articleSchema,
    state: z.enum(["active", "pending_review", "archived"]),
    latest_price_date: priceDateSchema.nullable(),
  }).nullable(),
  price_action: z.enum(["none", "add", "skip", "review"]),
  proposals: z.array(proposalSchema),
  gaps: z.array(z.string()),
});

const supplierSchema = z.object({
  key: z.string(),
  workbook_names: z.array(z.string()),
  supplier_id: z.string().uuid().nullable(),
  supplier_label: z.string().nullable(),
  resolution: z.enum(["recognized", "unknown", "ambiguous", "inactive_alias", "missing_name"]),
  candidates: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
});
export const supplierBasePreviewSchema = z.object({
  row_count: z.number().int().nonnegative(),
  skipped_sheets: z.array(z.string()),
  suppliers: z.array(supplierSchema.extend({
    known: z.array(plannedRowSchema),
    proposed: z.array(plannedRowSchema),
    new: z.array(plannedRowSchema),
  })),
});

export type SupplierBaseRow = z.infer<typeof workbookRowSchema>;
export type SupplierBasePreview = z.infer<typeof supplierBasePreviewSchema>;
export type SupplierBaseGroup = SupplierBasePreview["suppliers"][number];
export type SupplierBasePlannedRow = z.infer<typeof plannedRowSchema>;
export type SupplierBaseProposal = z.infer<typeof proposalSchema>;

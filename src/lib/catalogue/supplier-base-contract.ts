import { z } from "zod";

export const SUPPLIER_BASE_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const SUPPLIER_BASE_MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
export const SUPPLIER_BASE_FILE_TOO_LARGE = "Choisissez un classeur Excel de 4 Mo au plus.";

export const supplierBaseUploadSchema = z.object({
  file: z.file().min(1).max(SUPPLIER_BASE_MAX_FILE_BYTES),
});

const rowIssueSchema = z.enum([
  "missing_supplier", "missing_designation", "missing_reference", "duplicate_reference",
  "supplier_differs_from_sheet", "invalid_price", "text_price", "zero_price", "inexact_price",
  "price_cents_overflow", "missing_price_date", "invalid_price_date", "future_price_date",
  "inactive_price_same_date", "different_price_same_date", "unknown_price_unit", "invalid_packaging_quantity",
  "invalid_packaging_price", "packaging_price_mismatch",
]);

const sourcePositionSchema = z.object({ sheet: z.string(), row: z.number().int().positive() });
const priceDateSchema = z.iso.date();
const centsSchema = z.number().int().nonnegative().max(2147483647);
const workbookRowSchema = sourcePositionSchema.extend({
  supplier_name: z.string().nullable(),
  designation: z.string().nullable(),
  supplier_reference: z.string().nullable(),
  price: z.object({
    unit_decimal: z.string().describe("Montant décimal exact pour une unité, en euros HT."),
    per: z.union([z.literal(1), z.literal(100)]),
    amount_cents: centsSchema.nullable().describe("Montant pour le nombre d’unités indiqué par per, lorsqu’il est exact en centimes."),
    origin: z.enum(["unit", "converted", "supplier"]).describe("Prix unitaire, conversion proposée pour 100, ou base 100 indiquée par le fournisseur."),
  }).nullable(),
  price_text: z.string().optional().describe("Texte de la cellule de prix à vérifier."),
  price_unit: z.string().nullable(),
  price_unit_code: z.string().nullable(),
  packaging_label: z.string().nullable(),
  packaging_quantity: z.number().positive().nullable(),
  price_date: priceDateSchema.nullable(),
  document: z.union([z.object({ kind: z.string(), number: z.string() }), z.object({ text: z.string() })]).nullable(),
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
const gapSchema = z.enum([
  "dimension_unknown", "material_unknown", "unit_unknown", "unit_mismatch", "type_unknown", "precision_check",
  "draft_article", "missing_article", "pending_reference", "archived_article_or_reference",
  "article_not_editable", "ambiguous_reference", "supplier_reference_exists", "supplier_reference_inactive",
  "packaging_differs", "same_supplier_same_article",
]);
const proposalSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("catalogue"), article_id: articleSchema.shape.id, gaps: z.array(gapSchema) }),
  sourcePositionSchema.extend({ source: z.literal("workbook"), gaps: z.array(gapSchema) }),
]);
const plannedRowSchema = z.object({
  row: workbookRowSchema,
  known_reference: z.object({
    id: z.string().uuid(),
    article_id: articleSchema.shape.id,
    state: z.enum(["active", "pending_review", "archived"]),
    latest_price_date: priceDateSchema.nullable(),
  }).nullable(),
  different_catalogue_price: z.object({
    amount_cents: centsSchema,
    unit: z.string(),
  }).optional().describe("Prix catalogue EUR à la date de la ligne et différent du prix importé, dans son unité d’achat."),
  price_action: z.enum(["none", "add", "skip", "review", "per_lot"]),
  proposals: z.array(proposalSchema),
  gaps: z.array(gapSchema),
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
  skipped_sheets: z.array(z.object({
    name: z.string(), reason: z.enum(["index", "summary", "rental", "hidden"]),
  })),
  sheet_warnings: z.array(z.object({ sheet: z.string(), missing_optional_columns: z.array(z.string()) })),
  articles: z.array(articleSchema).describe("Articles visés par les références connues et les propositions, listés une seule fois."),
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
export type SupplierBaseGap = z.infer<typeof gapSchema>;
export type SupplierBaseWorkbook = Pick<SupplierBasePreview, "skipped_sheets" | "sheet_warnings"> & {
  rows: SupplierBaseRow[];
  grouped_sheets: string[];
  today: string;
};

import { z } from "zod";

import { MATERIAL_REQUEST_MAX_LINES, materialRequestLineInputSchema } from "./contracts";
import { WORKBOOK_COLUMN_LETTER, WORKBOOK_ROLES, type WorkbookMapping, type WorkbookRole } from "./workbook-mapping";

const columnLetter = z.string().regex(WORKBOOK_COLUMN_LETTER, "Colonne Excel invalide (A à ZZZ).");

/** Role to column letter; null when no column serves the role. */
const mappingSchema = z.object(
  Object.fromEntries(WORKBOOK_ROLES.map((role) => [role, columnLetter.nullable()])) as Record<WorkbookRole, z.ZodNullable<typeof columnLetter>>,
);

export const MATERIAL_REQUEST_WORKBOOK_REMARK_CODES = [
  "rounded", "no_quantity", "quantity_too_large", "reference_dropped", "written_doubt", "already_present",
] as const;

/** `inactive_alias`: the spelling is associated with a deactivated supplier; only the catalogue can change that. */
export const MATERIAL_REQUEST_WORKBOOK_SUPPLIER_STATUSES = ["recognized", "unknown", "ambiguous", "inactive_alias"] as const;

/** Rows of the sheet shown to choose a header row by hand: every row that holds something within the scan. */
export const MATERIAL_REQUEST_WORKBOOK_FIRST_ROWS = 50;
/** Cells shown per row offered as header: enough to recognize it, bounded for wide sheets. */
export const MATERIAL_REQUEST_WORKBOOK_FIRST_ROW_CELLS = 12;
/** The header row is searched, and may be chosen, within these first rows of a sheet. */
export const MATERIAL_REQUEST_WORKBOOK_HEADER_SCAN_ROWS = 50;

export const materialRequestWorkbookPreviewSchema = z.object({
  sheet_name: z.string(),
  /** Every visible sheet that holds a cell. */
  sheet_names: z.array(z.string()),
  /** Excel number of the header row: recognized, or chosen with `header_row`; null when neither. */
  header_row: z.number().int().positive().nullable(),
  /** Whether the header row was recognized automatically (false when chosen by hand or absent). */
  header_detected: z.boolean(),
  /** The first rows of the sheet that hold something, to choose the header row by hand. */
  first_rows: z.array(z.object({
    row_number: z.number().int().positive(),
    cells: z.array(z.object({ column: columnLetter, text: z.string() })).max(MATERIAL_REQUEST_WORKBOOK_FIRST_ROW_CELLS),
  })).max(MATERIAL_REQUEST_WORKBOOK_FIRST_ROWS),
  /**
   * The columns under the header row: those with a header cell and those holding values without one (`header` is
   * then empty), with up to three example values read from the first data rows. Empty without a header row.
   */
  columns: z.array(z.object({ column: columnLetter, header: z.string(), examples: z.array(z.string()).max(3) })),
  /** What automatic recognition assigns to each role. */
  detected_columns: mappingSchema,
  /** What this preview read: the explicit mapping when one was sent, else the recognized one. */
  mapped_columns: mappingSchema,
  rows: z.array(z.object({
    row_number: z.number().int().positive(),
    line: materialRequestLineInputSchema,
    /** The supplier name written in the row, as written; null without a supplier column or cell. */
    supplier_name: z.string().nullable(),
    /** Whether the row is ticked when the preview opens. */
    selected: z.boolean(),
    remarks: z.array(z.object({ code: z.enum(MATERIAL_REQUEST_WORKBOOK_REMARK_CODES), message: z.string() })),
  })).max(MATERIAL_REQUEST_MAX_LINES),
  /** Rows left out of the import, with why. */
  issues: z.array(z.object({ row_number: z.number().int().positive(), message: z.string() })),
  omitted_rows: z.number().int().nonnegative(),
  /** Each distinct supplier name of the mapped column, resolved to a supplier of the company when one is certain. */
  suppliers: z.array(z.object({
    name: z.string(),
    status: z.enum(MATERIAL_REQUEST_WORKBOOK_SUPPLIER_STATUSES),
    supplier_id: z.string().uuid().nullable(),
    /** Suppliers of the same name, for an ambiguous one. */
    candidates: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
    row_count: z.number().int().positive(),
    /** What the user should know about this name, for example why it cannot be linked or created here. */
    remark: z.string().nullable(),
  })),
  /** What the caller may do with an unknown name; `reason` says why a choice is absent. */
  supplier_rights: z.object({ can_link: z.boolean(), can_create: z.boolean(), reason: z.string().nullable() }),
});

export type MaterialRequestWorkbookPreview = z.output<typeof materialRequestWorkbookPreviewSchema>;
export type MaterialRequestWorkbookRow = MaterialRequestWorkbookPreview["rows"][number];
export type MaterialRequestWorkbookSupplier = MaterialRequestWorkbookPreview["suppliers"][number];
export type MaterialRequestWorkbookColumns = MaterialRequestWorkbookPreview["mapped_columns"];

/** The `header_row` query parameter: the Excel number of the header row, within the first rows a sheet is searched in. */
export const materialRequestWorkbookHeaderRowParamSchema = z.coerce.number({ error: "Numéro de ligne d’en-tête invalide." })
  .int("Numéro de ligne d’en-tête invalide.")
  .min(1, "Numéro de ligne d’en-tête invalide.")
  .max(MATERIAL_REQUEST_WORKBOOK_HEADER_SCAN_ROWS, `La ligne d’en-tête se choisit parmi les ${MATERIAL_REQUEST_WORKBOOK_HEADER_SCAN_ROWS} premières lignes.`);

const ROLE_PAIR = new RegExp(`^(${WORKBOOK_ROLES.join("|")}):([A-Z]{1,3})$`);

/**
 * The `columns` query parameter: `designation:B,quantity:E,supplier:K`. A role left out is not read; the
 * designation is required and a column serves one role at most.
 */
export const materialRequestWorkbookColumnsParamSchema = z.string().max(400, "Le paramètre columns dépasse 400 caractères.").transform((value, context): WorkbookMapping => {
  const mapping: WorkbookMapping = {};
  const used = new Set<string>();
  for (const part of value.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const match = ROLE_PAIR.exec(part);
    const role = match?.[1] as WorkbookRole | undefined;
    const letter = match?.[2];
    if (!role || !letter) {
      context.addIssue({ code: "custom", message: `« ${part.slice(0, 40)} » n’est pas un rôle suivi d’une colonne, par exemple designation:B.` });
      return z.NEVER;
    }
    if (mapping[role] || used.has(letter)) {
      context.addIssue({ code: "custom", message: "Chaque rôle et chaque colonne ne servent qu’une fois." });
      return z.NEVER;
    }
    mapping[role] = letter;
    used.add(letter);
  }
  if (!mapping.designation) {
    context.addIssue({ code: "custom", message: "Choisissez la colonne de la désignation." });
    return z.NEVER;
  }
  return mapping;
});

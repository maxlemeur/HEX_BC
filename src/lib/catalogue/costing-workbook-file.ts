import { COSTING_WORKBOOK_SHEET } from "@/lib/catalogue/costing-workbook";
import {
  COSTING_WORKBOOK_MAX_BODY_BYTES,
  COSTING_WORKBOOK_MAX_ROWS,
  type CostingWorkbookImportInput,
} from "@/lib/catalogue/costing-workbook-contract";

/**
 * Reads the sheet « All_data » of the office's costing workbook in the browser (TI-690, lot 1), into the rows
 * POST /api/catalogue/workbook-import expects: SheetJS `sheet_to_json(ws, { header: 1, raw: true, defval:
 * null })`, within the contract's limits. SheetJS is loaded only when a file is chosen.
 *
 * The rows are counted from A1, blank rows included, so that a row's index plus one is the row the spreadsheet
 * shows: the reader's issues name it. Only the cells that hold a value set the extent read, never the sheet's
 * dimension, which Excel stretches over formatted empty cells.
 *
 * An error cell (#N/A, #REF!) or a formula saved without its value is sent as text, its displayed error or
 * « #ERREUR »: SheetJS would give an empty cell, and a price « #N/A » would become a silent 0 € draft. As text,
 * the reader reports it (« Prix « #N/A » illisible… »).
 */

export type CostingWorkbookRows = CostingWorkbookImportInput["rows"];
type CostingWorkbookCell = CostingWorkbookRows[number][number];

/** Cells per row and characters per text the contract's cell schema accepts. */
export const COSTING_WORKBOOK_MAX_CELLS = 60;
export const COSTING_WORKBOOK_MAX_TEXT = 4000;

/** A refusal of the file in the browser, before any request: its message is the sentence shown. */
export class CostingWorkbookFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostingWorkbookFileError";
  }
}

type XlsxCell = { t?: string; v?: unknown; w?: unknown; f?: unknown; F?: unknown };

/** What an error cell, or a formula without its cached value, says in the spreadsheet. */
const UNREADABLE_CELL = "#ERREUR";

const formatCount = (value: number) => value.toLocaleString("fr-FR");
const formatMegabytes = (bytes: number) =>
  (bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** The text sent for an error cell or a formula without its value; null for any other cell. */
function errorText(cell: XlsxCell | undefined): string | null {
  if (!cell) return null;
  const uncachedFormula = cell.t === "z" && (typeof cell.f === "string" || typeof cell.F === "string");
  if (cell.t !== "e" && !uncachedFormula) return null;
  const shown = cell.t === "e" && typeof cell.w === "string" ? cell.w.trim() : "";
  return (shown || UNREADABLE_CELL).slice(0, COSTING_WORKBOOK_MAX_TEXT);
}

function holdsValue(cell: XlsxCell | undefined): boolean {
  if (!cell || cell.t === "e" || cell.t === "z") return false;
  const value = cell.v;
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || value.trim() !== "";
}

function contractCell(value: unknown): CostingWorkbookCell {
  if (typeof value === "string") return value.slice(0, COSTING_WORKBOOK_MAX_TEXT);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return null;
}

function contractRow(values: readonly unknown[]): CostingWorkbookCell[] {
  // Array.from, not map: a cell SheetJS skips leaves a hole, which must become null.
  const row = Array.from(values.slice(0, COSTING_WORKBOOK_MAX_CELLS), contractCell);
  let length = row.length;
  while (length > 0 && row[length - 1] === null) length -= 1;
  row.length = length;
  return row;
}

/** The sheet by its name; a sheet renamed with other capitals (« ALL_DATA ») is the same sheet for Excel. */
function sheetName(names: readonly string[]): string | null {
  if (names.includes(COSTING_WORKBOOK_SHEET)) return COSTING_WORKBOOK_SHEET;
  const wanted = COSTING_WORKBOOK_SHEET.toLocaleLowerCase("fr-FR");
  return names.find((name) => name.trim().toLocaleLowerCase("fr-FR") === wanted) ?? null;
}

export async function readCostingWorkbookFile(input: ArrayBuffer): Promise<CostingWorkbookRows> {
  const xlsx = await import("xlsx");
  const bytes = new Uint8Array(input);
  let name: string | null;
  let sheet: import("xlsx").WorkSheet | undefined;
  try {
    // The workbook holds other heavy sheets: list the names first, then parse « All_data » alone.
    name = sheetName(xlsx.read(bytes, { type: "array", bookSheets: true }).SheetNames);
    // Stubs keep the formulas saved without their value, which SheetJS drops otherwise.
    sheet = name ? xlsx.read(bytes, { type: "array", sheets: name, sheetStubs: true }).Sheets[name] : undefined;
  } catch {
    throw new CostingWorkbookFileError("Ce fichier n’a pas pu être lu comme un classeur Excel.");
  }
  if (!name || !sheet) {
    throw new CostingWorkbookFileError(
      `Ce classeur n’a pas d’onglet « ${COSTING_WORKBOOK_SHEET} ». Choisissez le classeur de chiffrage.`,
    );
  }

  let lastRow = -1;
  let lastColumn = -1;
  const errors: Array<{ r: number; c: number; text: string }> = [];
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address] as XlsxCell;
    const error = errorText(cell);
    if (error === null && !holdsValue(cell)) continue;
    const { r, c } = xlsx.utils.decode_cell(address);
    if (c >= COSTING_WORKBOOK_MAX_CELLS) continue;
    if (error !== null) errors.push({ r, c, text: error });
    lastRow = Math.max(lastRow, r);
    lastColumn = Math.max(lastColumn, c);
  }
  if (lastRow < 0) {
    throw new CostingWorkbookFileError(`L’onglet « ${COSTING_WORKBOOK_SHEET} » de ce classeur est vide.`);
  }
  if (lastRow + 1 > COSTING_WORKBOOK_MAX_ROWS) {
    throw new CostingWorkbookFileError(
      `L’onglet « ${COSTING_WORKBOOK_SHEET} » compte ${formatCount(lastRow + 1)} lignes : l’import en accepte ${formatCount(COSTING_WORKBOOK_MAX_ROWS)} au plus.`,
    );
  }

  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    range: { s: { r: 0, c: 0 }, e: { r: lastRow, c: lastColumn } },
  });
  const contractRows = rows.map(contractRow);
  for (const { r, c, text } of errors) {
    const values = contractRows[r];
    while (values.length < c) values.push(null);
    values[c] = text;
  }
  return contractRows;
}

/** The JSON body of a preview (`confirm: false`) or of the import, refused before any request when too heavy. */
export function costingWorkbookImportBody(rows: CostingWorkbookRows, confirm: boolean): string {
  const body = JSON.stringify({ rows, confirm } satisfies CostingWorkbookImportInput);
  const size = new TextEncoder().encode(body).length;
  if (size > COSTING_WORKBOOK_MAX_BODY_BYTES) {
    throw new CostingWorkbookFileError(
      `L’onglet « ${COSTING_WORKBOOK_SHEET} » est trop lourd pour être envoyé (${formatMegabytes(size)} Mo, ${formatMegabytes(COSTING_WORKBOOK_MAX_BODY_BYTES)} Mo au plus).`,
    );
  }
  return body;
}

import {
  workbookSupplierNameKey,
  type CostingWorkbookSupplierOccurrence,
} from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookImportInput } from "@/lib/catalogue/costing-workbook-contract";

/**
 * Corrections the office makes in the import screen (TI-711). The browser holds the sheet's rows, and the server
 * reads the rows it is sent: a correction is a new value for one cell of those rows, applied before each preview
 * and each import. The Excel file is never written; the journal of corrections says what to copy back into it.
 */

type Rows = CostingWorkbookImportInput["rows"];
type CellValue = Rows[number][number];

/** `row` is the row the spreadsheet shows (counted from 1), `column` its zero-based column. Null empties the cell. */
export type WorkbookEdit = { row: number; column: number; value: string | null };

/** Limits of the contract's rows: an edit outside them is never applied. */
const MAX_ROWS = 6000;
const MAX_COLUMNS = 60;
const MAX_TEXT = 4000;

export function workbookEditKey(row: number, column: number) {
  return `${row}:${column}`;
}

/** « B4 » for row 4, column 1. */
export function workbookCellAddress(row: number, column: number) {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  }
  return letters + row;
}

/** Reads « B4 », « $B$4 » or « b4 »; null for anything else or a cell outside the sheet the import reads. */
export function parseWorkbookCellAddress(address: string): { row: number; column: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(address.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  const row = Number(match[2]);
  return row <= MAX_ROWS && column <= MAX_COLUMNS ? { row, column: column - 1 } : null;
}

export function workbookCellValue(rows: Rows, row: number, column: number): CellValue {
  return rows[row - 1]?.[column] ?? null;
}

/** What a cell shows: the text of its value, empty for an empty cell. */
export function workbookCellText(rows: Rows, row: number, column: number): string {
  const value = workbookCellValue(rows, row, column);
  return value === null ? "" : String(value).trim();
}

function validEdit({ row, column }: WorkbookEdit) {
  return Number.isInteger(row) && Number.isInteger(column) && row >= 1 && row <= MAX_ROWS && column >= 0 && column < MAX_COLUMNS;
}

/**
 * The rows with the corrections applied. The sheet's rows are never changed: a corrected row is a copy. An edit
 * past the last row or the last cell extends the sheet with empty cells, as typing in Excel does.
 */
export function applyWorkbookEdits(rows: Rows, edits: readonly WorkbookEdit[]): Rows {
  if (edits.length === 0) return rows;
  const next = [...rows];
  const copied = new Set<number>();
  for (const edit of edits) {
    if (!validEdit(edit)) continue;
    const index = edit.row - 1;
    while (next.length <= index) next.push([]);
    if (!copied.has(index)) {
      next[index] = [...next[index]];
      copied.add(index);
    }
    const cells = next[index];
    while (cells.length < edit.column) cells.push(null);
    const value = edit.value === null ? null : edit.value.trim().slice(0, MAX_TEXT);
    cells[edit.column] = value === "" ? null : value;
  }
  return next;
}

/**
 * The journal after new corrections: one entry per cell, the latest value. A correction that gives a cell back
 * the value the sheet holds leaves the journal.
 */
export function mergeWorkbookEdits(base: Rows, current: readonly WorkbookEdit[], added: readonly WorkbookEdit[]): WorkbookEdit[] {
  const byCell = new Map(current.map((edit) => [workbookEditKey(edit.row, edit.column), edit]));
  for (const edit of added) {
    if (!validEdit(edit)) continue;
    const value = edit.value === null ? null : edit.value.trim().slice(0, MAX_TEXT) || null;
    const key = workbookEditKey(edit.row, edit.column);
    if ((value ?? "") === workbookCellText(base, edit.row, edit.column)) byCell.delete(key);
    else byCell.set(key, { row: edit.row, column: edit.column, value });
  }
  return [...byCell.values()].sort((left, right) => left.row - right.row || left.column - right.column);
}

/** Every cell that names a supplier under this name (case, accents and spaces aside) gets the new name. */
export function supplierNameEdits(
  occurrences: readonly CostingWorkbookSupplierOccurrence[],
  supplierName: string,
  replacement: string,
): WorkbookEdit[] {
  const key = workbookSupplierNameKey(supplierName);
  const edits = new Map<string, WorkbookEdit>();
  for (const occurrence of occurrences) {
    const column = occurrence.supplier_name_column;
    if (column === undefined || workbookSupplierNameKey(occurrence.supplier_name) !== key) continue;
    edits.set(workbookEditKey(occurrence.row, column), { row: occurrence.row, column, value: replacement });
  }
  return [...edits.values()];
}

/** Every cell of these occurrences that holds another code than the one kept gets it. */
export function supplierCodeEdits(
  occurrences: readonly Pick<CostingWorkbookSupplierOccurrence, "row" | "column" | "supplier_sku">[],
  kept: string,
): WorkbookEdit[] {
  return occurrences
    .filter((occurrence) => occurrence.supplier_sku !== kept)
    .map((occurrence) => ({ row: occurrence.row, column: occurrence.column, value: kept }));
}

/** The journal as the office reads and exports it: where, what the sheet holds, what the import reads instead. */
export type WorkbookEditEntry = { address: string; row: number; column: number; header: string; before: string; after: string };

export function workbookEditEntries(base: Rows, edits: readonly WorkbookEdit[], headerRow: number | null): WorkbookEditEntry[] {
  return edits.map((edit) => ({
    address: workbookCellAddress(edit.row, edit.column),
    row: edit.row,
    column: edit.column,
    header: headerRow === null || edit.row === headerRow ? "" : workbookCellText(base, headerRow, edit.column),
    before: workbookCellText(base, edit.row, edit.column),
    after: edit.value ?? "",
  }));
}

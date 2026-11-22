/**
 * A workbook row as the member finds it in Excel and as every screen names it: the worksheet's own row when the import
 * recorded where its table starts (dpgf_imports.sheet_first_row), then the row of the table read; the table's row alone
 * for an import made before.
 */
export function workbookRowLabel(tableRow: number, sheetRow: number | null | undefined) {
  return sheetRow ? `Ligne ${sheetRow} de la feuille (ligne du tableau ${tableRow})` : `Ligne du tableau ${tableRow}`;
}

/** The worksheet row of a table row, when the import recorded where its table starts. */
export function worksheetRow(tableRow: number, sheetFirstRow: number | null | undefined) {
  return sheetFirstRow ? sheetFirstRow + tableRow - 1 : null;
}

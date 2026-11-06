/** Keep untrusted text inert when a CSV is opened in a spreadsheet. */
export function neutralizeCsvFormulaCell(value: string): string {
  return /^[\p{Cc}\p{Cf}\s]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function serializeSpreadsheetCsv(
  rows: readonly (readonly (string | number)[])[],
  utils: Pick<typeof import("xlsx").utils, "aoa_to_sheet" | "sheet_to_csv">,
): string {
  const safeRows = rows.map((row) => row.map((cell) =>
    typeof cell === "string" ? neutralizeCsvFormulaCell(cell) : cell));
  // SheetJS quotes LF with its default row separator, but leaves a bare CR unquoted.
  const forceQuotes = safeRows.some((row) => row.some((cell) => typeof cell === "string" && cell.includes("\r")));
  return utils.sheet_to_csv(utils.aoa_to_sheet(safeRows), { FS: ";", forceQuotes });
}

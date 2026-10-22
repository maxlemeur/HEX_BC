/** Keep untrusted text inert when a CSV is opened in a spreadsheet. */
export function neutralizeCsvFormulaCell(value: string): string {
  return /^[\p{Cc}\p{Cf}\s]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function neutralizeCsvFormulaRows(
  rows: readonly (readonly (string | number)[])[],
): (string | number)[][] {
  return rows.map((row) => row.map((cell) =>
    typeof cell === "string" ? neutralizeCsvFormulaCell(cell) : cell));
}

/**
 * The sheet row (1-based, as Excel and ExcelJS number it) of a row of the matrix that
 * `XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true })` returns. That matrix starts at
 * the first row of the sheet's used range (`!ref`), not at row 1: a table below two empty rows has
 * its first matrix row on sheet row 3. Both upload parsers read a row's styles (bold, merged cells,
 * outline level) with ExcelJS at this row, so a style is never read from the row two lines above.
 *
 * The start row is read from `!ref` as SheetJS's `safe_decode_range`, which `sheet_to_json` uses,
 * reads it: column letters, then digits. A sheet without a readable range starts at row 1.
 *
 * Self-contained on purpose: the server upload parser injects this function's source into its
 * worker thread (`Function.prototype.toString`), as it does for `selectDpgfSheetIndex`. No import,
 * destructuring or helper-compiled syntax.
 */
export function resolveSheetRowNumber(sheet: Record<string, unknown>, matrixRowIndex: number): number {
  const range = sheet["!ref"];
  let firstRowNumber = 0;
  if (typeof range === "string") {
    let index = 0;
    while (index < range.length && range.charCodeAt(index) >= 65 && range.charCodeAt(index) <= 90) {
      index += 1;
    }
    while (index < range.length && range.charCodeAt(index) >= 48 && range.charCodeAt(index) <= 57) {
      firstRowNumber = firstRowNumber * 10 + (range.charCodeAt(index) - 48);
      index += 1;
    }
  }
  return (firstRowNumber > 0 ? firstRowNumber : 1) + matrixRowIndex;
}

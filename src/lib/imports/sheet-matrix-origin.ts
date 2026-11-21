/**
 * The sheet cell (1-based row and column, as Excel and ExcelJS number them) of the first cell of the matrix
 * that `XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true })` returns. That matrix starts at the
 * first row and the first column of the sheet's used range (`!ref`), not at A1: a table below two empty rows
 * and right of an empty column A has its first matrix cell on sheet row 3, column B (2). Matrix cell
 * (rowIndex, columnIndex) is sheet cell (row + rowIndex, column + columnIndex). Both upload parsers read a
 * row's styles (bold, merged cells, outline level) with ExcelJS there, so a style is never read from the row
 * above or the column on the left.
 *
 * The start cell is read from `!ref` as SheetJS's `safe_decode_range`, which `sheet_to_json` uses, reads it:
 * column letters (A = 1, Z = 26, AA = 27), then digits. A sheet without a readable range starts at A1.
 *
 * Self-contained on purpose: the server upload parser injects this function's source into its worker thread
 * (`Function.prototype.toString`), as it does for `selectDpgfSheetIndex`. No import, destructuring or
 * helper-compiled syntax.
 */
export function resolveSheetMatrixOrigin(sheet: Record<string, unknown>): { row: number; column: number } {
  const range = sheet["!ref"];
  let firstColumnNumber = 0;
  let firstRowNumber = 0;
  if (typeof range === "string") {
    let index = 0;
    while (index < range.length && range.charCodeAt(index) >= 65 && range.charCodeAt(index) <= 90) {
      firstColumnNumber = firstColumnNumber * 26 + (range.charCodeAt(index) - 64);
      index += 1;
    }
    while (index < range.length && range.charCodeAt(index) >= 48 && range.charCodeAt(index) <= 57) {
      firstRowNumber = firstRowNumber * 10 + (range.charCodeAt(index) - 48);
      index += 1;
    }
  }
  return {
    row: firstRowNumber > 0 ? firstRowNumber : 1,
    column: firstColumnNumber > 0 ? firstColumnNumber : 1,
  };
}

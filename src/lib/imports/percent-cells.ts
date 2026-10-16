/**
 * Percent-formatted spreadsheet cells (2.3 review). Excel stores a cell shown « 115 % » as the
 * fraction 1.15 with a percent number format, and both upload parsers read raw values: a
 * « Majoration MO (%) » column imported ×0,0115 in silence and a 20 % VAT read 0,2 %. Before
 * `sheet_to_json`, a numeric cell whose number format scales by 100 (an unquoted, unescaped « % »)
 * becomes the percent text it shows, written in the D11 grammar (« 115 % », « 12,5 % »): percent
 * targets and the OPTIMA additive majoration read it, every other target refuses it instead of
 * guessing. A literal « % » in a format (0"%" or 0\%) does not scale and keeps the number.
 *
 * Self-contained on purpose: the server upload parser injects this function's source into its
 * worker thread (`Function.prototype.toString`), as it does for `selectDpgfSheetIndex`. It needs
 * the workbook read with `cellNF: true`, which keeps each cell's number format in `z`.
 */
export function convertPercentFormattedCells(sheet: Record<string, unknown>): void {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address] as { t?: unknown; v?: unknown; z?: unknown; w?: unknown } | null;
    if (!cell || cell.t !== "n" || typeof cell.v !== "number" || !Number.isFinite(cell.v)) continue;
    if (typeof cell.z !== "string") continue;
    const scaling = cell.z.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
    if (!scaling.includes("%")) continue;
    // Shortest digits of the stored double at 15 significant digits (the binary noise of a
    // formula removed), then the decimal point moved two places: no floating multiplication.
    const digits = String(Number(cell.v.toPrecision(15)));
    if (/e/i.test(digits)) continue;
    const negative = digits.startsWith("-");
    // No destructuring or helper-compiled syntax: the source runs as is in the server worker.
    const unsigned = negative ? digits.slice(1) : digits;
    const point = unsigned.indexOf(".");
    const integer = point < 0 ? unsigned : unsigned.slice(0, point);
    const fraction = point < 0 ? "" : unsigned.slice(point + 1);
    const whole = `${integer}${fraction.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
    const decimals = fraction.slice(2);
    const text = `${negative && (whole !== "0" || decimals) ? "-" : ""}${whole}${decimals ? `,${decimals}` : ""} %`;
    cell.t = "s";
    cell.v = text;
    cell.w = text;
  }
}

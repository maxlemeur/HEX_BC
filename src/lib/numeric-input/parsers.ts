/** Text-entry grammar shared by estimates, imports and clipboard previews.
 * Native spreadsheet numbers deliberately bypass textual locale inference.
 */
type DecimalOptions = { maxFractionDigits?: number; currency?: "EUR" | "USD" | "GBP" };

/** Validated decimal digits: `integer` and `fraction` hold ASCII digits only. */
type DecimalDigits = { negative: boolean; integer: string; fraction: string };

function readDecimalText(input: string, options: DecimalOptions): DecimalDigits | null {
  let text = input.trim().replace(/[−–—]/g, "-");
  if (!text) return null;

  if (options.currency) {
    const marker = { EUR: "(?:EUR|€)", USD: "(?:USD|\\$)", GBP: "(?:GBP|£)" }[options.currency];
    text = text.replace(new RegExp(`^${marker}\\s*|\\s*${marker}$`, "gi"), "").trim();
  }
  let sign = 1;
  if (text.startsWith("(") && text.endsWith(")") && options.currency) {
    sign = -1;
    text = text.slice(1, -1).trim();
  }
  if (/^[+-]/.test(text)) {
    if (sign < 0) return null;
    if (text[0] === "-") sign = -1;
    text = text.slice(1);
  }
  if (!/^[\d., '\u00a0\u202f’]+$/.test(text)) return null;
  text = text.replace(/[\u00a0\u202f]/g, " ").replace(/’/g, "'");

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  let integer = text;
  let fraction = "";
  let grouping: string | null = null;
  let hasDecimalSeparator = false;
  if (comma >= 0 && dot >= 0) {
    hasDecimalSeparator = true;
    const decimalIndex = Math.max(comma, dot);
    integer = text.slice(0, decimalIndex);
    fraction = text.slice(decimalIndex + 1);
    grouping = comma > dot ? "." : ",";
    if (integer.includes(comma > dot ? "," : ".")) return null;
  } else if (comma >= 0) {
    hasDecimalSeparator = true;
    if (text.indexOf(",") !== comma) return null;
    integer = text.slice(0, comma);
    fraction = text.slice(comma + 1);
  } else if (dot >= 0) {
    if (text.indexOf(".") !== dot) {
      grouping = ".";
    } else {
      hasDecimalSeparator = true;
      integer = text.slice(0, dot);
      fraction = text.slice(dot + 1);
      // D11: a lone dot and three following digits is not guessed as thousands.
      if (fraction.length === 3) return null;
    }
  }
  if (hasDecimalSeparator && fraction === "") return null;
  if (fraction && !/^\d+$/.test(fraction)) return null;
  if (options.maxFractionDigits !== undefined && fraction.replace(/0+$/, "").length > options.maxFractionDigits) return null;

  const separators = [...new Set(integer.replace(/\d/g, ""))];
  if (separators.length > 1) return null;
  if (separators.length === 1) {
    const separator = separators[0];
    if (separator !== " " && separator !== "'" && separator !== grouping) return null;
    const groups = integer.split(separator);
    if (!/^\d{1,3}$/.test(groups[0]) || !groups.slice(1).every((group) => /^\d{3}$/.test(group))) return null;
    integer = groups.join("");
  }
  if (!/^\d*$/.test(integer) || (!integer && !fraction)) return null;
  return { negative: sign < 0, integer, fraction };
}

export function parseDecimalInput(input: unknown, options: DecimalOptions = {}): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const digits = readDecimalText(input, options);
  if (!digits) return null;
  const value = (digits.negative ? -1 : 1) * Number(`${digits.integer || "0"}${digits.fraction ? `.${digits.fraction}` : ""}`);
  return Number.isFinite(value) ? value : null;
}

/** Positional notation of |value| with a dot, exponent expanded, from its shortest round-trip digits. */
function toPlainDecimal(value: number): string {
  const [mantissa, exponent] = String(Math.abs(value)).split("e");
  if (exponent === undefined) return mantissa;
  const [integer, fraction = ""] = mantissa.split(".");
  const digits = integer + fraction;
  const position = integer.length + Number(exponent);
  return position <= 0
    ? `0.${"0".repeat(-position)}${digits}`
    : position >= digits.length
      ? digits + "0".repeat(position - digits.length)
      : `${digits.slice(0, position)}.${digits.slice(position)}`;
}

export function formatDecimalInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${value < 0 ? "-" : ""}${toPlainDecimal(value).replace(".", ",")}`;
}

export const NUMERIC_INPUT_ERROR = "Nombre invalide : utilisez une virgule décimale et des espaces pour les milliers.";

// Per-quantity parsers (D11, sub-lot 2.3), built on the grammar above. Each returns the value at
// its quantity's precision, or null. Empty text means "not provided" (null): the field applies its
// own documented default (docs/testing/tech-debt-numeric-entry.md). Excess decimals in text are
// refused, never rounded. A native spreadsheet number bypasses the textual grammar, as in
// parseDecimalInput: it is rounded half away from zero at that precision from its shortest decimal
// digits (Excel ROUND, PostgreSQL round(numeric)), so binary noise such as 3491.8000000000002 reads
// 3491.80. Scaling works on exact digits (BigInt, D13), never by floating-point multiplication.

// BigInt() calls, not literals: the TypeScript target is ES2017.
const ZERO = BigInt(0);
const AMOUNT_FRACTION_DIGITS = 2;
const QUANTITY_FRACTION_DIGITS = 3;
const HOURS_PER_UNIT_FRACTION_DIGITS = 4;
const COEFFICIENT_FRACTION_DIGITS = 4;
/** v1/v2 line storage of K FO, K MO, quantity and h MO: numeric(12,3). */
const STORED_COEFFICIENT_FRACTION_DIGITS = 3;
/** Two decimals of percent: the percent units of a rate are its basis points. */
const RATE_PERCENT_FRACTION_DIGITS = 2;
const MAX_RATE_BP = BigInt(10_000);
/** A stored majoration coefficient stays within [0 ; 10] (D11, P-11). */
const MAJORATION_NEUTRAL_UNITS = BigInt(10 ** COEFFICIENT_FRACTION_DIGITS);
const MAJORATION_MAX_UNITS = BigInt(10) * MAJORATION_NEUTRAL_UNITS;

type QuantityTextOptions = { currency?: "EUR"; percent?: boolean };

function readQuantityDigits(
  input: unknown,
  options: QuantityTextOptions,
): { digits: DecimalDigits; native: boolean } | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    const [integer, fraction = ""] = toPlainDecimal(input).split(".");
    return { digits: { negative: input < 0, integer, fraction }, native: true };
  }
  if (typeof input !== "string") return null;
  // "%" is a unit marker, admitted only where the caller reads a rate or a majoration.
  const text = options.percent ? input.trim().replace(/\s*%$/, "") : input;
  const digits = readDecimalText(text, { currency: options.currency });
  return digits ? { digits, native: false } : null;
}

/** Signed integer units at `scale` decimals (cents for 2), or null when text exceeds that scale. */
function readScaledUnits(input: unknown, scale: number, options: QuantityTextOptions = {}): bigint | null {
  const read = readQuantityDigits(input, options);
  if (!read) return null;
  const fraction = read.digits.fraction.replace(/0+$/, "");
  let units = BigInt(`${read.digits.integer || "0"}${fraction.slice(0, scale).padEnd(scale, "0")}`);
  if (fraction.length > scale) {
    if (!read.native) return null;
    if (fraction[scale] >= "5") units += BigInt(1);
  }
  return read.digits.negative ? -units : units;
}

function unitsToDecimal(units: bigint, scale: number): number | null {
  const magnitude = (units < ZERO ? -units : units).toString().padStart(scale + 1, "0");
  const value = Number(scale === 0 ? magnitude : `${magnitude.slice(0, -scale)}.${magnitude.slice(-scale)}`);
  if (!Number.isFinite(value)) return null;
  return units < ZERO ? -value : value;
}

function unitsToInteger(units: bigint): number | null {
  const value = Number(units);
  return Number.isSafeInteger(value) ? value : null;
}

/** Amount in integer cents: two decimals at most, optional « € » or « EUR », sign allowed. */
export function parseAmountCents(input: unknown): number | null {
  const units = readScaledUnits(input, AMOUNT_FRACTION_DIGITS, { currency: "EUR" });
  return units === null ? null : unitsToInteger(units);
}

/** Quantity with three decimals at most; its sign is left to the field's own rule. */
export function parseQuantity(input: unknown): number | null {
  const units = readScaledUnits(input, QUANTITY_FRACTION_DIGITS);
  return units === null ? null : unitsToDecimal(units, QUANTITY_FRACTION_DIGITS);
}

/** Labour hours per unit (OPTIMA « Tps pose unitaire », v3 h/u): four decimals at most, never negative. */
export function parseHoursPerUnit(input: unknown): number | null {
  const units = readScaledUnits(input, HOURS_PER_UNIT_FRACTION_DIGITS);
  return units === null || units < ZERO ? null : unitsToDecimal(units, HOURS_PER_UNIT_FRACTION_DIGITS);
}

/** Rate written in percent (« 12,5 » or « 12,5 % », two decimals at most) as basis points in [0 ; 10 000]. */
export function parseRateBp(input: unknown): number | null {
  const units = readScaledUnits(input, RATE_PERCENT_FRACTION_DIGITS, { percent: true });
  return units === null || units < ZERO || units > MAX_RATE_BP ? null : unitsToInteger(units);
}

/** Multiplying coefficient (K FO, K MO): four decimals at most, never negative. */
export function parseCoefficient(input: unknown): number | null {
  const units = readScaledUnits(input, COEFFICIENT_FRACTION_DIGITS);
  return units === null || units < ZERO ? null : unitsToDecimal(units, COEFFICIENT_FRACTION_DIGITS);
}

/**
 * K FO and K MO of v1/v2 lines (numeric(12,3), 2.3 review): three decimals at most, never negative.
 * A fourth decimal cannot be stored, so text carrying one is refused rather than rounded on write.
 */
export function parseStoredCoefficient(input: unknown): number | null {
  const units = readScaledUnits(input, STORED_COEFFICIENT_FRACTION_DIGITS);
  return units === null || units < ZERO ? null : unitsToDecimal(units, STORED_COEFFICIENT_FRACTION_DIGITS);
}

function toMajorationCoefficient(units: bigint | null): number | null {
  return units === null || units < ZERO || units > MAJORATION_MAX_UNITS
    ? null
    : unitsToDecimal(units, COEFFICIENT_FRACTION_DIGITS);
}

/**
 * « Majoration MO (%) » (P-11: 100 = neutral, two decimals of percent, optional « % ») as the
 * stored coefficient within [0 ; 10]: « 112,5 » → 1.125, « 8 » → 0.08, « 1 001 » refused.
 */
export function parseMajorationPercent(input: unknown): number | null {
  // Two decimals of percent are exactly the four decimals of the stored coefficient.
  return toMajorationCoefficient(readScaledUnits(input, COEFFICIENT_FRACTION_DIGITS - 2, { percent: true }));
}

/** Majoration declared as a coefficient (1 = neutral), four decimals at most, within [0 ; 10]. */
export function parseMajorationCoefficient(input: unknown): number | null {
  return toMajorationCoefficient(readScaledUnits(input, COEFFICIENT_FRACTION_DIGITS));
}

/**
 * OPTIMA additive majoration N (0 = neutral): coefficient = 1 + N, within [0 ; 10]. A cell the
 * workbook formats in percent reaches the import as its percent text (« 15 % », 2.3 review): it is
 * N in percent, two decimals at most, so +15 % gives ×1,15.
 */
export function parseMajorationAdditive(input: unknown): number | null {
  const percent = typeof input === "string" && /%\s*$/.test(input.trim());
  const units = percent
    ? readScaledUnits(input, COEFFICIENT_FRACTION_DIGITS - 2, { percent: true })
    : readScaledUnits(input, COEFFICIENT_FRACTION_DIGITS);
  return toMajorationCoefficient(units === null ? null : units + MAJORATION_NEUTRAL_UNITS);
}

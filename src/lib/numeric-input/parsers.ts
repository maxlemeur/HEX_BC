/** Text-entry grammar shared by estimates, imports and clipboard previews.
 * Native spreadsheet numbers deliberately bypass textual locale inference.
 */
export function parseDecimalInput(
  input: unknown,
  options: { maxFractionDigits?: number; currency?: "EUR" | "USD" | "GBP" } = {},
): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
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
  const value = sign * Number(`${integer || "0"}${fraction ? `.${fraction}` : ""}`);
  return Number.isFinite(value) ? value : null;
}

export function formatDecimalInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const [mantissa, exponent] = String(Math.abs(value)).split("e");
  let decimal = mantissa;
  if (exponent !== undefined) {
    const [integer, fraction = ""] = mantissa.split(".");
    const digits = integer + fraction;
    const position = integer.length + Number(exponent);
    decimal = position <= 0
      ? `0.${"0".repeat(-position)}${digits}`
      : position >= digits.length
        ? digits + "0".repeat(position - digits.length)
        : `${digits.slice(0, position)}.${digits.slice(position)}`;
  }
  return `${value < 0 ? "-" : ""}${decimal.replace(".", ",")}`;
}

export const NUMERIC_INPUT_ERROR = "Nombre invalide : utilisez une virgule décimale et des espaces pour les milliers.";

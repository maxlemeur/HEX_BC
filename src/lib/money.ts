export const SUPPORTED_ESTIMATE_CURRENCIES = ["EUR", "USD", "GBP"] as const;

export type SupportedEstimateCurrency =
  (typeof SUPPORTED_ESTIMATE_CURRENCIES)[number];

const CURRENCY_LOCALE_BY_CODE: Record<SupportedEstimateCurrency, string> = {
  EUR: "fr-FR",
  USD: "en-US",
  GBP: "en-GB",
};

function normalizeCurrencyInput(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function isSupportedEstimateCurrency(
  value: string | null | undefined
): value is SupportedEstimateCurrency {
  const normalized = normalizeCurrencyInput(value);
  return (SUPPORTED_ESTIMATE_CURRENCIES as readonly string[]).includes(normalized);
}

export function normalizeEstimateCurrency(
  value: string | null | undefined
): SupportedEstimateCurrency | null {
  return isSupportedEstimateCurrency(value) ? normalizeCurrencyInput(value) as SupportedEstimateCurrency : null;
}

export function formatCurrency(
  cents: number,
  currency: SupportedEstimateCurrency
) {
  return new Intl.NumberFormat(CURRENCY_LOCALE_BY_CODE[currency], {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function stripCurrencyMarkers(
  value: string,
  currency: SupportedEstimateCurrency
) {
  const markerPatterns: Record<SupportedEstimateCurrency, RegExp> = {
    EUR: /(EUR|€)/gi,
    USD: /(USD|\$)/gi,
    GBP: /(GBP|£)/gi,
  };
  return value.replace(markerPatterns[currency], "");
}

function parseEuroInputToNumber(input: string) {
  const stripped = stripCurrencyMarkers(input, "EUR").replace(/\s|\u00A0|\u202F/g, "");
  if (!stripped) return null;

  let normalized = stripped;
  const hasComma = stripped.includes(",");
  const hasDot = stripped.includes(".");

  if (hasComma && hasDot) {
    normalized = stripped.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = stripped.replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(stripped)) {
    normalized = stripped.replace(/\./g, "");
  }

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUsdGbpInputToNumber(
  input: string,
  currency: "USD" | "GBP"
) {
  const stripped = stripCurrencyMarkers(input, currency).replace(/\s|\u00A0|\u202F/g, "");
  if (!stripped) return null;

  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(stripped)) {
    return null;
  }

  const normalized = stripped.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCurrencyToCents(
  input: string,
  currency: SupportedEstimateCurrency
) {
  const parsed =
    currency === "EUR"
      ? parseEuroInputToNumber(input)
      : parseUsdGbpInputToNumber(input, currency);
  if (parsed === null) return null;
  return Math.round(parsed * 100);
}

export function formatEUR(cents: number) {
  return formatCurrency(cents, "EUR");
}

export function parseEuroToCents(input: string) {
  return parseCurrencyToCents(input, "EUR");
}

export function computeTaxCents(amountCents: number, taxRateBp: number) {
  return Math.round((amountCents * taxRateBp) / 10000);
}

/**
 * Banker's rounding (round half to nearest even).
 * Recommended by DGFIP to avoid systematic upward bias from Math.round.
 */
export function bankersRound(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  const remainder = Math.abs(value - truncated);
  if (Math.abs(remainder - 0.5) < 1e-9) {
    const even = truncated % 2 === 0 ? truncated : truncated + Math.sign(value);
    return even === 0 ? 0 : even; // coerce -0 to +0
  }
  return Math.round(value);
}

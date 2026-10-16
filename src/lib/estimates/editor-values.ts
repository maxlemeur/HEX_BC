import {
  parseAmountCents,
  parseDecimalInput,
  parseQuantity,
  parseRateBp,
  parseStoredCoefficient,
} from "@/lib/numeric-input/parsers";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function toNullableFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Blank cells retain their existing zero default; invalid text never does. */
export function parseNumberInput(value: string): number | null {
  return value.trim() === "" ? 0 : parseDecimalInput(value);
}

export function parseNullableNumberInput(value: string): number | null {
  return parseDecimalInput(value);
}

export function parseNullableNumericValue(value: unknown): number | null {
  return parseDecimalInput(value);
}

// Grid and settings adapters of the D11 per-quantity parsers (2.3 review): the reading of the
// import and the paste, at the v1/v2 stored precision (quantity, h MO, K FO, K MO numeric(12,3)).
// Excess decimals are refused instead of being rounded by PostgreSQL on write, and the stored
// fields are never negative. An empty draft stays each field's business (`emptyValue`).

/** Grid quantity cell: empty keeps its zero default, as parseNumberInput; three decimals at most. */
export function parseQuantityInput(value: string): number | null {
  if (value.trim() === "") return 0;
  const quantity = parseQuantity(value);
  return quantity === null || quantity < 0 ? null : quantity;
}

/** Grid h MO cells (line, workshop, site): the line's total hours, three decimals at most. */
export function parseLineHoursDraft(value: string): number | null {
  const hours = parseQuantity(value);
  return hours === null || hours < 0 ? null : hours;
}

/** Grid K FO and K MO cells: the stored coefficient, three decimals at most. */
export function parseCoefficientDraft(value: string): number | null {
  return parseStoredCoefficient(value);
}

/** Mobile price field, which stores round(euros × 100): two decimals at most, never negative. */
export function parseAmountDraft(value: string): number | null {
  const cents = parseAmountCents(value);
  return cents === null || cents < 0 ? null : cents / 100;
}

/** Settings and wizard « TVA » field, in percent: « 5,5 » or « 5,5 % », two decimals, within [0 ; 100]. */
export function parseRatePercentDraft(value: string): number | null {
  const basisPoints = parseRateBp(value);
  return basisPoints === null ? null : basisPoints / 100;
}

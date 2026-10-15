import { parseDecimalInput } from "@/lib/numeric-input/parsers";

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

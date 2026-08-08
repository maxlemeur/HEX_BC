import { isImportReservedKey } from "./payload";

export type SimpleJsonValue = string | number | boolean | null;
export type ImportJsonValue =
  | SimpleJsonValue
  | ImportJsonValue[]
  | { [key: string]: ImportJsonValue };
export type NormalizedImportRow = Record<string, ImportJsonValue>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeOptimaHeader(raw: string): string | null {
  const normalized = stripAccents(raw.toLowerCase()).replace(/[^a-z0-9]+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  const wordSet = new Set(words);
  const hasWordPrefix = (prefix: string) => words.some((word) => word.startsWith(prefix));

  if (
    (wordSet.has("type") && wordSet.has("fo")) ||
    (wordSet.has("famille") && wordSet.has("fo"))
  ) {
    return "Type_FO";
  }

  if (
    (wordSet.has("majoration") && wordSet.has("mo")) ||
    (wordSet.has("temps") && hasWordPrefix("major"))
  ) {
    return "Majoration_MO";
  }

  return null;
}

export function normalizeHeaderValue(value: unknown, index: number) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value === null || value === undefined
        ? ""
        : String(value).trim();

  if (raw.length === 0) {
    return `column_${index + 1}`;
  }

  const optimaHeader = normalizeOptimaHeader(raw);
  if (optimaHeader) {
    return optimaHeader;
  }

  const sanitized = stripAccents(raw)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized.length > 0 ? sanitized : `column_${index + 1}`;
}

export function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>();

  return headers.map((header) => {
    const count = counts.get(header) ?? 0;
    const nextCount = count + 1;
    counts.set(header, nextCount);
    return nextCount === 1 ? header : `${header}_${nextCount}`;
  });
}

export function buildHeaders(firstRow: unknown[], columnCount: number) {
  const rawHeaders: string[] = [];

  for (let index = 0; index < columnCount; index += 1) {
    rawHeaders.push(normalizeHeaderValue(firstRow[index], index));
  }

  return dedupeHeaders(rawHeaders);
}

function normalizeJsonValue(value: unknown): ImportJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeJsonValue(entry));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry)])
    );
  }

  return String(value);
}

export function normalizeCellValue(value: unknown): SimpleJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function normalizeRowObject(row: Record<string, unknown>) {
  const normalized: NormalizedImportRow = {};
  const counts = new Map<string, number>();

  Object.entries(row).forEach(([rawKey, rawValue], index) => {
    const trimmedRawKey = rawKey.trim();
    if (isImportReservedKey(trimmedRawKey)) {
      normalized[trimmedRawKey] = normalizeJsonValue(rawValue);
      return;
    }

    const baseKey = normalizeHeaderValue(rawKey, index);
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}_${count}`;
    normalized[key] = normalizeCellValue(rawValue);
  });

  return normalized;
}

export function hasNonReservedValue(row: NormalizedImportRow) {
  return Object.entries(row).some(
    ([key, value]) => !isImportReservedKey(key) && value !== null
  );
}

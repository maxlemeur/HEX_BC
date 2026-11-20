import { isRecord, toNonEmptyString } from "@/lib/value-guards";

export type JsonRecord = Record<string, unknown>;
export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
export function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

export function hasOwnProperty(record: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function getRootPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if (payload.data !== undefined) return payload.data;
  return payload;
}

export function extractEntity(payload: unknown, keys: string[]): JsonRecord | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
      return value[0] as JsonRecord;
    }
  }

  if (typeof root.id === "string") {
    return root;
  }

  return null;
}

export function extractBoolean(payload: unknown, keys: string[]): boolean | null {
  const root = getRootPayload(payload);

  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    const parsed = toBooleanValue(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

export function pickRecord(root: JsonRecord, keys: string[]): JsonRecord | null {
  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
      return value[0] as JsonRecord;
    }
  }
  return null;
}

export function pickArray(root: unknown, keys: string[]): unknown[] {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) return [];

  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

export function parseOptionalNullableStringProperty(
  record: JsonRecord,
  keys: string[]
): string | null | undefined {
  for (const key of keys) {
    if (!hasOwnProperty(record, key)) continue;
    const value = record[key];
    if (value === null) return null;
    return toNonEmptyString(value);
  }

  return undefined;
}

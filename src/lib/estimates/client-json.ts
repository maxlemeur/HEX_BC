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

/** The address of a library list (templates, ouvrages): a trimmed search, a whole positive limit and an order. */
export function libraryListPath(
  base: string,
  options?: { search?: string; limit?: number; order?: "recent" | "oldest" }
): string {
  const params = new URLSearchParams();
  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", String(Math.floor(options.limit)));
  }
  if (options?.order) {
    params.set("order", options.order);
  }

  const query = params.toString();
  return query.length > 0 ? `${base}?${query}` : base;
}

/** The records of an array, anything else dropped; not an array gives none. */
export function pickRecordArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as T[];
}

/** The entities of a library list, read under `key` or else `items`; an entry its parser refuses is dropped. */
export function parseLibraryList<T>(
  payload: unknown,
  key: string,
  parseEntity: (value: unknown) => T | null
): T[] {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return [];
  const rawItems = Array.isArray(root[key])
    ? root[key]
    : Array.isArray(root.items)
      ? root.items
      : [];

  return rawItems
    .map((item) => parseEntity(item))
    .filter((item): item is T => Boolean(item));
}

import { z } from "zod";

import type { Database } from "@/types/database";

export const AFFAIRE_PAGE_SIZE_OPTIONS = [20, 50, 100, 1000] as const;
export type AffairePageSize = (typeof AFFAIRE_PAGE_SIZE_OPTIONS)[number];

export const AFFAIRE_SORT_VALUES = [
  "updatedAt",
  "name",
  "totalHtCents",
] as const;
export type AffaireSort = (typeof AFFAIRE_SORT_VALUES)[number];
export const AFFAIRE_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;
export type AffaireSortDirection = (typeof AFFAIRE_SORT_DIRECTION_VALUES)[number];
export const AFFAIRE_MANAGER_QUEUE_FILTER_VALUES = [
  "all",
  "follow_up",
  "reservations",
  "revalidation",
] as const;
export type AffaireManagerQueueFilter =
  (typeof AFFAIRE_MANAGER_QUEUE_FILTER_VALUES)[number];

export const AFFAIRE_STATUS_VALUES = [
  "draft",
  "sent",
  "accepted",
  "archived",
] as const;
export type AffaireStatus = Database["public"]["Enums"]["estimate_status"];

const AFFAIRE_STATUS_SET = new Set<AffaireStatus>(AFFAIRE_STATUS_VALUES);
const DEFAULT_PAGE_SIZE: AffairePageSize = 20;
const DEFAULT_SORT: AffaireSort = "updatedAt";
const DEFAULT_SORT_DIRECTION: AffaireSortDirection = "desc";
const DEFAULT_MANAGER_QUEUE_FILTER: AffaireManagerQueueFilter = "all";

export type AffaireCursorPayload =
  | { sort: "updatedAt"; value: string; projectId: string }
  | { sort: "name"; value: string; projectId: string }
  | { sort: "totalHtCents"; value: number; projectId: string };

export type AffaireListQuery = {
  q?: string | null;
  status?: AffaireStatus[] | null;
  favorites?: boolean | string | null;
  manager?: string | null;
  size?: number | string | null;
  cursor?: string | null;
  sort?: string | null;
  dir?: string | null;
};

export type NormalizedAffaireListQuery = {
  q: string | null;
  status: AffaireStatus[] | null;
  favoritesOnly: boolean;
  manager: AffaireManagerQueueFilter;
  size: AffairePageSize;
  cursor: string | null;
  sort: AffaireSort;
  dir: AffaireSortDirection;
};

export type AffaireSearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const sizeSchema = z
  .coerce
  .number()
  .int()
  .refine(
    (value): value is AffairePageSize =>
      AFFAIRE_PAGE_SIZE_OPTIONS.includes(value as AffairePageSize),
    "Page size invalide."
  );

const searchSchema = z
  .string()
  .trim()
  .max(120)
  .transform((value) => {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  });

const cursorSchema = z
  .string()
  .trim()
  .max(512)
  .transform((value) => {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  });

const sortSchema = z
  .enum(AFFAIRE_SORT_VALUES)
  .catch(DEFAULT_SORT);
const sortDirectionSchema = z
  .enum(AFFAIRE_SORT_DIRECTION_VALUES)
  .catch(DEFAULT_SORT_DIRECTION);
const managerQueueFilterSchema = z
  .enum(AFFAIRE_MANAGER_QUEUE_FILTER_VALUES)
  .catch(DEFAULT_MANAGER_QUEUE_FILTER);

export const affaireCursorPayloadSchema = z.discriminatedUnion("sort", [
  z.object({
    sort: z.literal("updatedAt"),
    value: z.string().datetime({ offset: true }),
    projectId: z.string().uuid(),
  }),
  z.object({
    sort: z.literal("name"),
    value: z.string(),
    projectId: z.string().uuid(),
  }),
  z.object({
    sort: z.literal("totalHtCents"),
    value: z.number().int(),
    projectId: z.string().uuid(),
  }),
]);

function toNullableFirstString(
  value: string | string[] | number | null | undefined
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function toStatusTokens(
  value: string | string[] | AffaireStatus[] | null | undefined
): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeStatusList(tokens: string[]): AffaireStatus[] | null {
  if (tokens.length === 0) return null;

  const deduped: AffaireStatus[] = [];

  for (const token of tokens) {
    if (!AFFAIRE_STATUS_SET.has(token as AffaireStatus)) {
      continue;
    }

    const normalized = token as AffaireStatus;
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }

  return deduped.length > 0 ? deduped : null;
}

function parseSize(
  value: string | string[] | number | null | undefined
): AffairePageSize {
  const candidate = toNullableFirstString(value);
  if (!candidate) {
    return DEFAULT_PAGE_SIZE;
  }

  const parsed = sizeSchema.safeParse(candidate);
  if (!parsed.success) {
    return DEFAULT_PAGE_SIZE;
  }

  return parsed.data;
}

function parseSearch(value: string | string[] | null | undefined): string | null {
  const candidate = toNullableFirstString(value);
  if (!candidate) return null;

  const parsed = searchSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function parseCursor(value: string | string[] | null | undefined): string | null {
  const candidate = toNullableFirstString(value);
  if (!candidate) return null;

  const parsed = cursorSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function parseSort(value: string | string[] | null | undefined): AffaireSort {
  const candidate = toNullableFirstString(value);
  if (!candidate) {
    return DEFAULT_SORT;
  }

  return sortSchema.parse(candidate);
}

function parseSortDirection(
  value: string | string[] | null | undefined
): AffaireSortDirection {
  const candidate = toNullableFirstString(value);
  if (!candidate) {
    return DEFAULT_SORT_DIRECTION;
  }

  return sortDirectionSchema.parse(candidate);
}

function parseFavoritesOnly(
  value: boolean | string | string[] | null | undefined
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const candidate = toNullableFirstString(value);
  if (!candidate) {
    return false;
  }

  return candidate === "1" || candidate.toLowerCase() === "true";
}

function parseManagerQueueFilter(
  value: string | string[] | null | undefined
): AffaireManagerQueueFilter {
  const candidate = toNullableFirstString(value);
  if (!candidate) {
    return DEFAULT_MANAGER_QUEUE_FILTER;
  }

  return managerQueueFilterSchema.parse(candidate);
}

export function normalizeAffaireListQuery(
  input: AffaireListQuery | undefined
): NormalizedAffaireListQuery {
  return {
    q: parseSearch(input?.q),
    status: normalizeStatusList(toStatusTokens(input?.status)),
    favoritesOnly: parseFavoritesOnly(input?.favorites),
    manager: parseManagerQueueFilter(input?.manager),
    size: parseSize(input?.size),
    cursor: parseCursor(input?.cursor),
    sort: parseSort(input?.sort),
    dir: parseSortDirection(input?.dir),
  };
}

export function parseAffaireListQuery(
  input: AffaireSearchParamsInput
): NormalizedAffaireListQuery {
  if (input instanceof URLSearchParams) {
    return {
      q: parseSearch(input.get("q")),
      status: normalizeStatusList(toStatusTokens(input.getAll("status"))),
      favoritesOnly: parseFavoritesOnly(input.get("favorites")),
      manager: parseManagerQueueFilter(input.get("manager")),
      size: parseSize(input.get("size")),
      cursor: parseCursor(input.get("cursor")),
      sort: parseSort(input.get("sort")),
      dir: parseSortDirection(input.get("dir")),
    };
  }

  return {
    q: parseSearch(input.q),
    status: normalizeStatusList(toStatusTokens(input.status)),
    favoritesOnly: parseFavoritesOnly(input.favorites),
    manager: parseManagerQueueFilter(input.manager),
    size: parseSize(input.size),
    cursor: parseCursor(input.cursor),
    sort: parseSort(input.sort),
    dir: parseSortDirection(input.dir),
  };
}

import { randomUUID } from "crypto";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  BulkCreateSupplierPricesAtomicInput,
  BulkCreateSupplierPricesInput,
  BulkUpsertMaterialIndicesInput,
  CatalogueListQueryInput,
  CataloguePageQueryInput,
  CreateMissingPriceImportEntitiesInput,
  CreateCatalogueItemInput,
  CreateMaterialIndexInput,
  CreateSupplierPriceInput,
  IndicesListQueryInput,
  LinkMappedRowsInput,
  PriceLookupsQueryInput,
  PricesListQueryInput,
  PricesPageQueryInput,
  ResolvePriceImportSuggestionsInput,
  UpdateCatalogueItemInput,
  UpdateMaterialIndexInput,
  UpdateSupplierPriceInput,
} from "./schemas";

type JsonRecord = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeSupabase = SupabaseClient<any>;

type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

type ApiErrorBody = {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
};

export type ApiFailureResponse = {
  ok: false;
  error: ApiErrorBody;
};

export type CatalogueItemRecord = {
  id: string;
  created_at?: string;
  updated_at?: string;
  reference?: string | null;
  hex_code?: string | null;
  designation?: string | null;
  unit_price_cents?: number | null;
  tax_rate_bp?: number | null;
  is_active?: boolean;
  [key: string]: unknown;
};

export type SupplierPriceRecord = {
  id: string;
  created_at?: string;
  updated_at?: string;
  supplier_id?: string | null;
  product_id?: string | null;
  catalogue_item_id?: string | null;
  supplier_sku?: string | null;
  unit?: string | null;
  min_quantity?: number | null;
  unit_price_cents?: number | null;
  currency?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active?: boolean;
  source_import_id?: string | null;
  source_mapped_row_id?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

export type MaterialIndexRecord = {
  id: string;
  created_at?: string;
  updated_at?: string;
  index_code?: string | null;
  code?: string | null;
  label?: string | null;
  index_date?: string | null;
  effective_date?: string | null;
  index_value?: number | null;
  value?: number | null;
  unit?: string | null;
  source?: string | null;
  metadata?: unknown;
  [key: string]: unknown;
};

export type PriceImportSuggestionMatch = {
  id: string;
  value: string;
  confidence: number;
};

export type PriceImportSuggestion = {
  type: "supplier" | "product";
  input: string;
  matches: PriceImportSuggestionMatch[];
};

export class CatalogueApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 500;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor({
    status,
    code,
    message,
    details,
  }: {
    status: 400 | 401 | 403 | 404 | 409 | 500;
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  }) {
    super(message);
    this.name = "CatalogueApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, status: 200 | 201 = 200) {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      ok: true,
      data,
    },
    { status }
  );
}

export function badRequest(message: string, details?: unknown, code = "BAD_REQUEST") {
  return new CatalogueApiError({
    status: 400,
    code,
    message,
    details,
  });
}

function unauthorized(message = "Unauthorized") {
  return new CatalogueApiError({
    status: 401,
    code: "UNAUTHORIZED",
    message,
  });
}

function forbidden(message = "Acces refuse.", details?: unknown, code = "FORBIDDEN") {
  return new CatalogueApiError({
    status: 403,
    code,
    message,
    details,
  });
}

function notFound(message: string, details?: unknown, code = "NOT_FOUND") {
  return new CatalogueApiError({
    status: 404,
    code,
    message,
    details,
  });
}

function conflict(message: string, details?: unknown, code = "CONFLICT") {
  return new CatalogueApiError({
    status: 409,
    code,
    message,
    details,
  });
}

function internalError(
  message = "Une erreur interne est survenue.",
  details?: unknown,
  code: ApiErrorCode | string = "INTERNAL_ERROR"
) {
  return new CatalogueApiError({
    status: 500,
    code,
    message,
    details,
  });
}

function mapSupabaseError(error: PostgrestError, fallbackMessage: string): CatalogueApiError {
  const normalizedMessage = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (error.code === "42501" || normalizedMessage.includes("row-level security")) {
    return forbidden("Acces refuse.", error, "FORBIDDEN");
  }

  if (error.code === "PGRST116") {
    return notFound("Ressource introuvable.", error, "NOT_FOUND");
  }

  if (error.code === "23505") {
    return conflict("Conflit de donnees.", error, "CONFLICT");
  }

  if (error.code === "23503" || error.code === "23514" || error.code === "22P02") {
    return badRequest(fallbackMessage, error, "BAD_REQUEST");
  }

  return badRequest(fallbackMessage, error, "BAD_REQUEST");
}

function fromZodError(error: ZodError): CatalogueApiError {
  const summary = error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.filter(Boolean).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join(" ; ");

  return new CatalogueApiError({
    status: 400,
    code: "VALIDATION_ERROR",
    message: summary || "Donnees invalides.",
    details: {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    },
  });
}

export function toErrorResponse(error: unknown) {
  let apiError: CatalogueApiError;

  if (error instanceof CatalogueApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = fromZodError(error);
  } else {
    console.error("Unexpected catalogue API error", error);
    apiError = internalError();
  }

  // K-01: Log internal details server-side only, never expose to client
  if (apiError.details) {
    console.error(`[catalogue] API error details (${apiError.code}):`, apiError.details);
  }

  const body: ApiFailureResponse = {
    ok: false,
    error: {
      code: apiError.code,
      message: apiError.message,
    },
  };

  return NextResponse.json(body, { status: apiError.status });
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function normalizeToken(value: unknown) {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim().toLowerCase();
  }

  return "";
}

function normalizeSuggestionToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeIlikeToken(value: string) {
  return value.replace(/[%_,]/g, "");
}

function escapeIlikePattern(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeSuggestionToken(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter(Boolean));
}

function scoreSuggestionMatch(source: string, candidate: string): number {
  const sourceToken = normalizeSuggestionToken(source);
  const candidateToken = normalizeSuggestionToken(candidate);

  if (!sourceToken || !candidateToken) return 0;
  if (sourceToken === candidateToken) return 1;
  if (candidateToken.startsWith(sourceToken) || sourceToken.startsWith(candidateToken)) {
    return 0.9;
  }
  if (candidateToken.includes(sourceToken) || sourceToken.includes(candidateToken)) {
    return 0.8;
  }

  const sourceWords = tokenize(sourceToken);
  const candidateWords = tokenize(candidateToken);
  if (sourceWords.size === 0 || candidateWords.size === 0) return 0;

  let overlap = 0;
  sourceWords.forEach((word) => {
    if (candidateWords.has(word)) overlap += 1;
  });

  const denominator = Math.max(sourceWords.size, candidateWords.size);
  return overlap / denominator;
}

function extractMissingColumn(error: PostgrestError): string | null {
  const message = `${error.message ?? ""} ${error.details ?? ""}`;
  const matches = [
    message.match(/could not find the ['\"]?([a-zA-Z0-9_]+)['\"]? column/i),
    message.match(/column ['\"]?([a-zA-Z0-9_]+)['\"]?/i),
  ];

  for (const match of matches) {
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function isFunctionMissingError(error: PostgrestError) {
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return error.code === "PGRST202" || message.includes("could not find the function");
}

function sanitizeWritePayload(payload: JsonRecord) {
  const nextPayload: JsonRecord = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    nextPayload[key] = value;
  }

  return nextPayload;
}

async function insertSingleWithFallback(
  supabase: RuntimeSupabase,
  table: string,
  payload: JsonRecord,
  fallbackMessage: string
): Promise<JsonRecord> {
  const attemptPayload = sanitizeWritePayload(payload);
  // K-07: Track silently dropped columns
  const droppedColumns: string[] = [];

  for (let index = 0; index < 8; index += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert(attemptPayload)
      .select("*")
      .single();

    if (!error) {
      if (droppedColumns.length > 0) {
        console.warn(
          `[catalogue] insertSingleWithFallback: dropped columns [${droppedColumns.join(", ")}] from table "${table}"`
        );
      }
      return (data ?? {}) as JsonRecord;
    }

    const missingColumn = extractMissingColumn(error);
    if (!missingColumn || !(missingColumn in attemptPayload)) {
      throw mapSupabaseError(error, fallbackMessage);
    }

    droppedColumns.push(missingColumn);
    delete attemptPayload[missingColumn];
  }

  throw badRequest(fallbackMessage);
}

async function updateSingleWithFallback(
  supabase: RuntimeSupabase,
  table: string,
  id: string,
  payload: JsonRecord,
  fallbackMessage: string
): Promise<JsonRecord> {
  const attemptPayload = sanitizeWritePayload(payload);

  for (let index = 0; index < 8; index += 1) {
    if (Object.keys(attemptPayload).length === 0) {
      throw badRequest("Aucun champ de mise a jour valide.");
    }

    const { data, error } = await supabase
      .from(table)
      .update(attemptPayload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (!error) {
      if (!data) {
        throw notFound("Ressource introuvable.");
      }
      return data as JsonRecord;
    }

    const missingColumn = extractMissingColumn(error);
    if (!missingColumn || !(missingColumn in attemptPayload)) {
      throw mapSupabaseError(error, fallbackMessage);
    }

    delete attemptPayload[missingColumn];
  }

  throw badRequest(fallbackMessage);
}

async function insertManyWithFallback(
  supabase: RuntimeSupabase,
  table: string,
  payload: JsonRecord[],
  fallbackMessage: string
): Promise<JsonRecord[]> {
  let attemptPayload = payload.map((row) => sanitizeWritePayload(row));

  for (let index = 0; index < 8; index += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert(attemptPayload)
      .select("*");

    if (!error) {
      return (data ?? []) as JsonRecord[];
    }

    const missingColumn = extractMissingColumn(error);
    if (!missingColumn) {
      throw mapSupabaseError(error, fallbackMessage);
    }

    const hasColumn = attemptPayload.some((row) => missingColumn in row);
    if (!hasColumn) {
      throw mapSupabaseError(error, fallbackMessage);
    }

    attemptPayload = attemptPayload.map((row) => {
      const nextRow = { ...row };
      delete nextRow[missingColumn];
      return nextRow;
    });
  }

  throw badRequest(fallbackMessage);
}

async function getAuthenticatedContext() {
  const typedClient = await createSupabaseServerClient();
  const supabase = typedClient as unknown as RuntimeSupabase;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw unauthorized();
  }

  if (!user) {
    throw unauthorized();
  }

  return {
    supabase,
    userId: user.id,
  };
}

const CATALOGUE_TABLE = "products";
const SUPPLIER_PRICES_TABLE = "supplier_pricebook";
const MATERIAL_INDICES_TABLE = "material_indices";

const BULK_CREATE_PRICES_RPC = "bulk_create_supplier_prices";
const BULK_UPSERT_INDICES_RPC = "bulk_upsert_material_indices";
const LINK_MAPPED_ROWS_RPC = "link_mapped_rows_to_catalogue";
const BULK_CREATE_PRICES_ATOMIC_MARKER_PREFIX = "__hex_atomic_price_import__";

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];

  const safeSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let start = 0; start < items.length; start += safeSize) {
    chunks.push(items.slice(start, start + safeSize));
  }

  return chunks;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function asSafeInteger(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }

  return fallback;
}

function rpcRecords(data: unknown): JsonRecord[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => asRecord(row))
    .filter((row): row is JsonRecord => row !== null);
}

function resolveProductId(input: {
  product_id?: string | null;
  catalogue_item_id?: string | null;
}) {
  return input.product_id ?? input.catalogue_item_id ?? null;
}

function resolveIndexCode(input: { index_code?: string | null; code?: string | null }) {
  return input.index_code ?? input.code ?? null;
}

function resolveIndexValue(input: { index_value?: number | null; value?: number | null }) {
  return input.index_value ?? input.value ?? null;
}

function resolveIndexDate(input: { index_date?: string | null; effective_date?: string | null }) {
  return input.index_date ?? input.effective_date ?? null;
}

function normalizeCatalogueRecord(row: JsonRecord): CatalogueItemRecord {
  const reference =
    typeof row.reference === "string"
      ? row.reference
      : typeof row.hex_code === "string"
        ? row.hex_code
        : null;

  return {
    ...(row as CatalogueItemRecord),
    reference,
    hex_code: reference,
  };
}

function normalizeSupplierPriceRecord(row: JsonRecord): SupplierPriceRecord {
  const productId =
    typeof row.product_id === "string"
      ? row.product_id
      : typeof row.catalogue_item_id === "string"
        ? row.catalogue_item_id
        : null;

  return {
    ...(row as SupplierPriceRecord),
    product_id: productId,
    catalogue_item_id: productId,
  };
}

function normalizeMaterialIndexRecord(row: JsonRecord): MaterialIndexRecord {
  const indexCode =
    typeof row.index_code === "string"
      ? row.index_code
      : typeof row.code === "string"
        ? row.code
        : null;
  const indexDate =
    typeof row.index_date === "string"
      ? row.index_date
      : typeof row.effective_date === "string"
        ? row.effective_date
        : null;
  const indexValue = asNumber(row.index_value) ?? asNumber(row.value);

  return {
    ...(row as MaterialIndexRecord),
    index_code: indexCode,
    code: indexCode,
    index_date: indexDate,
    effective_date: indexDate,
    index_value: indexValue,
    value: indexValue,
  };
}

export async function listCatalogueItems(input: CatalogueListQueryInput) {
  const { supabase } = await getAuthenticatedContext();

  const search = input.search?.trim();
  const safeSearch = search ? search.replace(/[%_,]/g, "") : "";

  const buildQuery = (excludeInactive: boolean) => {
    let query = supabase
      .from(CATALOGUE_TABLE)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(input.limit);

    if (excludeInactive) {
      query = query.eq("is_active", true);
    }

    if (safeSearch) {
      query = query.or(`reference.ilike.%${safeSearch}%,designation.ilike.%${safeSearch}%`);
    }

    return query;
  };

  let { data, error } = await buildQuery(!input.include_inactive);

  if (error && !input.include_inactive && extractMissingColumn(error) === "is_active") {
    const fallbackResult = await buildQuery(false);
    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le catalogue.");
  }

  const rows = (data ?? []).map((row) => normalizeCatalogueRecord((row ?? {}) as JsonRecord));

  return {
    items: rows,
  };
}

export async function listCataloguePage(input: CataloguePageQueryInput) {
  const { supabase } = await getAuthenticatedContext();
  const rpcInput = {
    p_q: input.q || null,
    p_materials: input.material,
    p_categories: input.category,
    p_units: input.unit,
    p_price_statuses: input.price_status,
    p_statuses: input.status,
    p_sort: input.sort,
    p_dir: input.dir,
    p_page: input.page,
    p_size: input.size,
  };

  const [pageResult, summaryResult] = await Promise.all([
    supabase.rpc("catalogue_products_page", rpcInput),
    supabase.rpc("catalogue_products_summary"),
  ]);

  if (pageResult.error) {
    throw mapSupabaseError(pageResult.error, "Impossible de charger la page du catalogue.");
  }
  if (summaryResult.error) {
    throw mapSupabaseError(summaryResult.error, "Impossible de charger les indicateurs du catalogue.");
  }

  const pageRows = rpcRecords(pageResult.data);
  let totalItems = asSafeInteger(pageRows[0]?.total_count);

  if (pageRows.length === 0 && input.page > 1) {
    const countProbe = await supabase.rpc("catalogue_products_page", {
      ...rpcInput,
      p_page: 1,
      p_size: 25,
    });
    if (countProbe.error) {
      throw mapSupabaseError(countProbe.error, "Impossible de verifier la pagination du catalogue.");
    }
    totalItems = asSafeInteger(rpcRecords(countProbe.data)[0]?.total_count);
  }

  const items = pageRows.map((row) => {
    const normalized = normalizeCatalogueRecord(row);
    return {
      ...normalized,
      _status: normalized.is_active === false ? "archived" : "active",
      _priceStatus: typeof row.price_status === "string" ? row.price_status : "none",
      _supplierPriceCount: asSafeInteger(row.supplier_price_count),
      _bestSupplierPriceCents:
        typeof row.best_supplier_price_cents === "number"
          ? row.best_supplier_price_cents
          : null,
      _bestSupplierName:
        typeof row.best_supplier_name === "string" ? row.best_supplier_name : null,
      _bestSupplierPriceUpdatedAt:
        typeof row.best_supplier_price_updated_at === "string"
          ? row.best_supplier_price_updated_at
          : null,
    };
  });

  const summary = rpcRecords(summaryResult.data)[0] ?? {};
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / input.size);

  return {
    items,
    pagination: {
      page: input.page,
      size: input.size,
      totalItems,
      totalPages,
    },
    counters: {
      active: asSafeInteger(summary.active_count),
      covered: asSafeInteger(summary.covered_count),
      withoutSupplierPrice: asSafeInteger(summary.without_supplier_price_count),
      stale: asSafeInteger(summary.stale_count),
    },
    facets: {
      materials: Array.isArray(summary.materials) ? summary.materials : [],
      categories: Array.isArray(summary.categories) ? summary.categories : [],
      units: Array.isArray(summary.units) ? summary.units : [],
    },
  };
}

export async function createCatalogueItem(input: CreateCatalogueItemInput) {
  const { supabase } = await getAuthenticatedContext();

  const reference = input.reference ?? input.hex_code;
  const payload: JsonRecord = {
    reference,
    designation: input.designation,
    unit_price_cents: input.unit_price_cents ?? 0,
    tax_rate_bp: input.tax_rate_bp,
    is_active: input.is_active,
  };

  const row = await insertSingleWithFallback(
    supabase,
    CATALOGUE_TABLE,
    payload,
    "Impossible de creer la ligne catalogue."
  );

  return {
    item: normalizeCatalogueRecord(row),
  };
}

export async function updateCatalogueItem(input: UpdateCatalogueItemInput) {
  const { supabase } = await getAuthenticatedContext();

  const hasReference =
    Object.prototype.hasOwnProperty.call(input.item, "reference") ||
    Object.prototype.hasOwnProperty.call(input.item, "hex_code");

  const payload: JsonRecord = {
    reference: hasReference ? input.item.reference ?? input.item.hex_code : undefined,
    designation: input.item.designation,
    unit_price_cents: input.item.unit_price_cents,
    tax_rate_bp: input.item.tax_rate_bp,
    is_active: input.item.is_active,
  };

  const row = await updateSingleWithFallback(
    supabase,
    CATALOGUE_TABLE,
    input.id,
    payload,
    "Impossible de mettre a jour la ligne catalogue."
  );

  return {
    item: normalizeCatalogueRecord(row),
  };
}

export async function deleteCatalogueItem(id: string) {
  const { supabase } = await getAuthenticatedContext();

  const { data, error } = await supabase
    .from(CATALOGUE_TABLE)
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer la ligne catalogue.");
  }

  if (!data) {
    throw notFound("Ligne catalogue introuvable.");
  }

  return {
    deleted_id: id,
  };
}

type MappedRowCandidate = {
  id: string;
  payload: JsonRecord;
  reference: string;
  designation: string;
};

function buildMappedRowCandidates(rows: Array<{ id: string; payload: unknown }>) {
  const candidates: MappedRowCandidate[] = [];

  for (const row of rows) {
    const payload = asRecord(row.payload);
    if (!payload) continue;

    const referenceRaw = payload.reference ?? payload.hex_code;
    const designationRaw = payload.designation;

    const referenceToken = normalizeToken(referenceRaw);
    const designationToken = normalizeToken(designationRaw);

    if (!referenceToken || !designationToken) continue;

    candidates.push({
      id: row.id,
      payload,
      reference:
        typeof referenceRaw === "string" ? referenceRaw.trim() : String(referenceRaw),
      designation:
        typeof designationRaw === "string"
          ? designationRaw.trim()
          : String(designationRaw),
    });
  }

  return candidates;
}

function indexCatalogueRows(rows: CatalogueItemRecord[]) {
  const byReference = new Map<string, CatalogueItemRecord[]>();
  const byDesignation = new Map<string, CatalogueItemRecord[]>();

  for (const row of rows) {
    const referenceToken = normalizeToken(row.reference ?? row.hex_code);
    if (referenceToken) {
      const current = byReference.get(referenceToken) ?? [];
      current.push(row);
      byReference.set(referenceToken, current);
    }

    const designationToken = normalizeToken(row.designation);
    if (designationToken) {
      const current = byDesignation.get(designationToken) ?? [];
      current.push(row);
      byDesignation.set(designationToken, current);
    }
  }

  return {
    byReference,
    byDesignation,
  };
}

function matchCatalogueItem(
  candidate: MappedRowCandidate,
  indexes: ReturnType<typeof indexCatalogueRows>
): {
  item: CatalogueItemRecord;
  matchType: "reference+designation" | "reference" | "designation";
} | null {
  const referenceToken = normalizeToken(candidate.reference);
  const designationToken = normalizeToken(candidate.designation);

  const referenceRows = indexes.byReference.get(referenceToken) ?? [];
  if (referenceRows.length > 0) {
    const exact = referenceRows.find(
      (row) => normalizeToken(row.designation) === designationToken
    );

    if (exact) {
      return { item: exact, matchType: "reference+designation" };
    }

    return {
      item: referenceRows[0],
      matchType: "reference",
    };
  }

  const designationRows = indexes.byDesignation.get(designationToken) ?? [];
  if (designationRows.length > 0) {
    return {
      item: designationRows[0],
      matchType: "designation",
    };
  }

  return null;
}

export async function linkMappedRowsToCatalogue(input: LinkMappedRowsInput) {
  const { supabase } = await getAuthenticatedContext();

  const { data: mappedRows, error: mappedRowsError } = await supabase
    .from("dpgf_rows_mapped")
    .select("id, payload")
    .eq("import_id", input.import_id)
    .order("created_at", { ascending: true })
    .limit(input.limit);

  if (mappedRowsError) {
    throw mapSupabaseError(mappedRowsError, "Impossible de charger les lignes mappees.");
  }

  const candidates = buildMappedRowCandidates(
    ((mappedRows ?? []) as Array<{ id: string; payload: unknown }>)
  );

  const uniqueReferences = Array.from(
    new Set(
      candidates
        .map((x) => x.reference.trim())
        .filter((value) => value.length > 0)
    )
  );
  const uniqueDesignations = Array.from(
    new Set(
      candidates
        .map((x) => x.designation.trim())
        .filter((value) => value.length > 0)
    )
  );

  const [catalogueByReference, catalogueByDesignation] = await Promise.all([
    uniqueReferences.length > 0
      ? supabase.from(CATALOGUE_TABLE).select("*").in("reference", uniqueReferences)
      : Promise.resolve({ data: [], error: null }),
    uniqueDesignations.length > 0
      ? supabase.from(CATALOGUE_TABLE).select("*").in("designation", uniqueDesignations)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (catalogueByReference.error) {
    throw mapSupabaseError(catalogueByReference.error, "Impossible de charger le catalogue.");
  }

  if (catalogueByDesignation.error) {
    throw mapSupabaseError(catalogueByDesignation.error, "Impossible de charger le catalogue.");
  }

  const allRowsMap = new Map<string, CatalogueItemRecord>();
  for (const row of (catalogueByReference.data ?? []) as JsonRecord[]) {
    const normalized = normalizeCatalogueRecord(row);
    allRowsMap.set(normalized.id, normalized);
  }
  for (const row of (catalogueByDesignation.data ?? []) as JsonRecord[]) {
    const normalized = normalizeCatalogueRecord(row);
    allRowsMap.set(normalized.id, normalized);
  }

  const knownRows = Array.from(allRowsMap.values());
  let indexes = indexCatalogueRows(knownRows);

  const rowsToCreate = new Map<string, { reference: string; designation: string }>();
  const preMatches = new Map<
    string,
    {
      item: CatalogueItemRecord;
      matchType: "reference+designation" | "reference" | "designation";
    }
  >();

  for (const candidate of candidates) {
    const match = matchCatalogueItem(candidate, indexes);

    if (match) {
      preMatches.set(candidate.id, match);
      continue;
    }

    if (!input.create_missing) continue;

    const key = normalizeToken(candidate.reference);
    if (rowsToCreate.has(key)) continue;
    rowsToCreate.set(key, {
      reference: candidate.reference,
      designation: candidate.designation,
    });
  }

  let createdRows: CatalogueItemRecord[] = [];

  if (rowsToCreate.size > 0 && !input.dry_run) {
    const payload = Array.from(rowsToCreate.values()).map((row) => ({
      reference: row.reference,
      designation: row.designation,
      unit_price_cents: 0,
      is_active: true,
    }));

    const inserted = await insertManyWithFallback(
      supabase,
      CATALOGUE_TABLE,
      payload,
      "Impossible de creer les lignes catalogue depuis les lignes mappees."
    );

    createdRows = inserted.map((row) => normalizeCatalogueRecord(row));

    for (const row of createdRows) {
      allRowsMap.set(row.id, row);
    }

    indexes = indexCatalogueRows(Array.from(allRowsMap.values()));
  }

  const links: Array<{
    mapped_row_id: string;
    product_id: string;
    catalogue_item_id: string;
    match_type: "reference+designation" | "reference" | "designation";
  }> = [];

  for (const candidate of candidates) {
    const existingMatch = preMatches.get(candidate.id) ?? matchCatalogueItem(candidate, indexes);
    if (!existingMatch) continue;

    links.push({
      mapped_row_id: candidate.id,
      product_id: existingMatch.item.id,
      catalogue_item_id: existingMatch.item.id,
      match_type: existingMatch.matchType,
    });
  }

  if (!input.dry_run && links.length > 0) {
    const rpcPayload = links.map((link) => ({
      import_id: input.import_id,
      mapped_row_id: link.mapped_row_id,
      product_id: link.product_id,
      status: "linked",
      message: null,
    }));

    const { error } = await supabase.rpc(LINK_MAPPED_ROWS_RPC, {
      link_rows: rpcPayload,
    });

    if (error && !isFunctionMissingError(error)) {
      throw mapSupabaseError(error, "Impossible de persister les liaisons catalogue.");
    }

    if (error && isFunctionMissingError(error)) {
      const { error: fallbackError } = await supabase
        .from("dpgf_catalogue_links")
        .upsert(rpcPayload, { onConflict: "tenant_id,mapped_row_id" })
        .select("id");

      if (fallbackError) {
        throw mapSupabaseError(fallbackError, "Impossible de persister les liaisons catalogue.");
      }
    }
  }

  // T-13: Batch payload updates in chunks of 100 instead of 1 per row
  if (input.update_payload && !input.dry_run && links.length > 0) {
    const payloadByRowId = new Map(candidates.map((candidate) => [candidate.id, candidate.payload]));

    const linkChunks = chunkItems(links, 100);

    for (const chunk of linkChunks) {
      await Promise.all(
        chunk.map(async (link) => {
          const currentPayload = payloadByRowId.get(link.mapped_row_id);
          if (!currentPayload) return;

          const nextPayload = {
            ...currentPayload,
            product_id: link.product_id,
            catalogue_item_id: link.catalogue_item_id,
            product_match_type: link.match_type,
            catalogue_match_type: link.match_type,
          };

          const { error } = await supabase
            .from("dpgf_rows_mapped")
            .update({ payload: nextPayload })
            .eq("id", link.mapped_row_id);

          if (error) {
            throw mapSupabaseError(error, "Impossible de lier les lignes mappees au catalogue.");
          }
        })
      );
    }
  }

  return {
    import_id: input.import_id,
    scanned_rows: candidates.length,
    linked_count: links.length,
    created_catalogue_count: createdRows.length,
    unmatched_count: Math.max(candidates.length - links.length, 0),
    dry_run: input.dry_run,
    links,
  };
}

export async function listSupplierPrices(input: PricesListQueryInput) {
  const { supabase } = await getAuthenticatedContext();
  const productId = resolveProductId(input);

  let query = supabase
    .from(SUPPLIER_PRICES_TABLE)
    .select("*")
    .order("valid_from", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(input.limit);

  if (input.supplier_id) {
    query = query.eq("supplier_id", input.supplier_id);
  }

  if (productId) {
    query = query.eq("product_id", productId);
  }

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les prix fournisseur.");
  }

  return {
    items: (data ?? []).map((row) => normalizeSupplierPriceRecord((row ?? {}) as JsonRecord)),
  };
}

export async function listSupplierPricesPage(input: PricesPageQueryInput) {
  const { supabase } = await getAuthenticatedContext();
  const rpcInput = {
    p_q: input.q || null,
    p_freshness: input.freshness,
    p_product_id: input.product_id,
    p_supplier_id: input.supplier_id,
    p_sort: input.sort,
    p_dir: input.dir,
    p_page: input.page,
    p_size: input.size,
  };

  const [pageResult, summaryResult] = await Promise.all([
    supabase.rpc("supplier_prices_page", rpcInput),
    supabase.rpc("supplier_prices_summary", {
      p_product_id: input.product_id,
      p_supplier_id: input.supplier_id,
    }),
  ]);

  if (pageResult.error) {
    throw mapSupabaseError(pageResult.error, "Impossible de charger la page des prix fournisseur.");
  }
  if (summaryResult.error) {
    throw mapSupabaseError(summaryResult.error, "Impossible de charger les indicateurs des prix.");
  }

  const pageRows = rpcRecords(pageResult.data);
  let totalItems = asSafeInteger(pageRows[0]?.total_count);

  if (pageRows.length === 0 && input.page > 1) {
    const countProbe = await supabase.rpc("supplier_prices_page", {
      ...rpcInput,
      p_page: 1,
      p_size: 25,
    });
    if (countProbe.error) {
      throw mapSupabaseError(countProbe.error, "Impossible de verifier la pagination des prix.");
    }
    totalItems = asSafeInteger(rpcRecords(countProbe.data)[0]?.total_count);
  }

  const items = pageRows.map((row) => ({
    ...normalizeSupplierPriceRecord(row),
    _supplierName:
      typeof row.supplier_name === "string" ? row.supplier_name : String(row.supplier_id ?? ""),
    _productName:
      typeof row.product_name === "string" ? row.product_name : String(row.product_id ?? ""),
    _productReference:
      typeof row.product_reference === "string" ? row.product_reference : null,
    _freshnessLevel:
      row.freshness === "aging" || row.freshness === "stale" ? row.freshness : "fresh",
    _ageDays: asSafeInteger(row.age_days),
  }));

  const summary = rpcRecords(summaryResult.data)[0] ?? {};
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / input.size);

  return {
    items,
    pagination: {
      page: input.page,
      size: input.size,
      totalItems,
      totalPages,
    },
    counters: {
      total: asSafeInteger(summary.total_count),
      fresh: asSafeInteger(summary.fresh_count),
      aging: asSafeInteger(summary.aging_count),
      stale: asSafeInteger(summary.stale_count),
      uniqueSuppliers: asSafeInteger(summary.unique_suppliers_count),
    },
  };
}

export async function listPriceLookups(input: PriceLookupsQueryInput) {
  const { supabase } = await getAuthenticatedContext();
  const kinds = input.kind === "all" ? (["supplier", "product"] as const) : [input.kind];

  const results = await Promise.all(
    kinds.map((kind) =>
      supabase.rpc("price_lookup_options", {
        p_kind: kind,
        p_q: input.q || null,
        p_selected_id: input.selected_id,
        p_limit: input.limit,
      })
    )
  );

  for (const result of results) {
    if (result.error) {
      throw mapSupabaseError(result.error, "Impossible de charger les suggestions du referentiel.");
    }
  }

  const rows = results.flatMap((result) => rpcRecords(result.data));
  return {
    suppliers: rows
      .filter((row) => row.kind === "supplier")
      .map((row) => ({ id: String(row.id), name: String(row.label ?? "") })),
    products: rows
      .filter((row) => row.kind === "product")
      .map((row) => ({
        id: String(row.id),
        designation: String(row.label ?? ""),
        reference: typeof row.reference === "string" ? row.reference : null,
      })),
  };
}

export async function createSupplierPrice(input: CreateSupplierPriceInput) {
  const { supabase } = await getAuthenticatedContext();
  const productId = resolveProductId(input);

  if (!productId) {
    throw badRequest("Le champ product_id est requis.");
  }

  const row = await insertSingleWithFallback(
    supabase,
    SUPPLIER_PRICES_TABLE,
    {
      supplier_id: input.supplier_id,
      product_id: productId,
      supplier_sku: input.supplier_sku,
      unit: input.unit ?? undefined,
      min_quantity: input.min_quantity ?? undefined,
      unit_price_cents: input.unit_price_cents,
      currency: input.currency,
      valid_from: input.valid_from ?? undefined,
      valid_to: input.valid_to,
      is_active: input.is_active,
      source_import_id: input.source_import_id,
      source_mapped_row_id: input.source_mapped_row_id,
      notes: input.notes ?? input.source,
    },
    "Impossible de creer le prix fournisseur."
  );

  return {
    item: normalizeSupplierPriceRecord(row),
  };
}

export async function updateSupplierPrice(input: UpdateSupplierPriceInput) {
  const { supabase } = await getAuthenticatedContext();
  const hasProductId =
    Object.prototype.hasOwnProperty.call(input.item, "product_id") ||
    Object.prototype.hasOwnProperty.call(input.item, "catalogue_item_id");
  const hasValidFrom = Object.prototype.hasOwnProperty.call(input.item, "valid_from");
  const hasValidTo = Object.prototype.hasOwnProperty.call(input.item, "valid_to");

  const row = await updateSingleWithFallback(
    supabase,
    SUPPLIER_PRICES_TABLE,
    input.id,
    {
      supplier_id: input.item.supplier_id,
      product_id: hasProductId ? resolveProductId(input.item) : undefined,
      supplier_sku: input.item.supplier_sku,
      unit: input.item.unit ?? undefined,
      min_quantity: input.item.min_quantity ?? undefined,
      unit_price_cents: input.item.unit_price_cents,
      currency: input.item.currency,
      valid_from: hasValidFrom ? input.item.valid_from ?? undefined : undefined,
      valid_to: hasValidTo ? input.item.valid_to ?? null : undefined,
      is_active: input.item.is_active,
      source_import_id: input.item.source_import_id,
      source_mapped_row_id: input.item.source_mapped_row_id,
      notes: input.item.notes ?? input.item.source,
    },
    "Impossible de mettre a jour le prix fournisseur."
  );

  return {
    item: normalizeSupplierPriceRecord(row),
  };
}

export async function deleteSupplierPrice(id: string) {
  const { supabase } = await getAuthenticatedContext();

  const { data, error } = await supabase
    .from(SUPPLIER_PRICES_TABLE)
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer le prix fournisseur.");
  }

  if (!data) {
    throw notFound("Prix fournisseur introuvable.");
  }

  return {
    deleted_id: id,
  };
}

type BulkCreateSupplierPricesMode = "rpc" | "fallback-insert";

function buildBulkCreateSupplierPricesPayload(input: BulkCreateSupplierPricesInput): JsonRecord[] {
  return input.map((item, index) => {
    const productId = resolveProductId(item);
    if (!productId) {
      throw badRequest(`Le champ product_id est requis pour la ligne ${index + 1}.`);
    }

    return {
      supplier_id: item.supplier_id,
      product_id: productId,
      supplier_sku: item.supplier_sku,
      unit: item.unit ?? undefined,
      min_quantity: item.min_quantity ?? undefined,
      unit_price_cents: item.unit_price_cents,
      currency: item.currency,
      valid_from: item.valid_from ?? currentDateIso(),
      valid_to: item.valid_to,
      is_active: item.is_active,
      source_import_id: item.source_import_id,
      source_mapped_row_id: item.source_mapped_row_id,
      notes: item.notes ?? item.source,
      external_ref: item.external_ref,
    };
  });
}

async function bulkCreateSupplierPricesWithSupabase(
  supabase: RuntimeSupabase,
  input: BulkCreateSupplierPricesInput
): Promise<{ created_count: number; mode: BulkCreateSupplierPricesMode }> {
  const rpcPayload = buildBulkCreateSupplierPricesPayload(input);
  const fallbackMessage = "Impossible de creer les prix fournisseur en masse.";

  const { data, error } = await supabase.rpc(BULK_CREATE_PRICES_RPC, {
    price_rows: rpcPayload,
  });

  if (!error) {
    const createdCount = typeof data === "number" ? data : input.length;
    return {
      created_count: createdCount,
      mode: "rpc",
    };
  }

  if (!isFunctionMissingError(error)) {
    throw mapSupabaseError(error, fallbackMessage);
  }

  const insertedRows = await insertManyWithFallback(
    supabase,
    SUPPLIER_PRICES_TABLE,
    rpcPayload,
    fallbackMessage
  );

  return {
    created_count: insertedRows.length,
    mode: "fallback-insert",
  };
}

export async function bulkCreateSupplierPrices(input: BulkCreateSupplierPricesInput) {
  const { supabase } = await getAuthenticatedContext();
  return bulkCreateSupplierPricesWithSupabase(supabase, input);
}

export async function bulkCreateSupplierPricesAtomic(input: BulkCreateSupplierPricesAtomicInput) {
  const { supabase } = await getAuthenticatedContext();

  const hasManualNotes = input.items.some((item) => item.notes != null || item.source != null);
  if (hasManualNotes) {
    throw badRequest(
      "L'action bulk-create-atomic ne supporte pas les champs notes/source.",
      undefined,
      "ATOMIC_IMPORT_UNSUPPORTED_FIELDS"
    );
  }

  const marker = `${BULK_CREATE_PRICES_ATOMIC_MARKER_PREFIX}:${randomUUID()}`;
  const itemsWithMarker: BulkCreateSupplierPricesInput = input.items.map((item) => ({
    ...item,
    source: null,
    notes: marker,
  }));
  const batches = chunkItems(itemsWithMarker, input.batch_size);

  let totalCreated = 0;
  const responseModes = new Set<BulkCreateSupplierPricesMode>();

  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];

      try {
        const result = await bulkCreateSupplierPricesWithSupabase(supabase, batch);
        totalCreated += result.created_count;
        responseModes.add(result.mode);
      } catch (batchError) {
        const details =
          batchError instanceof Error
            ? batchError.message
            : "Erreur inconnue pendant le bulk-create.";
        throw new Error(`Echec du lot ${batchIndex + 1}/${batches.length}: ${details}`);
      }
    }
  } catch (importError) {
    const { error: rollbackError } = await supabase
      .from(SUPPLIER_PRICES_TABLE)
      .delete()
      .eq("notes", marker);

    if (rollbackError) {
      throw internalError(
        "Echec de l'import et du rollback automatique des lots precedents.",
        {
          import_error: importError instanceof Error ? importError.message : "Erreur inconnue.",
          rollback_error: rollbackError,
        },
        "ATOMIC_IMPORT_ROLLBACK_FAILED"
      );
    }

    const details = importError instanceof Error ? importError.message : "Erreur inconnue.";
    throw badRequest(`Import annule: ${details}`, undefined, "ATOMIC_IMPORT_FAILED");
  }

  const { error: cleanupError } = await supabase
    .from(SUPPLIER_PRICES_TABLE)
    .update({ notes: null })
    .eq("notes", marker);

  if (cleanupError) {
    console.error("Failed to clear atomic import marker", cleanupError);
  }

  const modeSummary = Array.from(responseModes).join("+");

  return {
    created_count: totalCreated,
    mode: `atomic-${modeSummary || "rpc"}`,
  };
}

export async function listMaterialIndices(input: IndicesListQueryInput) {
  const { supabase } = await getAuthenticatedContext();

  let query = supabase
    .from(MATERIAL_INDICES_TABLE)
    .select("*")
    .order("index_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(input.limit);

  const search = input.search?.trim();
  if (search) {
    const safe = search.replace(/[%_,]/g, "");
    query = query.or(`index_code.ilike.%${safe}%,label.ilike.%${safe}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les indices matiere.");
  }

  return {
    items: (data ?? []).map((row) => normalizeMaterialIndexRecord((row ?? {}) as JsonRecord)),
  };
}

export async function createMaterialIndex(input: CreateMaterialIndexInput) {
  const { supabase } = await getAuthenticatedContext();
  const indexCode = resolveIndexCode(input);
  const indexValue = resolveIndexValue(input);

  if (!indexCode) {
    throw badRequest("Le champ index_code est requis.");
  }

  if (indexValue == null) {
    throw badRequest("Le champ index_value est requis.");
  }

  const row = await insertSingleWithFallback(
    supabase,
    MATERIAL_INDICES_TABLE,
    {
      index_code: indexCode,
      label: input.label,
      index_value: indexValue,
      index_date: resolveIndexDate(input) ?? currentDateIso(),
      unit: input.unit ?? undefined,
      source: input.source,
      metadata: input.metadata,
    },
    "Impossible de creer l'indice matiere."
  );

  return {
    item: normalizeMaterialIndexRecord(row),
  };
}

export async function updateMaterialIndex(input: UpdateMaterialIndexInput) {
  const { supabase } = await getAuthenticatedContext();
  const hasIndexCode =
    Object.prototype.hasOwnProperty.call(input.item, "index_code") ||
    Object.prototype.hasOwnProperty.call(input.item, "code");
  const hasIndexValue =
    Object.prototype.hasOwnProperty.call(input.item, "index_value") ||
    Object.prototype.hasOwnProperty.call(input.item, "value");
  const hasIndexDate =
    Object.prototype.hasOwnProperty.call(input.item, "index_date") ||
    Object.prototype.hasOwnProperty.call(input.item, "effective_date");

  const row = await updateSingleWithFallback(
    supabase,
    MATERIAL_INDICES_TABLE,
    input.id,
    {
      index_code: hasIndexCode ? resolveIndexCode(input.item) : undefined,
      label: input.item.label,
      index_value: hasIndexValue ? resolveIndexValue(input.item) : undefined,
      index_date: hasIndexDate ? resolveIndexDate(input.item) : undefined,
      unit: input.item.unit ?? undefined,
      source: input.item.source,
      metadata: input.item.metadata,
    },
    "Impossible de mettre a jour l'indice matiere."
  );

  return {
    item: normalizeMaterialIndexRecord(row),
  };
}

export async function deleteMaterialIndex(id: string) {
  const { supabase } = await getAuthenticatedContext();

  const { data, error } = await supabase
    .from(MATERIAL_INDICES_TABLE)
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer l'indice matiere.");
  }

  if (!data) {
    throw notFound("Indice matiere introuvable.");
  }

  return {
    deleted_id: id,
  };
}

export async function bulkUpsertMaterialIndices(input: BulkUpsertMaterialIndicesInput) {
  const { supabase } = await getAuthenticatedContext();

  const rpcPayload = input.map((item, index) => {
    const indexCode = resolveIndexCode(item);
    const indexValue = resolveIndexValue(item);

    if (!indexCode) {
      throw badRequest(`Le champ index_code est requis pour la ligne ${index + 1}.`);
    }

    if (indexValue == null) {
      throw badRequest(`Le champ index_value est requis pour la ligne ${index + 1}.`);
    }

    return {
      index_code: indexCode,
      label: item.label,
      index_value: indexValue,
      index_date: resolveIndexDate(item) ?? currentDateIso(),
      unit: item.unit ?? undefined,
      source: item.source,
      metadata: item.metadata,
      external_ref: item.external_ref,
    };
  });

  const { data, error } = await supabase.rpc(BULK_UPSERT_INDICES_RPC, {
    index_rows: rpcPayload,
  });

  if (!error) {
    const upsertedCount = typeof data === "number" ? data : input.length;
    return {
      upserted_count: upsertedCount,
      mode: "rpc" as const,
    };
  }

  if (!isFunctionMissingError(error)) {
    throw mapSupabaseError(error, "Impossible de synchroniser les indices en masse.");
  }

  const fallbackRows = rpcPayload.map((item) => ({
    index_code: item.index_code,
    label: item.label,
    index_value: item.index_value,
    index_date: item.index_date,
    unit: item.unit,
    source: item.source,
    metadata: item.metadata,
  }));

  const { data: upserted, error: upsertError } = await supabase
    .from(MATERIAL_INDICES_TABLE)
    .upsert(fallbackRows, {
      onConflict: "tenant_id,index_code,index_date",
    })
    .select("id");

  if (upsertError) {
    throw mapSupabaseError(upsertError, "Impossible de synchroniser les indices en masse.");
  }

  return {
    upserted_count: (upserted ?? []).length,
    mode: "fallback-upsert" as const,
  };
}

export async function resolvePriceImportSuggestions(
  input: ResolvePriceImportSuggestionsInput
): Promise<{ suggestions: PriceImportSuggestion[] }> {
  const { supabase } = await getAuthenticatedContext();
  const suggestions: PriceImportSuggestion[] = [];

  for (const supplierInput of input.unknownSuppliers) {
    const token = safeIlikeToken(supplierInput);
    if (!token) continue;

    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("name", `%${token}%`)
      .limit(10);

    if (error) {
      throw mapSupabaseError(error, "Impossible de resoudre les fournisseurs inconnus.");
    }

    const matches = ((data ?? []) as Array<{ id: string; name: string }>)
      .map((entry) => ({
        id: entry.id,
        value: entry.name,
        confidence: scoreSuggestionMatch(supplierInput, entry.name),
      }))
      .filter((entry) => entry.confidence > 0.2)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 3);

    suggestions.push({
      type: "supplier",
      input: supplierInput,
      matches,
    });
  }

  for (const productInput of input.unknownProducts) {
    const token = safeIlikeToken(productInput);
    if (!token) continue;

    const { data, error } = await supabase
      .from("products")
      .select("id, reference, designation")
      .or(`reference.ilike.%${token}%,designation.ilike.%${token}%`)
      .limit(10);

    if (error) {
      throw mapSupabaseError(error, "Impossible de resoudre les produits inconnus.");
    }

    const matches = ((data ?? []) as Array<{ id: string; reference?: string | null; designation: string }>)
      .map((entry) => {
        const reference = typeof entry.reference === "string" && entry.reference.trim() ? entry.reference : null;
        const bestValue = reference ?? entry.designation;
        const confidence = Math.max(
          scoreSuggestionMatch(productInput, bestValue),
          scoreSuggestionMatch(productInput, entry.designation)
        );
        return {
          id: entry.id,
          value: bestValue,
          confidence,
        };
      })
      .filter((entry) => entry.confidence > 0.2)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 3);

    suggestions.push({
      type: "product",
      input: productInput,
      matches,
    });
  }

  return { suggestions };
}

export async function createMissingPriceImportEntities(
  input: CreateMissingPriceImportEntitiesInput
): Promise<{
  createdSuppliers: Array<{ id: string; name: string }>;
  createdProducts: Array<{ id: string; reference: string; designation: string }>;
}> {
  const { supabase } = await getAuthenticatedContext();

  const createdSuppliers: Array<{ id: string; name: string }> = [];
  const createdProducts: Array<{ id: string; reference: string; designation: string }> = [];

  for (const supplierNameRaw of input.suppliersToCreate) {
    const supplierName = supplierNameRaw.trim();
    if (!supplierName) continue;
    const escapedSupplierName = escapeIlikePattern(supplierName);

    const { data: existingSuppliers, error: existingSuppliersError } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("name", escapedSupplierName)
      .limit(5);

    if (existingSuppliersError) {
      throw mapSupabaseError(
        existingSuppliersError,
        "Impossible de verifier les fournisseurs existants."
      );
    }

    const exactSupplier = ((existingSuppliers ?? []) as Array<{ id: string; name: string }>).find(
      (supplier) => normalizeSuggestionToken(supplier.name) === normalizeSuggestionToken(supplierName)
    );

    if (exactSupplier) continue;

    const { data: insertedSupplier, error: insertSupplierError } = await supabase
      .from("suppliers")
      .insert({
        name: supplierName,
        is_active: true,
      })
      .select("id, name")
      .single();

    if (insertSupplierError) {
      throw mapSupabaseError(insertSupplierError, "Impossible de creer un fournisseur manquant.");
    }

    if (insertedSupplier) {
      createdSuppliers.push(insertedSupplier as { id: string; name: string });
    }
  }

  for (const productReferenceRaw of input.productsToCreate) {
    const productReference = productReferenceRaw.trim();
    if (!productReference) continue;
    const escapedProductReference = escapeIlikePattern(productReference);

    const { data: existingProducts, error: existingProductsError } = await supabase
      .from("products")
      .select("id, reference")
      .ilike("reference", escapedProductReference)
      .limit(5);

    if (existingProductsError) {
      throw mapSupabaseError(existingProductsError, "Impossible de verifier les produits existants.");
    }

    const exactProduct = ((existingProducts ?? []) as Array<{ id: string; reference?: string | null }>).find(
      (product) =>
        normalizeSuggestionToken(product.reference ?? "") ===
        normalizeSuggestionToken(productReference)
    );

    if (exactProduct) continue;

    const { data: insertedProduct, error: insertProductError } = await supabase
      .from("products")
      .insert({
        reference: productReference,
        designation: productReference,
        unit_price_cents: 0,
        tax_rate_bp: 2000,
        is_active: true,
      })
      .select("id, reference, designation")
      .single();

    if (insertProductError) {
      throw mapSupabaseError(insertProductError, "Impossible de creer un produit manquant.");
    }

    if (insertedProduct) {
      createdProducts.push({
        id: String((insertedProduct as { id: unknown }).id),
        reference: String((insertedProduct as { reference: unknown }).reference),
        designation: String((insertedProduct as { designation: unknown }).designation),
      });
    }
  }

  return {
    createdSuppliers,
    createdProducts,
  };
}

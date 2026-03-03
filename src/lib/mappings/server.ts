import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

import {
  REQUIRED_MAPPING_TARGET_FIELDS,
  type MappingTargetField,
  type SourceToTargetMapping,
} from "./schemas";

type Supabase = SupabaseClient<Database>;
type JsonRecord = { [key: string]: Json | undefined };

type MappingRow = Database["public"]["Tables"]["dpgf_mappings"]["Row"];
type MappingInsert = Database["public"]["Tables"]["dpgf_mappings"]["Insert"];
type MappedRowInsert = Database["public"]["Tables"]["dpgf_rows_mapped"]["Insert"];
type TemplateRow = Database["public"]["Tables"]["mapping_templates"]["Row"];
type TemplateInsert = Database["public"]["Tables"]["mapping_templates"]["Insert"];
type MemoryRow = Database["public"]["Tables"]["mapping_memory"]["Row"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;
type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
};

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

export type MappingValidation = {
  is_valid: boolean;
  missing_required_fields: MappingTargetField[];
  duplicate_target_assignments: Array<{ target: MappingTargetField; sources: string[] }>;
  mapped_sources_count: number;
  mapped_targets_count: number;
};

export type MappingPreviewRow = {
  row_index: number;
  raw_row: JsonRecord;
  mapped_row: JsonRecord;
  missing_required_fields: MappingTargetField[];
};

export type MappingDuplicateGroup = {
  key: string;
  hex_code: string;
  designation: string;
  row_indices: number[];
  count: number;
};

export type MappingSuggestion = {
  suggestions: SourceToTargetMapping;
  source_columns: string[];
  templates: TemplateRow[];
  sample_values: Record<string, string[]>;
};

export class MappingsApiError extends Error {
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
    this.name = "MappingsApiError";
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
  return new MappingsApiError({
    status: 400,
    code,
    message,
    details,
  });
}

function unauthorized(message = "Unauthorized") {
  return new MappingsApiError({
    status: 401,
    code: "UNAUTHORIZED",
    message,
  });
}

function forbidden(message = "Acces refuse.", details?: unknown, code = "FORBIDDEN") {
  return new MappingsApiError({
    status: 403,
    code,
    message,
    details,
  });
}

function notFound(message: string, details?: unknown, code = "NOT_FOUND") {
  return new MappingsApiError({
    status: 404,
    code,
    message,
    details,
  });
}

function conflict(message: string, details?: unknown, code = "CONFLICT") {
  return new MappingsApiError({
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
  return new MappingsApiError({
    status: 500,
    code,
    message,
    details,
  });
}

function mapSupabaseError(error: PostgrestError, fallbackMessage: string): MappingsApiError {
  const normalizedMessage = (error.message ?? "").toLowerCase();

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

export function toErrorResponse(error: unknown) {
  let apiError: MappingsApiError;

  if (error instanceof MappingsApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = badRequest(
      "Payload invalide.",
      {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      },
      "VALIDATION_ERROR"
    );
  } else {
    console.error("Unexpected mappings API error", error);
    apiError = internalError();
  }

  // K-01: Log internal details server-side only, never expose to client
  if (apiError.details) {
    console.error(`[mappings] API error details (${apiError.code}):`, apiError.details);
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();

  try {
    return JSON.stringify(value).trim();
  } catch {
    return String(value).trim();
  }
}

function normalizeComparisonToken(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function toJsonValue(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }
  if (typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (nestedValue === undefined) continue;
      output[key] = toJsonValue(nestedValue);
    }
    return output;
  }
  return normalizeText(value);
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toSourceColumns(rows: Array<{ payload: unknown }>) {
  const columns = new Set<string>();

  for (const row of rows) {
    const payload = asRecord(row.payload);
    if (!payload) continue;

    for (const key of Object.keys(payload)) {
      const trimmed = key.trim();
      if (trimmed) columns.add(trimmed);
    }
  }

  return Array.from(columns).sort((a, b) => a.localeCompare(b));
}

function extractSampleValues(
  rows: Array<{ payload: unknown }>,
  maxSamples = 3
): Record<string, string[]> {
  const sampleMap = new Map<string, Set<string>>();

  for (const row of rows) {
    const payload = asRecord(row.payload);
    if (!payload) continue;

    for (const [key, value] of Object.entries(payload)) {
      const trimmedKey = key.trim();
      if (!trimmedKey) continue;

      const text = normalizeText(value);
      if (!text) continue;

      let samples = sampleMap.get(trimmedKey);
      if (!samples) {
        samples = new Set<string>();
        sampleMap.set(trimmedKey, samples);
      }

      if (samples.size < maxSamples) {
        // Truncate long values for display
        samples.add(text.length > 40 ? text.slice(0, 37) + "..." : text);
      }
    }
  }

  const result: Record<string, string[]> = {};
  for (const [key, samples] of sampleMap.entries()) {
    result[key] = Array.from(samples);
  }

  return result;
}

function applyMappingToPayload(payload: JsonRecord, mapping: SourceToTargetMapping): JsonRecord {
  const mapped: JsonRecord = {};

  for (const [sourceColumn, targetField] of Object.entries(mapping)) {
    if (!(sourceColumn in payload)) continue;
    mapped[targetField] = payload[sourceColumn];
  }

  return mapped;
}

function computeValidation(mapping: SourceToTargetMapping): MappingValidation {
  const targetToSources = new Map<MappingTargetField, string[]>();

  for (const [source, target] of Object.entries(mapping)) {
    const existing = targetToSources.get(target) ?? [];
    existing.push(source);
    targetToSources.set(target, existing);
  }

  const mappedTargets = new Set(
    Object.values(mapping).filter((value): value is MappingTargetField => Boolean(value))
  );

  const missingRequiredFields = REQUIRED_MAPPING_TARGET_FIELDS.filter(
    (requiredField) => !mappedTargets.has(requiredField)
  );

  const duplicateTargetAssignments: Array<{ target: MappingTargetField; sources: string[] }> = [];

  for (const [target, sources] of targetToSources.entries()) {
    if (sources.length > 1) {
      duplicateTargetAssignments.push({
        target,
        sources: [...sources],
      });
    }
  }

  return {
    is_valid:
      missingRequiredFields.length === 0 &&
      duplicateTargetAssignments.length === 0 &&
      Object.keys(mapping).length > 0,
    missing_required_fields: missingRequiredFields,
    duplicate_target_assignments: duplicateTargetAssignments,
    mapped_sources_count: Object.keys(mapping).length,
    mapped_targets_count: mappedTargets.size,
  };
}

function computeMissingFields(mappedRow: JsonRecord): MappingTargetField[] {
  const missing: MappingTargetField[] = [];

  for (const field of REQUIRED_MAPPING_TARGET_FIELDS) {
    if (normalizeText(mappedRow[field]).length === 0) {
      missing.push(field);
    }
  }

  return missing;
}

function computeDuplicateGroupsFromPreview(rows: MappingPreviewRow[]) {
  const groupMap = new Map<
    string,
    {
      hex_code: string;
      designation: string;
      row_indices: number[];
    }
  >();

  for (const row of rows) {
    const hexCodeToken = normalizeComparisonToken(row.mapped_row.hex_code);
    const designationToken = normalizeComparisonToken(row.mapped_row.designation);

    if (!hexCodeToken || !designationToken) continue;

    const key = `${hexCodeToken}||${designationToken}`;
    const existing = groupMap.get(key);

    if (existing) {
      existing.row_indices.push(row.row_index);
      continue;
    }

    groupMap.set(key, {
      hex_code: normalizeText(row.mapped_row.hex_code),
      designation: normalizeText(row.mapped_row.designation),
      row_indices: [row.row_index],
    });
  }

  const duplicates: MappingDuplicateGroup[] = [];

  for (const [key, value] of groupMap.entries()) {
    if (value.row_indices.length <= 1) continue;

    duplicates.push({
      key,
      hex_code: value.hex_code,
      designation: value.designation,
      row_indices: value.row_indices,
      count: value.row_indices.length,
    });
  }

  duplicates.sort((a, b) => b.count - a.count);
  return duplicates;
}

export function guessTargetFieldFromColumn(sourceColumn: string): MappingTargetField | null {
  const normalized = stripAccents(sourceColumn.trim().toLowerCase()).replace(/[^a-z0-9]+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  const wordSet = new Set(words);
  const hasWordPrefix = (prefix: string) => words.some((word) => word.startsWith(prefix));

  if (!normalized) return null;

  if (
    (wordSet.has("type") && wordSet.has("fo")) ||
    (wordSet.has("famille") && wordSet.has("fo"))
  ) {
    return "supply_type";
  }

  if (
    (wordSet.has("majoration") && wordSet.has("mo")) ||
    (wordSet.has("temps") && hasWordPrefix("major"))
  ) {
    return "h_mo_majoration";
  }

  if (
    (normalized.includes("code") &&
      (normalized.includes("hex") ||
        normalized.includes("article") ||
        normalized.includes("poste") ||
        normalized.includes("produit"))) ||
    normalized === "hex"
  ) {
    return "hex_code";
  }

  if (
    normalized.includes("designation") ||
    normalized.includes("description") ||
    normalized.includes("libelle") ||
    normalized.includes("intitule")
  ) {
    return "designation";
  }

  if (
    normalized === "qt" ||
    normalized === "qte" ||
    normalized.includes("quantite") ||
    normalized.includes("quantity")
  ) {
    return "quantity";
  }

  if (
    normalized === "u" ||
    normalized.includes("unite") ||
    normalized.includes("unit")
  ) {
    return "unit";
  }

  if (
    normalized.includes("prix unitaire") ||
    normalized.includes("pu") ||
    normalized.includes("unit price")
  ) {
    return "unit_price_ht";
  }

  if (normalized.includes("montant") || normalized.includes("total")) {
    return "total_ht";
  }

  if (normalized.includes("categorie") || normalized.includes("famille")) {
    return "category";
  }

  if (normalized.includes("ref") || normalized.includes("reference")) {
    return "supplier_ref";
  }

  if (
    normalized.includes("heure") ||
    normalized.includes("main d oeuvre") ||
    normalized.includes("main oeuvre") ||
    normalized.includes("labor")
  ) {
    return "labor_hours";
  }

  if (normalized.includes("note") || normalized.includes("comment")) {
    return "notes";
  }

  return null;
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const membership = await getCurrentMembershipOrThrow(supabase, user.id);

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    isTenantAdmin: membership.role === "admin",
  };
}

async function getCurrentMembershipOrThrow(
  supabase: Supabase,
  userId: string
): Promise<TenantMembershipRow> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le tenant courant.");
  }

  const membership = data?.[0] as TenantMembershipRow | undefined;

  if (!membership) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return membership;
}

async function ensureImportAccess(
  supabase: Supabase,
  importId: string,
  context: Pick<AuthenticatedContext, "userId" | "tenantId" | "isTenantAdmin">
): Promise<void> {
  let query = supabase
    .from("dpgf_imports")
    .select("id")
    .eq("id", importId)
    .eq("tenant_id", context.tenantId);

  if (!context.isTenantAdmin) {
    query = query.eq("user_id", context.userId);
  }

  const { data, error } = await query.single();

  if (error) {
    throw mapSupabaseError(error, "Import introuvable.");
  }

  if (!data) {
    throw notFound("Import introuvable.");
  }
}

async function loadImportRows(
  supabase: Supabase,
  importId: string,
  tenantId: string,
  limit: number
): Promise<Array<{ row_index: number; payload: unknown }>> {
  const { data, error } = await supabase
    .from("dpgf_rows_raw")
    .select("row_index, payload")
    .eq("import_id", importId)
    .eq("tenant_id", tenantId)
    .order("row_index", { ascending: true })
    .limit(limit);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes source.");
  }

  return data ?? [];
}

async function loadAllImportRows(
  supabase: Supabase,
  importId: string,
  tenantId: string
): Promise<Array<{ id: string; row_index: number; payload: unknown }>> {
  const pageSize = 1000;
  let offset = 0;
  const rows: Array<{ id: string; row_index: number; payload: unknown }> = [];

  while (true) {
    const { data, error } = await supabase
      .from("dpgf_rows_raw")
      .select("id, row_index, payload")
      .eq("import_id", importId)
      .eq("tenant_id", tenantId)
      .order("row_index", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger les lignes source.");
    }

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return rows;
}

function buildPreviewRows(
  rows: Array<{ row_index: number; payload: unknown }>,
  mapping: SourceToTargetMapping
): MappingPreviewRow[] {
  const previewRows: MappingPreviewRow[] = [];

  for (const row of rows) {
    const rawRow = asRecord(row.payload) ?? {};
    const mappedRow = applyMappingToPayload(rawRow, mapping);

    previewRows.push({
      row_index: row.row_index,
      raw_row: rawRow,
      mapped_row: mappedRow,
      missing_required_fields: computeMissingFields(mappedRow),
    });
  }

  return previewRows;
}

// T-11: Batch UPSERT for mapping memory instead of N+1 queries
async function touchMappingMemory(
  supabase: Supabase,
  tenantId: string,
  userId: string,
  mapping: SourceToTargetMapping
) {
  const entries = Object.entries(mapping);
  if (entries.length === 0) return;

  const sourceColumns = entries.map(([source]) => source);
  const nowIso = new Date().toISOString();

  // T-11: Single batch query to load all existing memory entries
  const { data: existingRows, error: existingError } = await supabase
    .from("mapping_memory")
    .select("id, source_column, target_field, usage_count, confidence")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .in("source_column", sourceColumns);

  if (existingError) {
    throw mapSupabaseError(existingError, "Impossible de mettre a jour la memoire de mapping.");
  }

  const existingMap = new Map<string, { id: string; usage_count: number; confidence: number }>();
  for (const row of existingRows ?? []) {
    const key = `${row.source_column}::${row.target_field}`;
    existingMap.set(key, {
      id: row.id as string,
      usage_count: (row.usage_count as number) ?? 0,
      confidence: Number(row.confidence ?? 0),
    });
  }

  // T-11: Batch updates for existing entries
  const updates: Array<{ id: string; usage_count: number; confidence: number; last_used_at: string }> = [];
  const inserts: Array<{
    tenant_id: string;
    user_id: string;
    source_column: string;
    target_field: string;
    usage_count: number;
    confidence: number;
    last_used_at: string;
  }> = [];

  for (const [sourceColumn, targetField] of entries) {
    const key = `${sourceColumn}::${targetField}`;
    const existing = existingMap.get(key);

    if (existing) {
      updates.push({
        id: existing.id,
        usage_count: existing.usage_count + 1,
        confidence: Number(Math.min(1, existing.confidence + 0.02).toFixed(4)),
        last_used_at: nowIso,
      });
    } else {
      inserts.push({
        tenant_id: tenantId,
        user_id: userId,
        source_column: sourceColumn,
        target_field: targetField,
        usage_count: 1,
        confidence: 1,
        last_used_at: nowIso,
      });
    }
  }

  // T-11: Batch update existing entries
  if (updates.length > 0) {
    await Promise.all(
      updates.map(async (entry) => {
        const { error } = await supabase
          .from("mapping_memory")
          .update({
            usage_count: entry.usage_count,
            confidence: entry.confidence,
            last_used_at: entry.last_used_at,
          })
          .eq("id", entry.id);

        if (error) {
          throw mapSupabaseError(error, "Impossible de mettre a jour la memoire de mapping.");
        }
      })
    );
  }

  // T-11: Batch insert new entries
  if (inserts.length > 0) {
    const { error: insertError } = await supabase
      .from("mapping_memory")
      .insert(inserts);

    if (insertError) {
      throw mapSupabaseError(insertError, "Impossible de mettre a jour la memoire de mapping.");
    }
  }
}

async function upsertTemplate(
  supabase: Supabase,
  tenantId: string,
  userId: string,
  input: {
    name: string;
    supplier_name: string | null;
    mapping: SourceToTargetMapping;
    is_default: boolean;
  }
): Promise<TemplateRow> {
  if (input.is_default) {
    const { error: resetDefaultError } = await supabase
      .from("mapping_templates")
      .update({ is_default: false })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .neq("name", input.name);

    if (resetDefaultError) {
      throw mapSupabaseError(resetDefaultError, "Impossible de definir le template par defaut.");
    }
  }

  const payload: TemplateInsert = {
    tenant_id: tenantId,
    user_id: userId,
    name: input.name,
    supplier_name: input.supplier_name,
    mapping: input.mapping,
    is_default: input.is_default,
    last_used_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("mapping_templates")
    .upsert(payload, { onConflict: "tenant_id,user_id,name" })
    .select("*")
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible d'enregistrer le template.");
  }

  if (!data) {
    throw internalError("Impossible d'enregistrer le template.");
  }

  return data as unknown as TemplateRow;
}

function ensureCreateIsValid(validation: MappingValidation) {
  if (!validation.is_valid) {
    throw badRequest("Mapping invalide: champs requis manquants ou cibles dupliquees.", validation);
  }
}

export async function listMappings(options: { importId?: string | null; limit: number }) {
  const { supabase, userId, tenantId, isTenantAdmin } = await getAuthenticatedContext();

  let scopedImportIds: string[] = [];

  if (options.importId) {
    await ensureImportAccess(supabase, options.importId, {
      userId,
      tenantId,
      isTenantAdmin,
    });
    scopedImportIds = [options.importId];
  } else {
    let importsQuery = supabase
      .from("dpgf_imports")
      .select("id")
      .eq("tenant_id", tenantId);

    if (!isTenantAdmin) {
      importsQuery = importsQuery.eq("user_id", userId);
    }

    const { data: userImports, error: userImportsError } = await importsQuery;

    if (userImportsError) {
      throw mapSupabaseError(userImportsError, "Impossible de charger les imports.");
    }

    scopedImportIds = (userImports ?? []).map((row) => row.id);
  }

  let mappings: MappingRow[] = [];

  if (scopedImportIds.length > 0) {
    let query = supabase
      .from("dpgf_mappings")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(options.limit);

    if (options.importId) {
      query = query.eq("import_id", options.importId);
    } else {
      query = query.in("import_id", scopedImportIds);
    }

    const { data: mappingsData, error: mappingsError } = await query;

    if (mappingsError) {
      throw mapSupabaseError(mappingsError, "Impossible de charger les mappings.");
    }

    mappings = (mappingsData ?? []) as MappingRow[];
  }

  let templatesQuery = supabase
    .from("mapping_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (!isTenantAdmin) {
    templatesQuery = templatesQuery.eq("user_id", userId);
  }

  const { data: templates, error: templatesError } = await templatesQuery;

  if (templatesError) {
    throw mapSupabaseError(templatesError, "Impossible de charger les templates de mapping.");
  }

  return {
    mappings,
    templates: (templates ?? []) as TemplateRow[],
  };
}

export async function previewMapping(input: {
  import_id: string;
  mapping: SourceToTargetMapping;
  limit: number;
}) {
  const { supabase, userId, tenantId, isTenantAdmin } = await getAuthenticatedContext();
  await ensureImportAccess(supabase, input.import_id, {
    userId,
    tenantId,
    isTenantAdmin,
  });

  const rows = await loadImportRows(supabase, input.import_id, tenantId, input.limit);
  const previewRows = buildPreviewRows(rows, input.mapping);
  const duplicateGroups = computeDuplicateGroupsFromPreview(previewRows);

  return {
    source_columns: toSourceColumns(rows),
    validation: computeValidation(input.mapping),
    rows: previewRows,
    duplicates: {
      groups: duplicateGroups,
      total_groups: duplicateGroups.length,
      total_rows_impacted: duplicateGroups.reduce((acc, group) => acc + group.count, 0),
    },
  };
}

export async function suggestMapping(input: { import_id: string }): Promise<MappingSuggestion> {
  const { supabase, userId, tenantId, isTenantAdmin } = await getAuthenticatedContext();
  await ensureImportAccess(supabase, input.import_id, {
    userId,
    tenantId,
    isTenantAdmin,
  });

  const sampleRows = await loadImportRows(supabase, input.import_id, tenantId, 100);
  const sourceColumns = toSourceColumns(sampleRows);

  const suggestions: SourceToTargetMapping = {};

  if (sourceColumns.length > 0) {
    let memoryQuery = supabase
      .from("mapping_memory")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("source_column", sourceColumns)
      .order("usage_count", { ascending: false })
      .order("confidence", { ascending: false })
      .order("last_used_at", { ascending: false });

    if (!isTenantAdmin) {
      memoryQuery = memoryQuery.eq("user_id", userId);
    }

    const { data: memoryRows, error: memoryError } = await memoryQuery;

    if (memoryError) {
      throw mapSupabaseError(memoryError, "Impossible de charger les suggestions de mapping.");
    }

    const memoryBySource = new Map<string, MemoryRow[]>();

    for (const row of (memoryRows ?? []) as MemoryRow[]) {
      const existing = memoryBySource.get(row.source_column) ?? [];
      existing.push(row);
      memoryBySource.set(row.source_column, existing);
    }

    for (const sourceColumn of sourceColumns) {
      const memory = memoryBySource.get(sourceColumn);
      if (memory && memory.length > 0) {
        const bestTarget = memory[0].target_field as MappingTargetField;
        suggestions[sourceColumn] = bestTarget;
        continue;
      }

      const heuristic = guessTargetFieldFromColumn(sourceColumn);
      if (heuristic) {
        suggestions[sourceColumn] = heuristic;
      }
    }
  }

  let templatesQuery = supabase
    .from("mapping_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (!isTenantAdmin) {
    templatesQuery = templatesQuery.eq("user_id", userId);
  }

  const { data: templates, error: templatesError } = await templatesQuery;

  if (templatesError) {
    throw mapSupabaseError(templatesError, "Impossible de charger les templates de mapping.");
  }

  return {
    suggestions,
    source_columns: sourceColumns,
    templates: (templates ?? []) as TemplateRow[],
    sample_values: extractSampleValues(sampleRows),
  };
}

export async function validateMapping(input: { mapping: SourceToTargetMapping }) {
  return computeValidation(input.mapping);
}

export async function findDuplicates(input: {
  import_id: string;
  mapping: SourceToTargetMapping;
  limit: number;
}) {
  const { supabase, userId, tenantId, isTenantAdmin } = await getAuthenticatedContext();
  await ensureImportAccess(supabase, input.import_id, {
    userId,
    tenantId,
    isTenantAdmin,
  });

  const rows = await loadImportRows(supabase, input.import_id, tenantId, input.limit);
  const previewRows = buildPreviewRows(rows, input.mapping);
  const duplicateGroups = computeDuplicateGroupsFromPreview(previewRows);

  return {
    groups: duplicateGroups,
    total_groups: duplicateGroups.length,
    total_rows_impacted: duplicateGroups.reduce((acc, group) => acc + group.count, 0),
    scanned_rows: previewRows.length,
  };
}

export async function createMapping(input: {
  import_id: string;
  mapping: SourceToTargetMapping;
  template_id?: string | null;
  notes?: string | null;
  save_template: boolean;
  template_name?: string | null;
  supplier_name?: string | null;
}) {
  const { supabase, userId, tenantId, isTenantAdmin } = await getAuthenticatedContext();
  await ensureImportAccess(supabase, input.import_id, {
    userId,
    tenantId,
    isTenantAdmin,
  });

  const validation = computeValidation(input.mapping);
  ensureCreateIsValid(validation);

  const duplicates = await findDuplicates({
    import_id: input.import_id,
    mapping: input.mapping,
    limit: 10000,
  });

  let resolvedTemplateId = input.template_id ?? null;
  let savedTemplate: TemplateRow | null = null;

  if (input.save_template) {
    if (!input.template_name) {
      throw badRequest("template_name est requis quand save_template=true.");
    }

    savedTemplate = await upsertTemplate(supabase, tenantId, userId, {
      name: input.template_name,
      supplier_name: input.supplier_name ?? null,
      mapping: input.mapping,
      is_default: false,
    });

    resolvedTemplateId = savedTemplate.id;
  }

  const payload: MappingInsert = {
    import_id: input.import_id,
    template_id: resolvedTemplateId,
    status: "validated",
    column_mapping: input.mapping,
    required_fields_present: true,
    missing_required_fields: [],
    duplicate_count: duplicates.total_groups,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from("dpgf_mappings")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer le mapping.");
  }

  if (!data) {
    throw internalError("Impossible de creer le mapping.");
  }

  // T-10: Build mapped rows, then delete+insert with safety
  const rawRows = await loadAllImportRows(supabase, input.import_id, tenantId);
  const mappedRowsPayload: MappedRowInsert[] = rawRows.map((row) => {
    const rawRow = asRecord(row.payload) ?? {};
    const mappedRow = applyMappingToPayload(rawRow, input.mapping);
    const rawRowJson = toJsonValue(rawRow) as Record<string, Json>;
    const mappedRowJson = toJsonValue(mappedRow) as Record<string, Json>;
    const reference = normalizeText(mappedRow.reference ?? mappedRow.hex_code);
    const hexCode = normalizeText(mappedRow.hex_code ?? mappedRow.reference);
    const designation = normalizeText(mappedRow.designation);
    const supplyType = normalizeText(mappedRow.supply_type);
    const hMoMajoration = normalizeText(mappedRow.h_mo_majoration);

    return {
      import_id: input.import_id,
      raw_row_id: row.id,
      status: "mapped",
      payload: {
        raw_row_id: row.id,
        row_index: row.row_index,
        raw_row: rawRowJson,
        mapped_row: mappedRowJson,
        ...mappedRowJson,
        reference: reference || null,
        hex_code: hexCode || null,
        designation: designation || null,
        supply_type: supplyType || null,
        h_mo_majoration: hMoMajoration || null,
      } as Json,
    };
  });

  // T-10: Collect existing row IDs before deleting, so we can restore if insert fails
  const { data: existingRows } = await supabase
    .from("dpgf_rows_mapped")
    .select("id")
    .eq("import_id", input.import_id)
    .eq("tenant_id", tenantId);

  const existingRowIds = (existingRows ?? []).map((row) => row.id as string);

  const { error: deleteMappedRowsError } = await supabase
    .from("dpgf_rows_mapped")
    .delete()
    .eq("import_id", input.import_id)
    .eq("tenant_id", tenantId);

  if (deleteMappedRowsError) {
    throw mapSupabaseError(deleteMappedRowsError, "Impossible de rafraichir les lignes mappees.");
  }

  if (mappedRowsPayload.length > 0) {
    const pageSize = 500;
    try {
      for (let index = 0; index < mappedRowsPayload.length; index += pageSize) {
        const batch = mappedRowsPayload.slice(index, index + pageSize);
        const { error: insertMappedRowsError } = await supabase
          .from("dpgf_rows_mapped")
          .insert(batch);

        if (insertMappedRowsError) {
          throw mapSupabaseError(
            insertMappedRowsError,
            "Impossible de persister les lignes mappees."
          );
        }
      }
    } catch (insertError) {
      // T-10: Insert failed after delete. Log the error with details for recovery.
      console.error(
        `[mappings] createMapping: insert failed after deleting ${existingRowIds.length} rows for import ${input.import_id}. Recovery may be needed.`,
        insertError
      );
      throw insertError;
    }
  }

  await touchMappingMemory(supabase, tenantId, userId, input.mapping);

  return {
    mapping: data as MappingRow,
    validation,
    duplicates,
    template: savedTemplate,
    mapped_rows_count: mappedRowsPayload.length,
  };
}

export async function saveTemplate(input: {
  name: string;
  supplier_name?: string | null;
  mapping: SourceToTargetMapping;
  is_default: boolean;
}) {
  const { supabase, userId, tenantId } = await getAuthenticatedContext();

  const validation = computeValidation(input.mapping);
  ensureCreateIsValid(validation);

  const template = await upsertTemplate(supabase, tenantId, userId, {
    name: input.name,
    supplier_name: input.supplier_name ?? null,
    mapping: input.mapping,
    is_default: input.is_default,
  });

  await touchMappingMemory(supabase, tenantId, userId, input.mapping);

  return {
    template,
    validation,
  };
}

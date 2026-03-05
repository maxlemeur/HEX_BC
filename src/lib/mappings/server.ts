import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { cache } from "react";
import { ZodError } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

import {
  REQUIRED_MAPPING_TARGET_FIELDS,
  mappingTargetFieldSchema,
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
  confidence_by_source: Record<string, MappingSuggestionConfidence>;
  template_exact_match: MappingTemplateExactMatch | null;
  auto_validation: MappingAutoValidation;
};

export type MappingConfidenceBand = "high" | "medium" | "low";
export type MappingSuggestionOrigin = "template" | "memory" | "heuristic";

export type MappingSuggestionConfidence = {
  target_field: MappingTargetField;
  score: number;
  band: MappingConfidenceBand;
  origin: MappingSuggestionOrigin;
  usage_count: number | null;
  memory_confidence: number | null;
};

export type MappingTemplateExactMatch = {
  id: string;
  name: string;
  supplier_name: string | null;
  score: number;
};

export type MappingAutoValidation = {
  can_auto_validate: boolean;
  threshold: number;
  required_fields: MappingTargetField[];
  missing_required_fields: MappingTargetField[];
  low_confidence_required_fields: MappingTargetField[];
};

type MappingSuggestionCandidate = {
  source_column: string;
  target_field: MappingTargetField;
  score: number;
  origin: MappingSuggestionOrigin;
  usage_count: number | null;
  memory_confidence: number | null;
};

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;
const MEMORY_CONFIDENCE_WEIGHT = 0.4;
const MEMORY_USAGE_WEIGHT = 0.6;
const MEMORY_USAGE_LOG_BASE = Math.log(6);
const MAPPING_TARGET_FIELD_SET = new Set<MappingTargetField>(mappingTargetFieldSchema.options);

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

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Number(clampScore(value).toFixed(4));
}

function getConfidenceBand(score: number): MappingConfidenceBand {
  if (score > HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

function normalizeSourceColumnKey(sourceColumn: string): string {
  return stripAccents(sourceColumn.trim().toLowerCase()).replace(/\s+/g, " ");
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

function normalizeTemplateMapping(value: unknown): SourceToTargetMapping {
  const record = asRecord(value);
  if (!record) return {};

  const normalized: SourceToTargetMapping = {};

  for (const [sourceColumn, targetField] of Object.entries(record)) {
    const source = sourceColumn.trim();
    const target = typeof targetField === "string" ? targetField.trim() : "";
    if (!source || !target) continue;
    if (!MAPPING_TARGET_FIELD_SET.has(target as MappingTargetField)) continue;

    normalized[source] = target as MappingTargetField;
  }

  return normalized;
}

function remapMappingToDetectedSourceColumns(
  mapping: SourceToTargetMapping,
  sourceColumns: string[]
): SourceToTargetMapping | null {
  if (sourceColumns.length === 0) return {};
  if (Object.keys(mapping).length === 0) return {};

  const sourceColumnsByNormalizedKey = new Map<string, string[]>();
  for (const sourceColumn of sourceColumns) {
    const normalizedKey = normalizeSourceColumnKey(sourceColumn);
    const columnsForKey = sourceColumnsByNormalizedKey.get(normalizedKey);
    if (columnsForKey) {
      columnsForKey.push(sourceColumn);
    } else {
      sourceColumnsByNormalizedKey.set(normalizedKey, [sourceColumn]);
    }
  }

  const consumedSourceColumns = new Set<string>();
  const output: SourceToTargetMapping = {};

  for (const [sourceColumn, targetField] of Object.entries(mapping)) {
    if (!sourceColumns.includes(sourceColumn) || consumedSourceColumns.has(sourceColumn)) {
      continue;
    }
    output[sourceColumn] = targetField;
    consumedSourceColumns.add(sourceColumn);
  }

  for (const [sourceColumn, targetField] of Object.entries(mapping)) {
    if (sourceColumn in output) continue;

    const normalizedKey = normalizeSourceColumnKey(sourceColumn);
    const candidates = (sourceColumnsByNormalizedKey.get(normalizedKey) ?? []).filter(
      (candidate) => !consumedSourceColumns.has(candidate)
    );

    if (candidates.length !== 1) {
      return null;
    }

    const [actualSourceColumn] = candidates;
    output[actualSourceColumn] = targetField;
    consumedSourceColumns.add(actualSourceColumn);
  }

  return output;
}

function findTemplateExactMatch(
  sourceColumns: string[],
  templates: TemplateRow[]
): { template: TemplateRow; mapping: SourceToTargetMapping } | null {
  if (sourceColumns.length === 0 || templates.length === 0) return null;

  const expectedCounts = new Map<string, number>();
  for (const sourceColumn of sourceColumns) {
    const normalizedKey = normalizeSourceColumnKey(sourceColumn);
    expectedCounts.set(normalizedKey, (expectedCounts.get(normalizedKey) ?? 0) + 1);
  }

  for (const template of templates) {
    const templateMapping = normalizeTemplateMapping(template.mapping);
    const templateColumns = Object.keys(templateMapping);
    if (templateColumns.length !== sourceColumns.length) continue;

    const templateCounts = new Map<string, number>();
    for (const templateColumn of templateColumns) {
      const normalizedKey = normalizeSourceColumnKey(templateColumn);
      templateCounts.set(normalizedKey, (templateCounts.get(normalizedKey) ?? 0) + 1);
    }

    if (templateCounts.size !== expectedCounts.size) continue;

    let hasSameNormalizedColumns = true;
    for (const [expectedKey, expectedCount] of expectedCounts.entries()) {
      if ((templateCounts.get(expectedKey) ?? 0) !== expectedCount) {
        hasSameNormalizedColumns = false;
        break;
      }
    }
    if (!hasSameNormalizedColumns) continue;

    const remapped = remapMappingToDetectedSourceColumns(templateMapping, sourceColumns);
    if (!remapped || Object.keys(remapped).length !== sourceColumns.length) continue;

    return {
      template,
      mapping: remapped,
    };
  }

  return null;
}

function getCandidateOriginPriority(origin: MappingSuggestionOrigin): number {
  if (origin === "template") return 3;
  if (origin === "memory") return 2;
  return 1;
}

function computeMemorySuggestionScore(memoryRow: Pick<MemoryRow, "usage_count" | "confidence">) {
  const usageCount = Math.max(0, Number(memoryRow.usage_count ?? 0));
  const confidence = clampScore(Number(memoryRow.confidence ?? 0));

  const usageSignal =
    MEMORY_USAGE_LOG_BASE > 0
      ? Math.min(1, Math.log(usageCount + 1) / MEMORY_USAGE_LOG_BASE)
      : 0;

  const score =
    MEMORY_CONFIDENCE_WEIGHT * confidence +
    MEMORY_USAGE_WEIGHT * usageSignal;

  return {
    score: roundScore(score),
    usage_count: usageCount,
    memory_confidence: roundScore(confidence),
  };
}

function chooseBestCandidatePerTarget(
  candidatesBySource: Map<string, MappingSuggestionCandidate>
) {
  const sortedCandidates = Array.from(candidatesBySource.values()).sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;

    const priorityDiff =
      getCandidateOriginPriority(right.origin) -
      getCandidateOriginPriority(left.origin);
    if (priorityDiff !== 0) return priorityDiff;

    if ((left.usage_count ?? 0) !== (right.usage_count ?? 0)) {
      return (right.usage_count ?? 0) - (left.usage_count ?? 0);
    }

    if ((left.memory_confidence ?? 0) !== (right.memory_confidence ?? 0)) {
      return (right.memory_confidence ?? 0) - (left.memory_confidence ?? 0);
    }

    return left.source_column.localeCompare(right.source_column);
  });

  const selectedBySource = new Map<string, MappingSuggestionCandidate>();
  const usedTargets = new Set<MappingTargetField>();

  for (const candidate of sortedCandidates) {
    if (usedTargets.has(candidate.target_field)) continue;
    usedTargets.add(candidate.target_field);
    selectedBySource.set(candidate.source_column, candidate);
  }

  return selectedBySource;
}

function buildAutoValidationSummary(
  suggestions: SourceToTargetMapping,
  confidenceBySource: Record<string, MappingSuggestionConfidence>
): MappingAutoValidation {
  const missingRequiredFields: MappingTargetField[] = [];
  const lowConfidenceRequiredFields: MappingTargetField[] = [];

  for (const requiredField of REQUIRED_MAPPING_TARGET_FIELDS) {
    const sourceEntry = Object.entries(suggestions).find(
      ([, targetField]) => targetField === requiredField
    );

    if (!sourceEntry) {
      missingRequiredFields.push(requiredField);
      continue;
    }

    const [sourceColumn] = sourceEntry;
    const metadata = confidenceBySource[sourceColumn];
    const score = metadata?.score ?? 0;
    if (score <= HIGH_CONFIDENCE_THRESHOLD) {
      lowConfidenceRequiredFields.push(requiredField);
    }
  }

  return {
    can_auto_validate:
      missingRequiredFields.length === 0 &&
      lowConfidenceRequiredFields.length === 0,
    threshold: HIGH_CONFIDENCE_THRESHOLD,
    required_fields: [...REQUIRED_MAPPING_TARGET_FIELDS],
    missing_required_fields: missingRequiredFields,
    low_confidence_required_fields: lowConfidenceRequiredFields,
  };
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

function filterMappingToSourceColumns(
  mapping: SourceToTargetMapping,
  sourceColumns: string[]
): SourceToTargetMapping {
  if (sourceColumns.length === 0 || Object.keys(mapping).length === 0) {
    return mapping;
  }

  const sourceSet = new Set(sourceColumns);
  const filteredMapping: SourceToTargetMapping = {};
  let removedEntries = false;

  for (const [sourceColumn, targetField] of Object.entries(mapping)) {
    if (!sourceSet.has(sourceColumn)) {
      removedEntries = true;
      continue;
    }

    filteredMapping[sourceColumn] = targetField;
  }

  return removedEntries ? filteredMapping : mapping;
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

function guessTargetFieldWithScore(
  sourceColumn: string
): { target: MappingTargetField; score: number } | null {
  const normalized = stripAccents(sourceColumn.trim().toLowerCase()).replace(/[^a-z0-9]+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  const wordSet = new Set(words);
  const hasWordPrefix = (prefix: string) => words.some((word) => word.startsWith(prefix));

  if (!normalized) return null;

  if (
    (wordSet.has("type") && wordSet.has("fo")) ||
    (wordSet.has("famille") && wordSet.has("fo"))
  ) {
    return { target: "supply_type", score: 0.58 };
  }

  if (
    (wordSet.has("majoration") && wordSet.has("mo")) ||
    (wordSet.has("temps") && hasWordPrefix("major"))
  ) {
    return { target: "h_mo_majoration", score: 0.57 };
  }

  if (
    (normalized.includes("code") &&
      (normalized.includes("hex") ||
        normalized.includes("article") ||
        normalized.includes("poste") ||
        normalized.includes("produit"))) ||
    normalized === "hex"
  ) {
    return { target: "hex_code", score: normalized === "hex" ? 0.58 : 0.56 };
  }

  if (
    normalized.includes("designation") ||
    normalized.includes("description") ||
    normalized.includes("libelle") ||
    normalized.includes("intitule")
  ) {
    return { target: "designation", score: 0.56 };
  }

  if (
    normalized === "qt" ||
    normalized === "qte" ||
    normalized.includes("quantite") ||
    normalized.includes("quantity")
  ) {
    return {
      target: "quantity",
      score: normalized === "qt" || normalized === "qte" ? 0.58 : 0.56,
    };
  }

  if (
    normalized === "u" ||
    normalized.includes("unite") ||
    normalized.includes("unit")
  ) {
    return { target: "unit", score: normalized === "u" ? 0.55 : 0.52 };
  }

  if (
    normalized.includes("prix unitaire") ||
    wordSet.has("pu") ||
    normalized.includes("unit price")
  ) {
    return { target: "unit_price_ht", score: wordSet.has("pu") ? 0.58 : 0.55 };
  }

  if (normalized.includes("montant") || normalized.includes("total")) {
    return { target: "total_ht", score: 0.54 };
  }

  if (normalized.includes("categorie") || normalized.includes("famille")) {
    return { target: "category", score: 0.5 };
  }

  if (normalized.includes("ref") || normalized.includes("reference")) {
    return { target: "supplier_ref", score: 0.45 };
  }

  if (
    normalized.includes("heure") ||
    normalized.includes("main d oeuvre") ||
    normalized.includes("main oeuvre") ||
    normalized.includes("labor")
  ) {
    return { target: "labor_hours", score: 0.53 };
  }

  if (normalized.includes("note") || normalized.includes("comment")) {
    return { target: "notes", score: 0.45 };
  }

  return null;
}

export function guessTargetFieldFromColumn(sourceColumn: string): MappingTargetField | null {
  return guessTargetFieldWithScore(sourceColumn)?.target ?? null;
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

const loadMappingTemplatesForSuggest = cache(
  async (
    supabase: Supabase,
    tenantId: string,
    userId: string,
    isTenantAdmin: boolean
  ): Promise<TemplateRow[]> => {
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
      throw mapSupabaseError(
        templatesError,
        "Impossible de charger les templates de mapping."
      );
    }

    return (templates ?? []) as TemplateRow[];
  }
);

const loadMappingMemoryForSuggest = cache(
  async (
    supabase: Supabase,
    tenantId: string,
    userId: string,
    isTenantAdmin: boolean,
    sourceColumnsCacheKey: string
  ): Promise<MemoryRow[]> => {
    const sourceColumns = JSON.parse(sourceColumnsCacheKey) as string[];
    if (!Array.isArray(sourceColumns) || sourceColumns.length === 0) {
      return [];
    }

    let memoryQuery = supabase
      .from("mapping_memory")
      .select("*")
      // T-11: Single batch query
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
      throw mapSupabaseError(
        memoryError,
        "Impossible de charger les suggestions de mapping."
      );
    }

    return (memoryRows ?? []) as MemoryRow[];
  }
);

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

  const payload: Array<{
    tenant_id: string;
    user_id: string;
    source_column: string;
    target_field: string;
  }> = [];

  for (const [sourceColumn, targetField] of entries) {
    payload.push({
      tenant_id: tenantId,
      user_id: userId,
      source_column: sourceColumn,
      target_field: targetField,
    });
  }

  // T-11: Batch update
  const { error } = await supabase.rpc("upsert_mapping_memory_bulk", {
    p_entries: payload,
  });

  if (error) {
    // Non-blocking: log warning instead of throwing — the RPC may not be deployed yet
    console.warn(
      "[mappings] touchMappingMemory: upsert_mapping_memory_bulk failed, skipping.",
      error.message
    );
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
  const sourceColumns = toSourceColumns(rows);
  const scopedMapping = filterMappingToSourceColumns(input.mapping, sourceColumns);
  const previewRows = buildPreviewRows(rows, scopedMapping);
  const duplicateGroups = computeDuplicateGroupsFromPreview(previewRows);

  return {
    source_columns: sourceColumns,
    validation: computeValidation(scopedMapping),
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
  const sourceColumnsCacheKey = JSON.stringify(
    [...sourceColumns].sort((left, right) => left.localeCompare(right))
  );

  const [memoryRows, templates] = await Promise.all([
    loadMappingMemoryForSuggest(
      supabase,
      tenantId,
      userId,
      isTenantAdmin,
      sourceColumnsCacheKey
    ),
    loadMappingTemplatesForSuggest(supabase, tenantId, userId, isTenantAdmin),
  ]);

  const candidatesBySource = new Map<string, MappingSuggestionCandidate>();
  const exactTemplateMatch = findTemplateExactMatch(sourceColumns, templates);

  if (exactTemplateMatch) {
    for (const [sourceColumn, targetField] of Object.entries(exactTemplateMatch.mapping)) {
      candidatesBySource.set(sourceColumn, {
        source_column: sourceColumn,
        target_field: targetField,
        score: 1,
        origin: "template",
        usage_count: null,
        memory_confidence: null,
      });
    }
  } else if (sourceColumns.length > 0) {
    const memoryByNormalizedSource = new Map<string, MemoryRow[]>();

    for (const memoryRow of memoryRows) {
      const normalizedSource = normalizeSourceColumnKey(memoryRow.source_column);
      const rowsForSource = memoryByNormalizedSource.get(normalizedSource) ?? [];
      rowsForSource.push(memoryRow);
      memoryByNormalizedSource.set(normalizedSource, rowsForSource);
    }

    for (const sourceColumn of sourceColumns) {
      const normalizedSource = normalizeSourceColumnKey(sourceColumn);
      const memoryCandidates = memoryByNormalizedSource.get(normalizedSource) ?? [];

      let bestMemoryCandidate: MappingSuggestionCandidate | null = null;

      for (const memoryCandidate of memoryCandidates) {
        const targetField = memoryCandidate.target_field as MappingTargetField;
        if (!MAPPING_TARGET_FIELD_SET.has(targetField)) continue;

        const computedScore = computeMemorySuggestionScore(memoryCandidate);
        const candidate: MappingSuggestionCandidate = {
          source_column: sourceColumn,
          target_field: targetField,
          score: computedScore.score,
          origin: "memory",
          usage_count: computedScore.usage_count,
          memory_confidence: computedScore.memory_confidence,
        };

        if (
          !bestMemoryCandidate ||
          candidate.score > bestMemoryCandidate.score ||
          (candidate.score === bestMemoryCandidate.score &&
            (candidate.usage_count ?? 0) > (bestMemoryCandidate.usage_count ?? 0)) ||
          (candidate.score === bestMemoryCandidate.score &&
            (candidate.usage_count ?? 0) === (bestMemoryCandidate.usage_count ?? 0) &&
            (candidate.memory_confidence ?? 0) >
              (bestMemoryCandidate.memory_confidence ?? 0))
        ) {
          bestMemoryCandidate = candidate;
        }
      }

      if (bestMemoryCandidate) {
        candidatesBySource.set(sourceColumn, bestMemoryCandidate);
        continue;
      }

      const heuristicSuggestion = guessTargetFieldWithScore(sourceColumn);
      if (!heuristicSuggestion) continue;

      candidatesBySource.set(sourceColumn, {
        source_column: sourceColumn,
        target_field: heuristicSuggestion.target,
        score: roundScore(heuristicSuggestion.score),
        origin: "heuristic",
        usage_count: null,
        memory_confidence: null,
      });
    }
  }

  const selectedCandidates = chooseBestCandidatePerTarget(candidatesBySource);
  const suggestions: SourceToTargetMapping = {};
  const confidenceBySource: Record<string, MappingSuggestionConfidence> = {};

  for (const candidate of selectedCandidates.values()) {
    suggestions[candidate.source_column] = candidate.target_field;
    confidenceBySource[candidate.source_column] = {
      target_field: candidate.target_field,
      score: candidate.score,
      band: getConfidenceBand(candidate.score),
      origin: candidate.origin,
      usage_count: candidate.usage_count,
      memory_confidence: candidate.memory_confidence,
    };
  }

  const autoValidation = buildAutoValidationSummary(suggestions, confidenceBySource);

  return {
    suggestions,
    source_columns: sourceColumns,
    templates,
    sample_values: extractSampleValues(sampleRows),
    confidence_by_source: confidenceBySource,
    template_exact_match: exactTemplateMatch
      ? {
          id: exactTemplateMatch.template.id,
          name: exactTemplateMatch.template.name,
          supplier_name: exactTemplateMatch.template.supplier_name,
          score: 1,
        }
      : null,
    auto_validation: autoValidation,
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
  const sourceColumns = toSourceColumns(rows);
  const scopedMapping = filterMappingToSourceColumns(input.mapping, sourceColumns);
  const previewRows = buildPreviewRows(rows, scopedMapping);
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

  const rawRows = await loadAllImportRows(supabase, input.import_id, tenantId);
  const sourceColumns = toSourceColumns(rawRows);
  const scopedMapping = filterMappingToSourceColumns(input.mapping, sourceColumns);
  const validation = computeValidation(scopedMapping);
  ensureCreateIsValid(validation);

  const duplicates = await findDuplicates({
    import_id: input.import_id,
    mapping: scopedMapping,
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
      mapping: scopedMapping,
      is_default: false,
    });

    resolvedTemplateId = savedTemplate.id;
  }

  const payload: MappingInsert = {
    import_id: input.import_id,
    template_id: resolvedTemplateId,
    status: "validated",
    column_mapping: scopedMapping,
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
  const mappedRowsPayload: MappedRowInsert[] = rawRows.map((row) => {
    const rawRow = asRecord(row.payload) ?? {};
    const mappedRow = applyMappingToPayload(rawRow, scopedMapping);
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

  await touchMappingMemory(supabase, tenantId, userId, scopedMapping);

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

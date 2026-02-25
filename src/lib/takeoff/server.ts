import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  assertDraftStatus,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { TakeoffMappingRuleSchema } from "@/lib/takeoff/schemas";
import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import { validateFileForUpload } from "@/lib/file-validation";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import type {
  CreateTakeoffMappingRuleInput,
  TakeoffJobActionResponse,
  TakeoffJobDetailResponse,
  TakeoffJobItem,
  TakeoffJobListResponse,
  TakeoffJobResult,
  TakeoffJobResponse,
  TakeoffJobSummary,
  TakeoffLevel,
  TakeoffMappingRule,
  TakeoffMappingRuleDeleteResponse,
  TakeoffMappingRuleMutationResponse,
  TakeoffMappingRulesListResponse,
  UpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";

const TAKEOFF_FILES_BUCKET = "takeoff-files";
const TAKEOFF_ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];
const TAKEOFF_ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const TAKEOFF_LEVEL: TakeoffLevel = "A";
const TAKEOFF_MAPPING_RULES_SELECT = [
  "id",
  "tenant_id",
  "created_at",
  "updated_at",
  "created_by",
  "name",
  "match_pattern",
  "match_type",
  "action",
  "action_params",
  "priority",
  "is_active",
].join(", ");
const TAKEOFF_TENANT_ADMIN_ROLE = "admin";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TAKEOFF_JOBS_LIST_LIMIT = 20;
const MAX_TAKEOFF_JOBS_LIST_LIMIT = 100;
const DEFAULT_TAKEOFF_JOB_ITEMS_LIMIT = 50;
const MAX_TAKEOFF_JOB_ITEMS_LIMIT = 200;
const MAX_TAKEOFF_JOB_ITEMS_OFFSET = 10_000;
const TAKEOFF_RETRY_MAX = 3;
const TAKEOFF_RETRY_BACKOFF_SECONDS = [5, 15, 45] as const;
const TAKEOFF_JOB_LIST_SELECT = [
  "id",
  "estimate_version_id",
  "status",
  "level",
  "source_file_name",
  "source_file_type",
  "source_file_size_bytes",
  "prompt_version",
  "schema_version",
  "model",
  "thinking_level",
  "media_resolution",
  "retry_count",
  "token_count",
  "cost_cents",
  "duration_ms",
  "started_at",
  "completed_at",
  "error_code",
  "error_message",
  "created_at",
  "updated_at",
].join(", ");
const TAKEOFF_JOB_DETAIL_SELECT = [
  TAKEOFF_JOB_LIST_SELECT,
  "source_file_path",
  "created_by",
].join(", ");
const TAKEOFF_RESULT_SELECT = [
  "id",
  "extracted_json",
  "warnings",
  "tables",
  "provider_meta",
  "raw_response",
  "confidence",
  "token_count",
  "cost_cents",
  "duration_ms",
  "created_at",
  "updated_at",
].join(", ");
const TAKEOFF_ITEMS_SELECT = [
  "id",
  "designation",
  "quantity",
  "unit",
  "confidence",
  "evidence",
  "source_file_name",
  "source_page",
  "metadata",
  "is_excluded",
  "is_verified",
  "verified_at",
  "verified_by",
  "created_at",
  "updated_at",
].join(", ");

const optionalUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("estimate_version_id invalide.").optional()
);

const optionalLimitSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("limit doit etre un entier.")
    .min(1, "limit doit etre >= 1.")
    .max(
      MAX_TAKEOFF_JOBS_LIST_LIMIT,
      `limit doit etre <= ${MAX_TAKEOFF_JOBS_LIST_LIMIT}.`
    )
    .optional()
);

const optionalItemsLimitSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("items_limit doit etre un entier.")
    .min(1, "items_limit doit etre >= 1.")
    .max(
      MAX_TAKEOFF_JOB_ITEMS_LIMIT,
      `items_limit doit etre <= ${MAX_TAKEOFF_JOB_ITEMS_LIMIT}.`
    )
    .optional()
);

const optionalOffsetSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("offset doit etre un entier.")
    .min(0, "offset doit etre >= 0.")
    .max(
      MAX_TAKEOFF_JOB_ITEMS_OFFSET,
      `offset doit etre <= ${MAX_TAKEOFF_JOB_ITEMS_OFFSET}.`
    )
    .optional()
);

const jsonRecordSchema = z.record(z.string(), z.unknown());

const takeoffJobSummarySchema: z.ZodType<TakeoffJobSummary> = z
  .object({
    id: z.string().uuid(),
    estimate_version_id: z.string().uuid(),
    status: z.string(),
    level: z.string(),
    source_file_name: z.string().nullable(),
    source_file_type: z.string().nullable(),
    source_file_size_bytes: z.number().int().nonnegative().nullable(),
    prompt_version: z.string().nullable(),
    schema_version: z.string().nullable(),
    model: z.string().nullable(),
    thinking_level: z.string().nullable(),
    media_resolution: z.string().nullable(),
    retry_count: z.number().int().nonnegative(),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    token_count: z.number().int().nonnegative().nullable(),
    cost_cents: z.number().int().nonnegative().nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    estimate_version_id: row.estimate_version_id,
    status: row.status,
    level: row.level,
    source_file_name: row.source_file_name,
    source_file_type: row.source_file_type,
    source_file_size_bytes: row.source_file_size_bytes,
    prompt_version: row.prompt_version,
    schema_version: row.schema_version,
    model: row.model,
    thinking_level: row.thinking_level,
    media_resolution: row.media_resolution,
    retry_count: row.retry_count,
    error_code: row.error_code,
    error_message: row.error_message,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metrics: {
      token_count: row.token_count,
      cost_cents: row.cost_cents,
      duration_ms: row.duration_ms,
    },
  }));

const takeoffJobResultSchema: z.ZodType<TakeoffJobResult> = z.object({
  id: z.string().uuid(),
  extracted_json: z.unknown(),
  warnings: z.array(z.unknown()),
  tables: z.array(z.unknown()),
  provider_meta: jsonRecordSchema,
  raw_response: z.unknown().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  token_count: z.number().int().nonnegative().nullable(),
  cost_cents: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const takeoffJobItemSchema: z.ZodType<TakeoffJobItem> = z.object({
  id: z.string().uuid(),
  designation: z.string(),
  quantity: z.number(),
  unit: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().nullable(),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().positive().nullable(),
  metadata: jsonRecordSchema,
  is_excluded: z.boolean(),
  is_verified: z.boolean(),
  verified_at: z.string().nullable(),
  verified_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const takeoffJobIdSchema = z.string().uuid("jobId invalide.");

export const listTakeoffJobsQuerySchema = z
  .object({
    estimate_version_id: optionalUuidSearchParamSchema,
    limit: optionalLimitSearchParamSchema,
    offset: optionalOffsetSearchParamSchema,
  })
  .strict();

export const getTakeoffJobDetailsQuerySchema = z
  .object({
    items_limit: optionalItemsLimitSearchParamSchema,
    items_offset: optionalOffsetSearchParamSchema,
  })
  .strict();

export type ListTakeoffJobsQuery = z.infer<typeof listTakeoffJobsQuerySchema>;
export type GetTakeoffJobDetailsQuery = z.infer<
  typeof getTakeoffJobDetailsQuerySchema
>;

const takeoffJobResponseSchema: z.ZodType<TakeoffJobResponse> = z.object({
  id: z.string().uuid(),
  status: z.string(),
  level: z.string(),
  source_file_name: z.string().nullable(),
  estimate_version_id: z.string().uuid(),
  created_at: z.string(),
});

type TakeoffJobRow = TakeoffJobResponse & {
  source_file_path?: string | null;
};

type TakeoffJobDetailRow = {
  id: string;
  estimate_version_id: string;
  status: string;
  level: string;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  source_file_path: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  media_resolution: string | null;
  retry_count: number | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

type TakeoffItemRow = {
  id: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: unknown;
  is_excluded: boolean;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

type TakeoffMappingRuleRow = {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  name: string;
  match_pattern: string;
  match_type: string;
  action: string;
  action_params: unknown;
  priority: number;
  is_active: boolean;
};

export type TakeoffJobCreateResponse = TakeoffJobResponse;
type AuthenticatedTakeoffContext = Awaited<
  ReturnType<typeof getAuthenticatedContext>
>;

function isUuid(value: string) {
  return UUID_REGEX.test(value);
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "upload";
}

function normalizeIdempotencyKey(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID,
      message: "La valeur de l'en-tete Idempotency-Key est invalide.",
      retryable: false,
    });
  }

  if (trimmed.length > 255) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID,
      message: "La valeur de l'en-tete Idempotency-Key est trop longue.",
      retryable: false,
    });
  }

  return trimmed;
}

function toHexSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function deriveDeterministicJobId(tenantId: string, idempotencyKey: string) {
  const seed = toHexSha256(`${tenantId}:${idempotencyKey}`);
  const bytes = Buffer.from(seed.slice(0, 32), "hex");

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function extractPayloadFingerprint(path: string | null | undefined) {
  if (!path) return null;
  const match = path.match(/\/([a-f0-9]{64})-[^/]+$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function normalizeTakeoffJobRow(row: TakeoffJobRow): TakeoffJobCreateResponse {
  return takeoffJobResponseSchema.parse({
    id: row.id,
    status: row.status,
    level: row.level,
    source_file_name: row.source_file_name,
    estimate_version_id: row.estimate_version_id,
    created_at: row.created_at,
  });
}

function assertTakeoffFileIsValid(file: File) {
  const validation = validateFileForUpload(file, {
    allowedExtensions: TAKEOFF_ALLOWED_EXTENSIONS,
    allowedMimeTypes: TAKEOFF_ALLOWED_MIME_TYPES,
    allowEmptyMimeType: false,
  });

  if (validation.valid) return;

  if (validation.error.includes("depasse")) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: validation.error,
      retryable: false,
    });
  }

  if (
    validation.error.includes("Extension") ||
    validation.error.includes("MIME")
  ) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: validation.error,
      retryable: false,
    });
  }

  throw new TakeoffError({
    status: 400,
    code: TakeoffErrorCode.BAD_REQUEST,
    message: validation.error,
    retryable: false,
  });
}

function parseEstimateVersionId(formData: FormData) {
  const value = formData.get("estimate_version_id");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le champ estimate_version_id est requis.",
      retryable: false,
    });
  }

  const estimateVersionId = value.trim();

  if (!isUuid(estimateVersionId)) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_ESTIMATE_VERSION_ID_INVALID,
      message: "Le champ estimate_version_id doit etre un UUID valide.",
      retryable: false,
    });
  }

  return estimateVersionId;
}

function parseTakeoffLevel(formData: FormData) {
  const value = formData.get("level");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le champ level est requis.",
      retryable: false,
    });
  }

  const normalized = value.trim().toUpperCase();

  if (normalized !== TAKEOFF_LEVEL) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
      message: "Le niveau Takeoff supporte pour cet endpoint est uniquement 'A'.",
      retryable: false,
    });
  }

  return normalized as TakeoffLevel;
}

function assertTakeoffMappingRulesAdminRole(tenantRole: string) {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) return;

  throw forbidden(
    "Seul un administrateur peut gerer les regles de mapping takeoff."
  );
}

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function parseWithSchema<T>(schema: z.ZodType<T>, payload: unknown, message: string): T {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw unprocessableEntity(
      message,
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

function normalizeTakeoffJobSummaryRow(row: unknown): TakeoffJobSummary {
  return parseWithSchema(
    takeoffJobSummarySchema,
    row,
    "Donnees takeoff_jobs invalides en base."
  );
}

function normalizeTakeoffJobSummaryRows(rows: unknown[]): TakeoffJobSummary[] {
  return rows.map((row) => normalizeTakeoffJobSummaryRow(row));
}

function normalizeTakeoffResultRow(row: unknown): TakeoffJobResult {
  return parseWithSchema(
    takeoffJobResultSchema,
    row,
    "Donnees takeoff_results invalides en base."
  );
}

function normalizeTakeoffItemRow(row: unknown): TakeoffJobItem {
  return parseWithSchema(
    takeoffJobItemSchema,
    row,
    "Donnees takeoff_items invalides en base."
  );
}

function normalizeTakeoffItemRows(rows: unknown[]): TakeoffJobItem[] {
  return rows.map((row) => normalizeTakeoffItemRow(row));
}

function getTakeoffRetryBackoffMs(retryCount: number) {
  const clamped = Math.max(
    0,
    Math.min(retryCount, TAKEOFF_RETRY_BACKOFF_SECONDS.length - 1)
  );

  return TAKEOFF_RETRY_BACKOFF_SECONDS[clamped] * 1000;
}

function buildTerminalStatusConflictError(input: {
  status: string;
  allowedStatuses: string[];
  action: "retry" | "cancel";
}): TakeoffError {
  const message =
    input.action === "retry"
      ? "Le job doit etre en statut failed pour etre relance."
      : "Le job doit etre en statut pending ou processing pour etre annule.";

  return new TakeoffError({
    status: 409,
    code: TakeoffErrorCode.CONFLICT,
    message,
    details: {
      action: input.action,
      current_status: input.status,
      allowed_statuses: input.allowedStatuses,
    },
    retryable: false,
  });
}

async function getAuthenticatedTakeoffContext(): Promise<AuthenticatedTakeoffContext> {
  const context = await getAuthenticatedContext();
  await assertTakeoffEnabled(context.tenantId, { supabase: context.supabase });
  return context;
}

export function parseListTakeoffJobsQuery(payload: unknown): ListTakeoffJobsQuery {
  return parseWithSchema(
    listTakeoffJobsQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

export function parseGetTakeoffJobDetailsQuery(
  payload: unknown
): GetTakeoffJobDetailsQuery {
  return parseWithSchema(
    getTakeoffJobDetailsQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

function normalizeTakeoffMappingRuleRow(row: TakeoffMappingRuleRow): TakeoffMappingRule {
  const parsed = TakeoffMappingRuleSchema.safeParse(row);

  if (!parsed.success) {
    throw unprocessableEntity(
      "Regle de mapping takeoff invalide.",
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

function assertRegexMatchPatternIsValid(matchType: string, matchPattern: string) {
  if (matchType !== "regex") return;

  try {
    new RegExp(matchPattern);
  } catch {
    throw unprocessableEntity(
      "Le champ match_pattern doit etre une regex valide.",
      {
        match_type: matchType,
        match_pattern: matchPattern,
      },
      "VALIDATION_ERROR"
    );
  }
}

function buildTakeoffMappingRuleInsertPayload(input: {
  tenantId: string;
  userId: string;
  rule: CreateTakeoffMappingRuleInput;
}) {
  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    created_by: input.userId,
    name: input.rule.name,
    match_pattern: input.rule.match_pattern,
    match_type: input.rule.match_type,
    action: input.rule.action,
    action_params: input.rule.action_params,
  };

  if ("priority" in input.rule) {
    payload.priority = input.rule.priority;
  }

  if ("is_active" in input.rule) {
    payload.is_active = input.rule.is_active;
  }

  return payload;
}

function buildTakeoffMappingRuleUpdatePayload(input: UpdateTakeoffMappingRuleInput) {
  const payload: Record<string, unknown> = {};

  if ("name" in input) payload.name = input.name;
  if ("match_pattern" in input) payload.match_pattern = input.match_pattern;
  if ("match_type" in input) payload.match_type = input.match_type;
  if ("action" in input) payload.action = input.action;
  if ("action_params" in input) payload.action_params = input.action_params;
  if ("priority" in input) payload.priority = input.priority;
  if ("is_active" in input) payload.is_active = input.is_active;

  return payload;
}

async function getTakeoffJobById(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  jobId: string;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select(
      "id, status, level, source_file_name, source_file_path, estimate_version_id, created_at" as never
    )
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de verifier l'idempotence du job."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (data ?? null) as TakeoffJobRow | null;
}

async function getTakeoffJobDetailById(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<TakeoffJobDetailRow | null> {
  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select(TAKEOFF_JOB_DETAIL_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (data ?? null) as TakeoffJobDetailRow | null;
}

async function getTakeoffJobDetailByIdOrThrow(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<TakeoffJobDetailRow> {
  const row = await getTakeoffJobDetailById(input);

  if (row) {
    return row;
  }

  throw new TakeoffError({
    status: 404,
    code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
    message: "Job takeoff introuvable.",
    details: {
      job_id: input.jobId,
    },
    retryable: false,
    jobId: input.jobId,
  });
}

async function getTakeoffResultByJobId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<TakeoffJobResult | null> {
  const { data, error } = await input.supabase
    .from("takeoff_results" as never)
    .select(TAKEOFF_RESULT_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("job_id" as never, input.jobId as never)
    .order("created_at" as never, { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le resultat du job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  if (!data) {
    return null;
  }

  return normalizeTakeoffResultRow(data);
}

async function listTakeoffItemsByJobId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  limit: number;
  offset: number;
}): Promise<{ data: TakeoffJobItem[]; total: number }> {
  const rangeStart = input.offset;
  const rangeEnd = input.offset + input.limit - 1;

  const { data, count, error } = await input.supabase
    .from("takeoff_items" as never)
    .select(TAKEOFF_ITEMS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("job_id" as never, input.jobId as never)
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true })
    .range(rangeStart as never, rangeEnd as never);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les items du job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return {
    data: normalizeTakeoffItemRows((data ?? []) as TakeoffItemRow[]),
    total: count ?? 0,
  };
}

export async function listTakeoffJobs(
  input: ListTakeoffJobsQuery
): Promise<TakeoffJobListResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const limit = input.limit ?? DEFAULT_TAKEOFF_JOBS_LIST_LIMIT;
  const offset = input.offset ?? 0;
  const rangeEnd = offset + limit - 1;

  let query = supabase
    .from("takeoff_jobs" as never)
    .select(TAKEOFF_JOB_LIST_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, tenantId as never)
    .order("created_at" as never, { ascending: false })
    .range(offset as never, rangeEnd as never);

  if (input.estimate_version_id) {
    query = query.eq(
      "estimate_version_id" as never,
      input.estimate_version_id as never
    );
  }

  const { data, count, error } = await query;

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de lister les jobs takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return {
    jobs: normalizeTakeoffJobSummaryRows((data ?? []) as TakeoffJobDetailRow[]),
    pagination: {
      limit,
      offset,
      total: count ?? 0,
    },
  };
}

export async function getTakeoffJobDetails(
  jobId: string,
  input: GetTakeoffJobDetailsQuery
): Promise<TakeoffJobDetailResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const limit = input.items_limit ?? DEFAULT_TAKEOFF_JOB_ITEMS_LIMIT;
  const offset = input.items_offset ?? 0;
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );

  const [jobRow, result, items] = await Promise.all([
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedJobId,
    }),
    getTakeoffResultByJobId({
      supabase,
      tenantId,
      jobId: normalizedJobId,
    }),
    listTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedJobId,
      limit,
      offset,
    }),
  ]);

  return {
    job: normalizeTakeoffJobSummaryRow(jobRow),
    result,
    items: {
      data: items.data,
      pagination: {
        limit,
        offset,
        total: items.total,
      },
    },
  };
}

export async function retryTakeoffJob(jobId: string): Promise<TakeoffJobActionResponse> {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const existingJob = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (existingJob.status !== "failed") {
    throw buildTerminalStatusConflictError({
      action: "retry",
      status: existingJob.status,
      allowedStatuses: ["failed"],
    });
  }

  const retryCount = existingJob.retry_count ?? 0;
  if (retryCount >= TAKEOFF_RETRY_MAX) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le nombre maximal de relances est atteint pour ce job.",
      details: {
        retry_count: retryCount,
        retry_max: TAKEOFF_RETRY_MAX,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const requiredBackoffMs = getTakeoffRetryBackoffMs(retryCount);
  if (existingJob.completed_at) {
    const completedAtMs = Date.parse(existingJob.completed_at);
    if (Number.isFinite(completedAtMs)) {
      const earliestRetryAtMs = completedAtMs + requiredBackoffMs;
      if (Date.now() < earliestRetryAtMs) {
        throw new TakeoffError({
          status: 409,
          code: TakeoffErrorCode.CONFLICT,
          message: "Le delai de relance n'est pas encore ecoule pour ce job.",
          details: {
            retry_count: retryCount,
            retry_backoff_ms: requiredBackoffMs,
            retry_available_at: new Date(earliestRetryAtMs).toISOString(),
          },
          retryable: false,
          jobId: normalizedJobId,
        });
      }
    }
  }

  const { data, error } = await supabase
    .from("takeoff_jobs" as never)
    .update({
      status: "pending",
      retry_count: retryCount + 1,
      started_at: null,
      completed_at: null,
      token_count: null,
      cost_cents: null,
      duration_ms: null,
      error_code: null,
      error_message: null,
    } as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedJobId as never)
    .eq("status" as never, "failed" as never)
    .select(TAKEOFF_JOB_DETAIL_SELECT as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de relancer le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job n'est plus dans un statut relancable.",
      details: {
        expected_status: "failed",
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const updatedJob = data as TakeoffJobDetailRow;
  const retriedAuditMetadata =
    takeoffAuditMetadataBuilders["takeoff.job.retried"]({
      from_attempt: retryCount + 1,
      to_attempt: retryCount + 2,
      reason: "manual_retry",
    });

  await logTakeoffAuditEvent({
    supabase,
    tenantId,
    userId,
    jobId: normalizedJobId,
    estimateVersionId: updatedJob.estimate_version_id,
    action: "takeoff.job.retried",
    metadata: retriedAuditMetadata,
    mode: "non-blocking",
  });

  return {
    job: normalizeTakeoffJobSummaryRow(updatedJob),
  };
}

export async function cancelTakeoffJob(jobId: string): Promise<TakeoffJobActionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const existingJob = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (existingJob.status !== "pending" && existingJob.status !== "processing") {
    throw buildTerminalStatusConflictError({
      action: "cancel",
      status: existingJob.status,
      allowedStatuses: ["pending", "processing"],
    });
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("takeoff_jobs" as never)
    .update({
      status: "canceled",
      completed_at: completedAt,
      error_code: null,
      error_message: null,
    } as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedJobId as never)
    .in("status" as never, ["pending", "processing"] as never)
    .select(TAKEOFF_JOB_DETAIL_SELECT as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible d'annuler le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job n'est plus dans un statut annulable.",
      details: {
        allowed_statuses: ["pending", "processing"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const updatedJob = data as TakeoffJobDetailRow;
  const canceledAuditMetadata =
    takeoffAuditMetadataBuilders["takeoff.job.canceled"]({
      reason: "manual_cancel",
      canceled_by: tenantRole === TAKEOFF_TENANT_ADMIN_ROLE ? "admin" : "user",
    });

  await logTakeoffAuditEvent({
    supabase,
    tenantId,
    userId,
    jobId: normalizedJobId,
    estimateVersionId: updatedJob.estimate_version_id,
    action: "takeoff.job.canceled",
    metadata: canceledAuditMetadata,
    mode: "non-blocking",
  });

  return {
    job: normalizeTakeoffJobSummaryRow(updatedJob),
  };
}

async function assertEstimateVersionAccessibleAsDraft(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  estimateVersionId: string;
  tenantId: string;
  userId: string;
  tenantRole: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, status, estimate_projects!inner(tenant_id, user_id)")
    .eq("id", input.estimateVersionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      retryable: false,
    });
  }

  const estimateProjects = data.estimate_projects as
    | { tenant_id: string; user_id: string }
    | Array<{ tenant_id: string; user_id: string }>
    | null;
  const project = Array.isArray(estimateProjects)
    ? estimateProjects[0]
    : estimateProjects;

  if (!project || project.tenant_id !== input.tenantId) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      retryable: false,
    });
  }

  const canAccess =
    project.user_id === input.userId || input.tenantRole === "admin";
  if (!canAccess) {
    throw new TakeoffError({
      status: 403,
      code: TakeoffErrorCode.TAKEOFF_TENANT_UNAUTHORIZED,
      message: "Acces interdit aux ressources de ce tenant.",
      retryable: false,
    });
  }

  assertDraftStatus(data.status);
}

async function removeUploadedFileIfPresent(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  storagePath: string;
}) {
  const { error } = await input.supabase.storage
    .from(TAKEOFF_FILES_BUCKET)
    .remove([input.storagePath]);

  if (error) {
    console.error("Failed to rollback takeoff storage upload", {
      storagePath: input.storagePath,
      error,
    });
  }
}

async function removeCreatedJobIfPresent(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  jobId: string;
}) {
  const { error } = await input.supabase
    .from("takeoff_jobs" as never)
    .delete()
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never);

  if (error) {
    console.error("Failed to rollback takeoff job creation", {
      jobId: input.jobId,
      tenantId: input.tenantId,
      error,
    });
  }
}

export async function createTakeoffJobFromFormData(
  formData: FormData,
  input?: { idempotencyKey?: string | null }
): Promise<TakeoffJobCreateResponse> {
  let level: TakeoffLevel | undefined;
  let jobId: string | undefined;

  try {
    const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
        message: "Le champ file est requis.",
        retryable: false,
      });
    }

    const file = fileEntry;
    const estimateVersionId = parseEstimateVersionId(formData);
    level = parseTakeoffLevel(formData);

    assertTakeoffFileIsValid(file);

    const fileContentHash = toHexSha256(Buffer.from(await file.arrayBuffer()));
    const payloadFingerprint = toHexSha256(
      JSON.stringify({
        estimate_version_id: estimateVersionId,
        level,
        file_name: file.name,
        file_type: file.type,
        file_size_bytes: file.size,
        file_content_hash: fileContentHash,
      })
    );

    const { supabase, tenantId, userId, tenantRole } =
      await getAuthenticatedContext();

    jobId = idempotencyKey
      ? deriveDeterministicJobId(tenantId, idempotencyKey)
      : randomUUID();

    if (idempotencyKey) {
      const existingJob = await getTakeoffJobById({
        supabase,
        tenantId,
        jobId,
      });

      if (existingJob) {
        const existingFingerprint = extractPayloadFingerprint(
          existingJob.source_file_path
        );

        if (existingFingerprint === payloadFingerprint) {
          return normalizeTakeoffJobRow(existingJob);
        }

        throw new TakeoffError({
          status: 409,
          code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
          message:
            "La cle d'idempotence est deja utilisee avec un payload different.",
          details: {
            job_id: existingJob.id,
          },
          retryable: false,
          jobId: existingJob.id,
          level,
        });
      }
    }

    await assertTakeoffEnabled(tenantId, { supabase });
    await assertEstimateVersionAccessibleAsDraft({
      supabase,
      tenantId,
      userId,
      tenantRole,
      estimateVersionId,
    });

    const sourceFileName = file.name.trim().length > 0 ? file.name : "upload";
    const sourceFilePath = `${tenantId}/${jobId}/${payloadFingerprint}-${sanitizeFilename(
      sourceFileName
    )}`;

    const { error: uploadError } = await supabase.storage
      .from(TAKEOFF_FILES_BUCKET)
      .upload(sourceFilePath, file, {
        contentType: file.type,
        upsert: Boolean(idempotencyKey),
      });

    if (uploadError) {
      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "Impossible de televerser le fichier takeoff.",
        details: uploadError,
        retryable: false,
        jobId,
        level,
      });
    }

    const { data: insertedJob, error: insertError } = await supabase
      .from("takeoff_jobs" as never)
      .insert({
        id: jobId,
        tenant_id: tenantId,
        estimate_version_id: estimateVersionId,
        level: TAKEOFF_LEVEL,
        status: "pending",
        source_file_name: sourceFileName,
        source_file_path: sourceFilePath,
        source_file_type: file.type,
        source_file_size_bytes: file.size,
        prompt_version: getTakeoffPromptVersion(TAKEOFF_LEVEL),
        created_by: userId,
      } as never)
      .select(
        "id, status, level, source_file_name, source_file_path, estimate_version_id, created_at" as never
      )
      .single();

    if (insertError || !insertedJob) {
      if (idempotencyKey && insertError?.code === "23505") {
        const existingJob = await getTakeoffJobById({
          supabase,
          tenantId,
          jobId,
        });

        if (existingJob) {
          const existingFingerprint = extractPayloadFingerprint(
            existingJob.source_file_path
          );

          if (existingFingerprint === payloadFingerprint) {
            return normalizeTakeoffJobRow(existingJob);
          }

          await removeUploadedFileIfPresent({
            supabase,
            storagePath: sourceFilePath,
          });

          throw new TakeoffError({
            status: 409,
            code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
            message:
              "La cle d'idempotence est deja utilisee avec un payload different.",
            details: {
              job_id: existingJob.id,
            },
            retryable: false,
            jobId: existingJob.id,
            level,
          });
        }

        await removeUploadedFileIfPresent({
          supabase,
          storagePath: sourceFilePath,
        });

        throw new TakeoffError({
          status: 404,
          code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
          message:
            "Le job Takeoff associe a la cle d'idempotence est introuvable.",
          details: {
            reason: "IDEMPOTENCY_KEY_CONFLICT_WITHOUT_JOB",
          },
          retryable: false,
          jobId,
          level,
        });
      }

      await removeUploadedFileIfPresent({
        supabase,
        storagePath: sourceFilePath,
      });

      if (insertError) {
        throw toTakeoffError(
          mapSupabaseError(insertError, "Impossible de creer le job takeoff."),
          {
            fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
            retryable: false,
            jobId,
            level,
          }
        );
      }

      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "Impossible de creer le job takeoff.",
        retryable: false,
        jobId,
        level,
      });
    }

    const createdJob = insertedJob as TakeoffJobRow;

    try {
      const createdAuditMetadata =
        takeoffAuditMetadataBuilders["takeoff.job.created"]({
          level: TAKEOFF_LEVEL,
          estimate_version_id: createdJob.estimate_version_id,
          source_file_name: createdJob.source_file_name,
          idempotency_key: idempotencyKey,
        });

      await logTakeoffAuditEvent({
        supabase,
        tenantId,
        userId,
        jobId: createdJob.id,
        estimateVersionId: createdJob.estimate_version_id,
        action: "takeoff.job.created",
        metadata: createdAuditMetadata,
        mode: "fail-hard",
      });
    } catch (error) {
      await removeUploadedFileIfPresent({
        supabase,
        storagePath: sourceFilePath,
      });
      await removeCreatedJobIfPresent({
        supabase,
        tenantId,
        jobId: createdJob.id,
      });
      throw error;
    }

    return normalizeTakeoffJobRow(createdJob);
  } catch (error) {
    throw toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      fallbackMessage: "Impossible de creer le job takeoff.",
      retryable: false,
      jobId,
      level,
    });
  }
}

export async function listTakeoffMappingRules(): Promise<TakeoffMappingRulesListResponse> {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  const { data, error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .order("priority" as never, { ascending: true })
    .order("created_at" as never, { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les regles de mapping takeoff."
    );
  }

  return {
    mapping_rules: ((data ?? []) as TakeoffMappingRuleRow[]).map((row) =>
      normalizeTakeoffMappingRuleRow(row)
    ),
  };
}

export async function createTakeoffMappingRule(
  input: CreateTakeoffMappingRuleInput
): Promise<TakeoffMappingRuleMutationResponse> {
  const { supabase, tenantId, tenantRole, userId } =
    await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  assertRegexMatchPatternIsValid(input.match_type, input.match_pattern);

  const insertPayload = buildTakeoffMappingRuleInsertPayload({
    tenantId,
    userId,
    rule: input,
  });

  const { data, error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .insert(insertPayload as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de creer la regle de mapping takeoff."
      );
    }

    throw badRequest("Impossible de creer la regle de mapping takeoff.");
  }

  return {
    mapping_rule: normalizeTakeoffMappingRuleRow(data as TakeoffMappingRuleRow),
  };
}

export async function updateTakeoffMappingRule(
  ruleId: string,
  input: UpdateTakeoffMappingRuleInput
): Promise<TakeoffMappingRuleMutationResponse> {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  const { data: existingRule, error: existingRuleError } = await supabase
    .from("takeoff_mapping_rules" as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never)
    .maybeSingle();

  if (existingRuleError) {
    throw mapSupabaseError(
      existingRuleError,
      "Impossible de charger la regle de mapping takeoff."
    );
  }

  if (!existingRule) {
    throw notFound("Regle de mapping takeoff introuvable.");
  }

  const existing = normalizeTakeoffMappingRuleRow(existingRule as TakeoffMappingRuleRow);

  const nextMatchType = input.match_type ?? existing.match_type;
  const nextMatchPattern = input.match_pattern ?? existing.match_pattern;
  assertRegexMatchPatternIsValid(nextMatchType, nextMatchPattern);

  const payload = buildTakeoffMappingRuleUpdatePayload(input);
  const { data, error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .update(payload as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de mettre a jour la regle de mapping takeoff."
      );
    }

    throw badRequest("Impossible de mettre a jour la regle de mapping takeoff.");
  }

  return {
    mapping_rule: normalizeTakeoffMappingRuleRow(data as TakeoffMappingRuleRow),
  };
}

export async function deleteTakeoffMappingRule(
  ruleId: string
): Promise<TakeoffMappingRuleDeleteResponse> {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  const { data: existingRule, error: existingRuleError } = await supabase
    .from("takeoff_mapping_rules" as never)
    .select("id" as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never)
    .maybeSingle();

  if (existingRuleError) {
    throw mapSupabaseError(
      existingRuleError,
      "Impossible de charger la regle de mapping takeoff."
    );
  }

  if (!existingRule) {
    throw notFound("Regle de mapping takeoff introuvable.");
  }

  const { error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .delete()
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de supprimer la regle de mapping takeoff."
    );
  }

  return {
    deleted: true,
    rule_id: ruleId,
  };
}

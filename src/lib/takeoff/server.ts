import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  assertDraftStatus,
  bulkUpdateEstimateItems,
  getAuthenticatedContext,
  insertAssemblyIntoVersion,
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
import { checkApplyGuard } from "@/lib/takeoff/guards";
import {
  TakeoffMappingRuleSchema,
  takeoffApplyRequestSchema,
  takeoffPreviewConversionResponseSchema,
} from "@/lib/takeoff/schemas";
import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import { validateFileForUpload } from "@/lib/file-validation";
import {
  assertTakeoffEnabled,
  getTakeoffLowConfidenceThresholdForTenant,
} from "@/lib/takeoff/feature-flags";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import {
  TAKEOFF_APPLY_SCOPES,
  TAKEOFF_JOB_LIST_PERIODS,
  TAKEOFF_JOB_STATUSES,
  TAKEOFF_LEVELS,
  type CreateTakeoffMappingRuleInput,
  type TakeoffApplyRequest,
  type TakeoffApplyResponse,
  type TakeoffApplyScope,
  type TakeoffApplyStrategy,
  type TakeoffApplySummary,
  type TakeoffMappingPreviewItem,
  type TakeoffPreviewConversionResponse,
  type TakeoffItemBatchPatchRequest,
  type TakeoffItemBatchPatchResponse,
  type TakeoffItemPatchResult,
  type TakeoffJobActionResponse,
  type TakeoffJobCompareResponse,
  type TakeoffJobDetailResponse,
  type TakeoffJobItem,
  type TakeoffJobListResponse,
  type TakeoffJobResult,
  type TakeoffJobStatusCounters,
  type TakeoffJobResponse,
  type TakeoffJobSummary,
  type TakeoffJobListPeriod,
  type TakeoffLevel,
  type TakeoffMappingRule,
  type TakeoffMappingRuleDeleteResponse,
  type TakeoffMappingRuleMutationResponse,
  type TakeoffMappingRulesListResponse,
  type UpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";
import {
  TAKEOFF_COMPARE_DEFAULT_THRESHOLD,
  TAKEOFF_COMPARE_MAX_THRESHOLD,
  TAKEOFF_COMPARE_MIN_THRESHOLD,
  buildTakeoffDiff,
} from "@/lib/takeoff/diff";

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
const TAKEOFF_PROJECT_VERSIONS_BATCH_SIZE = 1000;
const MAX_TAKEOFF_JOB_ITEMS_OFFSET = 10_000;
const TAKEOFF_JOB_LIST_PERIOD_DAYS: Record<TakeoffJobListPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
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
  "next_retry_at",
  "last_error_at",
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
  "exclusion_reason",
  "is_verified",
  "verified_at",
  "verified_by",
  "created_at",
  "updated_at",
].join(", ");
const TAKEOFF_APPLIED_ESTIMATE_ITEMS_SELECT = [
  "id",
  "parent_id",
  "position",
  "title",
  "description",
  "source_job_id",
  "item_type",
  "updated_at",
].join(", ");
const TAKEOFF_MAPPING_SKIP_REASON = "Exclu par regle de mapping: skip";
const TAKEOFF_MAPPING_ASSEMBLY_REASON =
  "Exclu par regle de mapping: apply_assembly";

const optionalUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("estimate_version_id invalide.").optional()
);

const optionalProjectIdSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("project_id invalide.").optional()
);

const optionalStatusSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.enum(TAKEOFF_JOB_STATUSES).optional()
);

const optionalLevelSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.enum(TAKEOFF_LEVELS).optional()
);

const optionalPeriodSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.enum(TAKEOFF_JOB_LIST_PERIODS).optional()
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

const requiredUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("Parametre UUID invalide.")
);

const optionalCompareThresholdSearchParamSchema = z.preprocess(
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
    .min(
      TAKEOFF_COMPARE_MIN_THRESHOLD,
      `threshold doit etre >= ${TAKEOFF_COMPARE_MIN_THRESHOLD}.`
    )
    .max(
      TAKEOFF_COMPARE_MAX_THRESHOLD,
      `threshold doit etre <= ${TAKEOFF_COMPARE_MAX_THRESHOLD}.`
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
    next_retry_at: z.string().nullable().optional(),
    last_error_at: z.string().nullable().optional(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    items_count: z.number().int().nonnegative().nullable().optional(),
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
    next_retry_at: row.next_retry_at ?? null,
    last_error_at: row.last_error_at ?? null,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items_count: row.items_count ?? null,
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
  exclusion_reason: z.string().nullable(),
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
    project_id: optionalProjectIdSearchParamSchema,
    status: optionalStatusSearchParamSchema,
    level: optionalLevelSearchParamSchema,
    period: optionalPeriodSearchParamSchema,
    limit: optionalLimitSearchParamSchema,
    offset: optionalOffsetSearchParamSchema,
  })
  .strict()
  .refine(
    (data) => !(data.project_id && data.estimate_version_id),
    {
      message:
        "project_id et estimate_version_id sont mutuellement exclusifs.",
      path: ["project_id"],
    }
  );

export const getTakeoffJobDetailsQuerySchema = z
  .object({
    items_limit: optionalItemsLimitSearchParamSchema,
    items_offset: optionalOffsetSearchParamSchema,
  })
  .strict();

export const compareTakeoffJobsQuerySchema = z
  .object({
    with: requiredUuidSearchParamSchema,
    threshold: optionalCompareThresholdSearchParamSchema,
  })
  .strict();

export const takeoffApplyPayloadSchema = takeoffApplyRequestSchema;

const takeoffApplyRpcSummarySchema = z
  .object({
    strategy: z.string().optional(),
    scope: z.string().optional(),
    created_items_count: z.number().int().nonnegative().optional(),
    updated_items_count: z.number().int().nonnegative().optional(),
    ignored_items_count: z.number().int().nonnegative().optional(),
    created_item_ids: z.array(z.string()).optional(),
    created_count: z.number().int().nonnegative().optional(),
    updated_count: z.number().int().nonnegative().optional(),
    ignored_count: z.number().int().nonnegative().optional(),
    created_ids: z.array(z.string()).optional(),
  })
  .passthrough();

export type ListTakeoffJobsQuery = z.infer<typeof listTakeoffJobsQuerySchema>;
export type GetTakeoffJobDetailsQuery = z.infer<
  typeof getTakeoffJobDetailsQuerySchema
>;
export type CompareTakeoffJobsQuery = z.infer<typeof compareTakeoffJobsQuerySchema>;

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
  next_retry_at: string | null;
  last_error_at: string | null;
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
  exclusion_reason: string | null;
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

type EstimateLineForTakeoffMappingRow = {
  id: string;
  parent_id: string | null;
  position: number;
  title: string;
  description: string | null;
  source_job_id: string | null;
  item_type: string;
  updated_at: string;
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
  const normalizedPath = typeof path === "string" ? path.trim().replace(/\/+$/g, "") : "";
  if (!normalizedPath) return null;

  const patterns = [
    /(?:^|\/)([a-f0-9]{64})-[^/]+$/i,
    /(?:^|\/)([a-f0-9]{64})\/[^/]+$/i,
    /(?:^|\/)([a-f0-9]{64})$/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedPath.match(pattern);
    const fingerprint = match?.[1];
    if (fingerprint) {
      return fingerprint.toLowerCase();
    }
  }

  return null;
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

function assertTakeoffApplyOverrideAdminRole(tenantRole: string) {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) return;

  throw forbidden(
    "Seul un administrateur peut forcer l'application des items non verifies."
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTakeoffApplyScope(value: unknown): value is TakeoffApplyScope {
  return (
    typeof value === "string" &&
    (TAKEOFF_APPLY_SCOPES as readonly string[]).includes(value)
  );
}

type ApplyTakeoffRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type ApplyTakeoffRpcArgs = {
  job_id: string;
  strategy: TakeoffApplyStrategy;
  target_section_id: string | null;
};

function isApplyTakeoffRpcSignatureMismatch(error: ApplyTakeoffRpcError) {
  const normalizedMessage = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    normalizedMessage.includes("could not find the function public.apply_takeoff_job")
  );
}

async function invokeApplyTakeoffRpc(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  args: ApplyTakeoffRpcArgs;
}) {
  const primaryAttempt = await input.supabase.rpc(
    "apply_takeoff_job" as never,
    {
      p_job_id: input.args.job_id,
      p_strategy: input.args.strategy,
      p_target_section_id: input.args.target_section_id,
    } as never
  );

  if (!primaryAttempt.error || !isApplyTakeoffRpcSignatureMismatch(primaryAttempt.error)) {
    return primaryAttempt;
  }

  return input.supabase.rpc("apply_takeoff_job" as never, input.args as never);
}

function mapApplyTakeoffRpcError(
  error: ApplyTakeoffRpcError,
  input: { jobId: string }
): TakeoffError {
  const normalized = [
    error.code ?? "",
    error.message ?? "",
    error.details ?? "",
    error.hint ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const details = {
    rpc: {
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    },
  };

  if (
    error.code === "PGRST116" ||
    normalized.includes("not found") ||
    normalized.includes("introuvable")
  ) {
    return new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "P0001" ||
    error.code === "23505" ||
    normalized.includes("conflict") ||
    normalized.includes("already applied") ||
    normalized.includes("deja applique") ||
    normalized.includes("lock")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Conflit lors de l'application du job takeoff.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "22P02" ||
    error.code === "23503" ||
    error.code === "23514" ||
    normalized.includes("validation") ||
    normalized.includes("invalid") ||
    normalized.includes("invalide") ||
    normalized.includes("uuid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: "Le payload d'application takeoff est invalide.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  return new TakeoffError({
    status: 500,
    code: TakeoffErrorCode.INTERNAL_ERROR,
    message: "Erreur interne lors de l'application du job takeoff.",
    details,
    retryable: false,
    jobId: input.jobId,
  });
}

function normalizeTakeoffApplySummary(input: {
  rpcData: unknown;
  request: TakeoffApplyRequest;
  jobId: string;
}): TakeoffApplySummary {
  const rpcRow = Array.isArray(input.rpcData) ? input.rpcData[0] : input.rpcData;
  const summarySource =
    isRecord(rpcRow) && isRecord(rpcRow.summary) ? rpcRow.summary : rpcRow;
  const parsed = takeoffApplyRpcSummarySchema.safeParse(
    isRecord(summarySource) ? summarySource : {}
  );

  if (!parsed.success) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "La reponse apply_takeoff_job est invalide.",
      details: {
        issues: toValidationIssues(parsed.error),
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  const row = parsed.data;
  const createdItemsCount = row.created_items_count ?? row.created_count ?? 0;
  const updatedItemsCount = row.updated_items_count ?? row.updated_count ?? 0;
  const ignoredItemsCount = row.ignored_items_count ?? row.ignored_count ?? 0;

  return {
    scope: isTakeoffApplyScope(row.scope)
      ? row.scope
      : input.request.target_section_id
        ? "section"
        : "version",
    created_count: createdItemsCount,
    updated_count: updatedItemsCount,
    ignored_count: ignoredItemsCount,
    created_ids: row.created_ids ?? row.created_item_ids ?? [],
  };
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

export function parseCompareTakeoffJobsQuery(
  payload: unknown
): CompareTakeoffJobsQuery {
  return parseWithSchema(
    compareTakeoffJobsQuerySchema,
    payload,
    "Parametres de comparaison invalides."
  );
}

export function parseApplyTakeoffPayload(payload: unknown): TakeoffApplyRequest {
  return parseWithSchema(
    takeoffApplyPayloadSchema,
    payload,
    "Payload d'application takeoff invalide."
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

async function listAllTakeoffItemsByJobId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<TakeoffJobItem[]> {
  const items: TakeoffJobItem[] = [];
  let offset = 0;

  while (true) {
    const page = await listTakeoffItemsByJobId({
      ...input,
      limit: MAX_TAKEOFF_JOB_ITEMS_LIMIT,
      offset,
    });

    if (page.data.length === 0) {
      break;
    }

    items.push(...page.data);
    offset += page.data.length;

    if (items.length >= page.total) {
      break;
    }
  }

  return items;
}

function resolveTakeoffJobsPeriodStart(
  period: ListTakeoffJobsQuery["period"]
): string | null {
  if (!period) return null;
  const periodDays = TAKEOFF_JOB_LIST_PERIOD_DAYS[period];
  if (!periodDays) return null;
  return new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
}

async function resolveVersionIdsForProject(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  projectId: string;
}): Promise<Array<{ id: string; version_number: number }>> {
  const versions: Array<{ id: string; version_number: number }> = [];
  let offset = 0;

  while (true) {
    const end = offset + TAKEOFF_PROJECT_VERSIONS_BATCH_SIZE - 1;
    const { data, error } = await input.supabase
      .from("estimate_versions")
      .select("id, version_number")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .order("version_number", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, end);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de resoudre les versions du projet."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
        }
      );
    }

    const rows = (data ?? []) as Array<{ id: string; version_number: number }>;
    if (rows.length === 0) {
      break;
    }

    versions.push(...rows);
    offset += rows.length;
  }

  return versions;
}

type TakeoffJobsListFilterQuery = {
  eq: (column: string, value: string) => TakeoffJobsListFilterQuery;
  gte: (column: string, value: string) => TakeoffJobsListFilterQuery;
  in: (column: string, values: string[]) => TakeoffJobsListFilterQuery;
};

type TakeoffJobsListFilterInput = Pick<
  ListTakeoffJobsQuery,
  "estimate_version_id" | "status" | "level" | "period"
> & {
  version_ids?: string[];
};

function applyTakeoffJobsListFilters<TQuery extends TakeoffJobsListFilterQuery>(
  query: TQuery,
  input: TakeoffJobsListFilterInput
): TQuery {
  let scopedQuery = query;

  if (input.version_ids && input.version_ids.length > 0) {
    scopedQuery = scopedQuery.in(
      "estimate_version_id",
      input.version_ids
    ) as TQuery;
  } else if (input.estimate_version_id) {
    scopedQuery = scopedQuery.eq(
      "estimate_version_id",
      input.estimate_version_id
    ) as TQuery;
  }

  if (input.status) {
    scopedQuery = scopedQuery.eq("status", input.status) as TQuery;
  }

  if (input.level) {
    scopedQuery = scopedQuery.eq("level", input.level) as TQuery;
  }

  const periodStart = resolveTakeoffJobsPeriodStart(input.period);
  if (periodStart) {
    scopedQuery = scopedQuery.gte("created_at", periodStart) as TQuery;
  }

  return scopedQuery;
}

type TakeoffJobsCounterStatus = Exclude<keyof TakeoffJobStatusCounters, "total">;

async function countTakeoffJobs(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  filters: Pick<ListTakeoffJobsQuery, "estimate_version_id" | "level" | "period"> & {
    version_ids?: string[];
  };
  status?: TakeoffJobsCounterStatus;
}): Promise<number> {
  const query = applyTakeoffJobsListFilters(
    input.supabase
      .from("takeoff_jobs" as never)
      .select("id" as never, { count: "exact", head: true })
      .eq("tenant_id" as never, input.tenantId as never),
    {
      estimate_version_id: input.filters.estimate_version_id,
      version_ids: input.filters.version_ids,
      level: input.filters.level,
      period: input.filters.period,
      status: input.status,
    }
  );

  const { count, error } = await query;

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de calculer les compteurs de jobs takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return count ?? 0;
}

async function buildTakeoffJobsStatusCounters(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  filters: Pick<ListTakeoffJobsQuery, "estimate_version_id" | "level" | "period"> & {
    version_ids?: string[];
  };
}): Promise<TakeoffJobStatusCounters> {
  const [total, processing, completed, failed, canceled] = await Promise.all([
    countTakeoffJobs({
      supabase: input.supabase,
      tenantId: input.tenantId,
      filters: input.filters,
    }),
    countTakeoffJobs({
      supabase: input.supabase,
      tenantId: input.tenantId,
      filters: input.filters,
      status: "processing",
    }),
    countTakeoffJobs({
      supabase: input.supabase,
      tenantId: input.tenantId,
      filters: input.filters,
      status: "completed",
    }),
    countTakeoffJobs({
      supabase: input.supabase,
      tenantId: input.tenantId,
      filters: input.filters,
      status: "failed",
    }),
    countTakeoffJobs({
      supabase: input.supabase,
      tenantId: input.tenantId,
      filters: input.filters,
      status: "canceled",
    }),
  ]);

  return {
    total,
    processing,
    completed,
    failed,
    canceled,
  };
}

async function listTakeoffItemCountsByJobId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobIds: string[];
}): Promise<Map<string, number>> {
  if (input.jobIds.length === 0) {
    return new Map();
  }

  const entries = await Promise.all(
    input.jobIds.map(async (jobId) => {
      const { count, error } = await input.supabase
        .from("takeoff_items" as never)
        .select("id" as never, { count: "exact", head: true })
        .eq("tenant_id" as never, input.tenantId as never)
        .eq("job_id" as never, jobId as never);

      if (error) {
        throw toTakeoffError(
          mapSupabaseError(error, "Impossible de compter les items du job takeoff."),
          {
            fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
            retryable: false,
            jobId,
          }
        );
      }

      return [jobId, count ?? 0] as const;
    })
  );

  return new Map(entries);
}

export async function listTakeoffJobs(
  input: ListTakeoffJobsQuery
): Promise<TakeoffJobListResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const limit = input.limit ?? DEFAULT_TAKEOFF_JOBS_LIST_LIMIT;
  const offset = input.offset ?? 0;
  const rangeEnd = offset + limit - 1;

  let versionIds: string[] | undefined;
  let versionNumberMap: Map<string, number> | undefined;

  if (input.project_id) {
    const versions = await resolveVersionIdsForProject({
      supabase,
      tenantId,
      projectId: input.project_id,
    });
    if (versions.length === 0) {
      return {
        jobs: [],
        counters: { total: 0, processing: 0, completed: 0, failed: 0, canceled: 0 },
        pagination: { limit, offset, total: 0 },
      };
    }
    versionIds = versions.map((v) => v.id);
    versionNumberMap = new Map(versions.map((v) => [v.id, v.version_number]));
  } else if (input.estimate_version_id) {
    const { data: singleVersion, error: versionError } = await supabase
      .from("estimate_versions")
      .select("id, version_number")
      .eq("id", input.estimate_version_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (versionError) {
      throw toTakeoffError(
        mapSupabaseError(
          versionError,
          "Impossible de resoudre le numero de version."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
        }
      );
    }
    if (singleVersion) {
      versionNumberMap = new Map([
        [singleVersion.id, singleVersion.version_number as number],
      ]);
    }
  }

  const filterInput: TakeoffJobsListFilterInput = {
    estimate_version_id: input.estimate_version_id,
    version_ids: versionIds,
    status: input.status,
    level: input.level,
    period: input.period,
  };

  const countersPromise = buildTakeoffJobsStatusCounters({
    supabase,
    tenantId,
    filters: {
      estimate_version_id: input.estimate_version_id,
      version_ids: versionIds,
      level: input.level,
      period: input.period,
    },
  });

  const query = applyTakeoffJobsListFilters(
    supabase
      .from("takeoff_jobs" as never)
      .select(TAKEOFF_JOB_LIST_SELECT as never, { count: "exact" })
      .eq("tenant_id" as never, tenantId as never),
    filterInput
  )
    .order("created_at" as never, { ascending: false })
    .range(offset as never, rangeEnd as never);

  const [{ data, count, error }, counters] = await Promise.all([
    query,
    countersPromise,
  ]);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de lister les jobs takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const jobs = normalizeTakeoffJobSummaryRows((data ?? []) as TakeoffJobDetailRow[]);
  const uniqueJobIds = Array.from(new Set(jobs.map((job) => job.id)));
  const itemCountByJobId = await listTakeoffItemCountsByJobId({
    supabase,
    tenantId,
    jobIds: uniqueJobIds,
  });

  return {
    jobs: jobs.map((job) => ({
      ...job,
      items_count: itemCountByJobId.get(job.id) ?? 0,
      version_number: versionNumberMap?.get(job.estimate_version_id) ?? null,
    })),
    counters,
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

function normalizeSourceFileNameForCompare(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

export async function compareTakeoffJobs(
  baseJobId: string,
  input: CompareTakeoffJobsQuery
): Promise<TakeoffJobCompareResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedBaseJobId = parseWithSchema(
    takeoffJobIdSchema,
    baseJobId,
    "Identifiant job invalide."
  );
  const normalizedOtherJobId = parseWithSchema(
    takeoffJobIdSchema,
    input.with,
    "Parametre with invalide."
  );
  const threshold = input.threshold ?? TAKEOFF_COMPARE_DEFAULT_THRESHOLD;

  if (normalizedBaseJobId === normalizedOtherJobId) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La comparaison doit cibler deux jobs differents.",
      details: {
        base_job_id: normalizedBaseJobId,
        other_job_id: normalizedOtherJobId,
      },
      retryable: false,
      jobId: normalizedBaseJobId,
    });
  }

  const [baseJob, otherJob] = await Promise.all([
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedBaseJobId,
    }),
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedOtherJobId,
    }),
  ]);

  const baseSourceFileName = normalizeSourceFileNameForCompare(baseJob.source_file_name);
  const otherSourceFileName = normalizeSourceFileNameForCompare(
    otherJob.source_file_name
  );

  if (
    baseJob.estimate_version_id !== otherJob.estimate_version_id ||
    !baseSourceFileName ||
    !otherSourceFileName ||
    baseSourceFileName !== otherSourceFileName
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Les jobs selectionnes ne correspondent pas au meme document (version + fichier source).",
      details: {
        base_job_id: normalizedBaseJobId,
        other_job_id: normalizedOtherJobId,
        base_estimate_version_id: baseJob.estimate_version_id,
        other_estimate_version_id: otherJob.estimate_version_id,
        base_source_file_name: baseJob.source_file_name,
        other_source_file_name: otherJob.source_file_name,
      },
      retryable: false,
      jobId: normalizedBaseJobId,
    });
  }

  const [baseItems, otherItems] = await Promise.all([
    listAllTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedBaseJobId,
    }),
    listAllTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedOtherJobId,
    }),
  ]);

  const diff = buildTakeoffDiff({
    baseItems,
    otherItems,
    threshold,
  });

  return {
    base_job_id: normalizedBaseJobId,
    other_job_id: normalizedOtherJobId,
    threshold: diff.threshold,
    summary: diff.summary,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    unchanged: diff.unchanged,
  };
}

function normalizeTakeoffMappingText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function buildTakeoffMappingKey(input: {
  designation: string;
  unit: string;
}): string {
  return `${normalizeTakeoffMappingText(input.designation).toLocaleLowerCase("fr-FR")}::${normalizeTakeoffMappingText(input.unit).toLocaleLowerCase("fr-FR")}`;
}

async function listActiveTakeoffMappingRules(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
}): Promise<TakeoffMappingRule[]> {
  const { data, error } = await input.supabase
    .from("takeoff_mapping_rules" as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("is_active" as never, true as never)
    .order("priority" as never, { ascending: true })
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true });

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les regles de mapping takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return ((data ?? []) as TakeoffMappingRuleRow[]).map((row) =>
    normalizeTakeoffMappingRuleRow(row)
  );
}

async function buildTakeoffMappingPreviewForJob(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  request: TakeoffApplyRequest;
}): Promise<TakeoffPreviewConversionResponse> {
  const [items, rules] = await Promise.all([
    listAllTakeoffItemsByJobId({
      supabase: input.supabase,
      tenantId: input.tenantId,
      jobId: input.jobId,
    }),
    listActiveTakeoffMappingRules({
      supabase: input.supabase,
      tenantId: input.tenantId,
    }),
  ]);

  const preview = computeTakeoffMappingPreview({
    items,
    rules,
    overrides: input.request.overrides,
  });

  return parseWithSchema(
    takeoffPreviewConversionResponseSchema,
    {
      job_id: input.jobId,
      strategy: input.request.strategy,
      target_section_id: input.request.target_section_id ?? null,
      summary: preview.summary,
      items: preview.items,
    },
    "Preview de conversion mapping invalide."
  );
}

export async function previewTakeoffJobConversion(
  jobId: string,
  body: unknown
): Promise<TakeoffPreviewConversionResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const request = parseApplyTakeoffPayload(body);
  const jobRow = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (jobRow.status !== "completed") {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job doit etre en statut completed pour calculer une preview.",
      details: {
        current_status: jobRow.status,
        allowed_statuses: ["completed"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  return buildTakeoffMappingPreviewForJob({
    supabase,
    tenantId,
    jobId: normalizedJobId,
    request,
  });
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
      next_retry_at: null,
      last_error_at: null,
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
      next_retry_at: null,
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

async function assertTakeoffApplyDraftLockOwnership(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  estimateVersionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, updated_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.estimateVersionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de verifier le verrou brouillon de la version cible."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const row = (data ?? null) as { id: string; updated_at: string | null } | null;
  if (!row) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  const concurrencyToken = row.updated_at;
  if (!concurrencyToken) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Jeton de concurrence introuvable pour la version de chiffrage.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  await bulkUpdateEstimateItems(input.estimateVersionId, [], concurrencyToken);
}

type TakeoffItemPreApplyPatch = {
  item_id: string;
  payload: {
    designation?: string;
    is_excluded?: boolean;
    exclusion_reason?: string | null;
    updated_at: string;
  };
};

function buildTakeoffItemPreApplyPatches(
  previewItems: TakeoffMappingPreviewItem[]
): TakeoffItemPreApplyPatch[] {
  return previewItems
    .map((item) => {
      if (item.original.is_excluded) {
        return null;
      }

      const patch: TakeoffItemPreApplyPatch["payload"] = {
        updated_at: new Date().toISOString(),
      };

      if (
        item.action === "rename" &&
        item.transformed.designation !== item.original.designation
      ) {
        patch.designation = item.transformed.designation;
      }

      if (item.action === "skip" || item.action === "apply_assembly") {
        patch.is_excluded = true;
        patch.exclusion_reason =
          item.action === "skip"
            ? TAKEOFF_MAPPING_SKIP_REASON
            : TAKEOFF_MAPPING_ASSEMBLY_REASON;
      }

      if (Object.keys(patch).length <= 1) {
        return null;
      }

      return {
        item_id: item.item_id,
        payload: patch,
      } satisfies TakeoffItemPreApplyPatch;
    })
    .filter((entry): entry is TakeoffItemPreApplyPatch => Boolean(entry));
}

function buildTakeoffItemPreApplyRollbackPatches(input: {
  previewItems: TakeoffMappingPreviewItem[];
  patches: TakeoffItemPreApplyPatch[];
}): TakeoffItemPreApplyPatch[] {
  const previewByItemId = new Map(
    input.previewItems.map((previewItem) => [previewItem.item_id, previewItem])
  );
  const rollbackTimestamp = new Date().toISOString();

  return input.patches
    .map((patch) => {
      const previewItem = previewByItemId.get(patch.item_id);
      if (!previewItem) {
        return null;
      }

      const rollbackPayload: TakeoffItemPreApplyPatch["payload"] = {
        updated_at: rollbackTimestamp,
      };

      if ("designation" in patch.payload) {
        rollbackPayload.designation = previewItem.original.designation;
      }
      if ("is_excluded" in patch.payload) {
        rollbackPayload.is_excluded = previewItem.original.is_excluded;
      }
      if ("exclusion_reason" in patch.payload) {
        rollbackPayload.exclusion_reason = null;
      }

      return {
        item_id: patch.item_id,
        payload: rollbackPayload,
      } satisfies TakeoffItemPreApplyPatch;
    })
    .filter((entry): entry is TakeoffItemPreApplyPatch => Boolean(entry));
}

async function applyTakeoffItemPreApplyPatches(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  patches: TakeoffItemPreApplyPatch[];
}) {
  for (const patch of input.patches) {
    const { error } = await input.supabase
      .from("takeoff_items" as never)
      .update(patch.payload as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("job_id" as never, input.jobId as never)
      .eq("id" as never, patch.item_id as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de preparer les items takeoff pour apply."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.jobId,
        }
      );
    }
  }
}

async function rollbackTakeoffItemPreApplyPatches(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  patches: TakeoffItemPreApplyPatch[];
}) {
  if (input.patches.length === 0) {
    return;
  }

  try {
    await applyTakeoffItemPreApplyPatches(input);
  } catch (error) {
    console.error("Failed to rollback takeoff item pre-apply patches", {
      tenantId: input.tenantId,
      jobId: input.jobId,
      error,
    });
  }
}

async function loadAppliedEstimateLinesForTakeoffJob(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  estimateVersionId: string;
  jobId: string;
  targetSectionId: string | null;
}): Promise<EstimateLineForTakeoffMappingRow[]> {
  let query = input.supabase
    .from("estimate_items" as never)
    .select(TAKEOFF_APPLIED_ESTIMATE_ITEMS_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.estimateVersionId as never)
    .eq("item_type" as never, "line" as never)
    .eq("source_job_id" as never, input.jobId as never);

  if (input.targetSectionId === null) {
    query = query.is("parent_id" as never, null);
  } else {
    query = query.eq("parent_id" as never, input.targetSectionId as never);
  }

  const { data, error } = await query
    .order("position" as never, { ascending: true })
    .order("id" as never, { ascending: true });

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de charger les lignes appliquees pour le mapping takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (data ?? []) as EstimateLineForTakeoffMappingRow[];
}

function mapPreviewItemsToEstimateLineIds(input: {
  previewItems: TakeoffMappingPreviewItem[];
  estimateLines: EstimateLineForTakeoffMappingRow[];
}): Map<string, string | null> {
  const linesByKey = new Map<string, EstimateLineForTakeoffMappingRow[]>();
  for (const line of input.estimateLines) {
    const key = buildTakeoffMappingKey({
      designation: line.title,
      unit: line.description ?? "",
    });
    const current = linesByKey.get(key) ?? [];
    current.push(line);
    linesByKey.set(key, current);
  }

  const sourceByKeyOffset = new Map<string, number>();
  const result = new Map<string, string | null>();
  const orderedPreviewItems = [...input.previewItems].sort(
    (left, right) => left.source_order - right.source_order
  );

  for (const item of orderedPreviewItems) {
    if (item.original.is_excluded || item.transformed.is_excluded) {
      result.set(item.item_id, null);
      continue;
    }

    const key = buildTakeoffMappingKey({
      designation: item.transformed.designation,
      unit: item.transformed.unit,
    });
    const keyOffset = sourceByKeyOffset.get(key) ?? 0;
    const candidateLine = linesByKey.get(key)?.[keyOffset] ?? null;
    sourceByKeyOffset.set(key, keyOffset + 1);
    result.set(item.item_id, candidateLine?.id ?? null);
  }

  return result;
}

function buildEstimateLineUpdatesFromMappingPreview(input: {
  previewItems: TakeoffMappingPreviewItem[];
  estimateLineByItemId: Map<string, string | null>;
}) {
  const updatesByEstimateItemId = new Map<
    string,
    {
      id: string;
      title?: string;
      unit_price_ht_cents?: number;
      category_id?: string | null;
    }
  >();

  for (const item of input.previewItems) {
    const estimateItemId = input.estimateLineByItemId.get(item.item_id) ?? null;
    if (!estimateItemId) {
      continue;
    }

    if (item.action !== "rename" && item.action !== "set_price" && item.action !== "set_category") {
      continue;
    }

    const currentPatch = updatesByEstimateItemId.get(estimateItemId) ?? {
      id: estimateItemId,
    };

    if (item.action === "rename") {
      currentPatch.title = item.transformed.designation;
    }

    if (
      item.action === "set_price" &&
      typeof item.transformed.unit_price_cents === "number"
    ) {
      currentPatch.unit_price_ht_cents = item.transformed.unit_price_cents;
    }

    if (item.action === "set_category") {
      currentPatch.category_id = item.transformed.category_id;
    }

    updatesByEstimateItemId.set(estimateItemId, currentPatch);
  }

  return Array.from(updatesByEstimateItemId.values()).filter((update) => {
    return (
      Object.prototype.hasOwnProperty.call(update, "title") ||
      Object.prototype.hasOwnProperty.call(update, "unit_price_ht_cents") ||
      Object.prototype.hasOwnProperty.call(update, "category_id")
    );
  });
}

async function getEstimateVersionUpdatedAt(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  estimateVersionId: string;
}): Promise<string> {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("updated_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.estimateVersionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le jeton de concurrence."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const updatedAt =
    (data as { updated_at: string | null } | null)?.updated_at ?? null;
  if (!updatedAt) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Jeton de concurrence introuvable pour la version de chiffrage.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  return updatedAt;
}

async function applyEstimateLineUpdatesFromMapping(input: {
  estimateVersionId: string;
  updates: Array<{
    id: string;
    title?: string;
    unit_price_ht_cents?: number;
    category_id?: string | null;
  }>;
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
}) {
  if (input.updates.length === 0) {
    return;
  }

  const concurrencyToken = await getEstimateVersionUpdatedAt({
    supabase: input.supabase,
    tenantId: input.tenantId,
    estimateVersionId: input.estimateVersionId,
  });

  await bulkUpdateEstimateItems(input.estimateVersionId, input.updates, concurrencyToken);
}

async function applyAssemblyInsertionsFromMapping(input: {
  estimateVersionId: string;
  targetSectionId: string | null;
  previewItems: TakeoffMappingPreviewItem[];
}) {
  const assemblyItems = [...input.previewItems]
    .filter(
      (item) =>
        !item.original.is_excluded &&
        item.action === "apply_assembly" &&
        typeof item.transformed.assembly_id === "string"
    )
    .sort((left, right) => left.source_order - right.source_order);

  let afterItemId = input.targetSectionId;
  for (const item of assemblyItems) {
    const inserted = await insertAssemblyIntoVersion({
      assemblyId: item.transformed.assembly_id!,
      versionId: input.estimateVersionId,
      afterItemId,
    });

    const insertedItems = Array.isArray(inserted?.items) ? inserted.items : [];
    const nextAnchorId =
      insertedItems.find((insertedItem) => insertedItem.item_type === "section")?.id ??
      insertedItems[0]?.id;
    if (nextAnchorId) {
      afterItemId = nextAnchorId;
    }
  }
}

async function logTakeoffMappingApplyAuditEvents(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  previewItems: TakeoffMappingPreviewItem[];
  estimateLineByItemId: Map<string, string | null>;
}) {
  for (const previewItem of input.previewItems) {
    if (previewItem.action === "none" || previewItem.original.is_excluded) {
      continue;
    }

    await logTakeoffAuditEvent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      jobId: input.jobId,
      estimateVersionId: input.estimateVersionId,
      action: "takeoff.mapping.applied",
      metadata: takeoffAuditMetadataBuilders["takeoff.mapping.applied"]({
        job_id: input.jobId,
        item_id: previewItem.item_id,
        rule_id: previewItem.rule_id,
        action: previewItem.action,
        estimate_item_id: input.estimateLineByItemId.get(previewItem.item_id) ?? null,
      }),
      tableName: "takeoff_items",
      mode: "non-blocking",
    });
  }
}

export async function applyTakeoffJob(
  jobId: string,
  body: unknown
): Promise<TakeoffApplyResponse> {
  let normalizedJobId: string | undefined;
  let auditContext:
    | {
        supabase: AuthenticatedTakeoffContext["supabase"];
        tenantId: string;
        userId: string;
        estimateVersionId: string;
      }
    | undefined;

  try {
    const { supabase, tenantId, userId, tenantRole } =
      await getAuthenticatedTakeoffContext();
    normalizedJobId = parseWithSchema(
      takeoffJobIdSchema,
      jobId,
      "Identifiant job invalide."
    );
    const payload = parseApplyTakeoffPayload(body);

    const jobRow = await getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedJobId,
    });

    auditContext = {
      supabase,
      tenantId,
      userId,
      estimateVersionId: jobRow.estimate_version_id,
    };

    if (jobRow.status !== "completed") {
      throw new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Le job doit etre en statut completed pour etre applique.",
        details: {
          current_status: jobRow.status,
          allowed_statuses: ["completed"],
        },
        retryable: false,
        jobId: normalizedJobId,
      });
    }

    const mappingPreview = await buildTakeoffMappingPreviewForJob({
      supabase,
      tenantId,
      jobId: normalizedJobId,
      request: payload,
    });

    // Guard: Level C requires low-confidence items to be verified
    if (jobRow.level === "C") {
      const lowConfidenceThreshold = await getTakeoffLowConfidenceThresholdForTenant(
        tenantId,
        { supabase }
      );
      const { data: guardItems, error: guardItemsError } = await supabase
        .from("takeoff_items" as never)
        .select("id, designation, confidence, is_verified, is_excluded" as never)
        .eq("tenant_id" as never, tenantId as never)
        .eq("job_id" as never, normalizedJobId as never);

      if (guardItemsError) {
        throw toTakeoffError(
          mapSupabaseError(guardItemsError, "Impossible de verifier les items pour le guard."),
          { jobId: normalizedJobId }
        );
      }

      const guardResult = checkApplyGuard(
        guardItems as Array<{
          id: string;
          designation: string;
          confidence: number | null;
          is_verified: boolean;
          is_excluded: boolean;
        }>,
        lowConfidenceThreshold
      );

      if (!guardResult.passed) {
        if (payload.override === true) {
          assertTakeoffApplyOverrideAdminRole(tenantRole);
          const overrideJustification = payload.override_justification?.trim();

          if (!overrideJustification) {
            throw new TakeoffError({
              status: 422,
              code: TakeoffErrorCode.BAD_REQUEST,
              message:
                "override_justification est obligatoire pour un override admin.",
              retryable: false,
              jobId: normalizedJobId,
            });
          }

          await logTakeoffAuditEvent({
            supabase,
            tenantId,
            userId,
            jobId: normalizedJobId,
            estimateVersionId: jobRow.estimate_version_id,
            action: "takeoff.apply.override",
            metadata: takeoffAuditMetadataBuilders["takeoff.apply.override"]({
              estimate_version_id: jobRow.estimate_version_id,
              threshold: guardResult.threshold,
              blocked_item_ids: guardResult.blocked_items.map((i) => i.item_id),
              blocked_items_count: guardResult.blocked_items.length,
              justification: overrideJustification,
            }),
            mode: "non-blocking",
          });
        } else {
          throw new TakeoffError({
            code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
            status: 422,
            details: {
              blocked_items: guardResult.blocked_items,
              medium_items: guardResult.medium_items,
              threshold: guardResult.threshold,
            },
            retryable: false,
            jobId: normalizedJobId,
          });
        }
      }
    }

    await logTakeoffAuditEvent({
      supabase,
      tenantId,
      userId,
      jobId: normalizedJobId,
      estimateVersionId: jobRow.estimate_version_id,
      action: "takeoff.apply.started",
      metadata: takeoffAuditMetadataBuilders["takeoff.apply.started"]({
        estimate_version_id: jobRow.estimate_version_id,
        selected_items_count: mappingPreview.summary.included_count,
      }),
      mode: "non-blocking",
    });

    await assertTakeoffApplyDraftLockOwnership({
      supabase,
      tenantId,
      estimateVersionId: jobRow.estimate_version_id,
    });

    const preApplyItemPatches = buildTakeoffItemPreApplyPatches(mappingPreview.items);
    const preApplyItemRollbackPatches = buildTakeoffItemPreApplyRollbackPatches({
      previewItems: mappingPreview.items,
      patches: preApplyItemPatches,
    });
    let rpcData: unknown;

    try {
      await applyTakeoffItemPreApplyPatches({
        supabase,
        tenantId,
        jobId: normalizedJobId,
        patches: preApplyItemPatches,
      });

      const rpcAttempt = await invokeApplyTakeoffRpc({
        supabase,
        args: {
          job_id: normalizedJobId,
          strategy: payload.strategy,
          target_section_id: payload.target_section_id ?? null,
        },
      });

      if (rpcAttempt.error) {
        throw mapApplyTakeoffRpcError(rpcAttempt.error, {
          jobId: normalizedJobId,
        });
      }

      rpcData = rpcAttempt.data;
    } catch (error) {
      await rollbackTakeoffItemPreApplyPatches({
        supabase,
        tenantId,
        jobId: normalizedJobId,
        patches: preApplyItemRollbackPatches,
      });
      throw error;
    }

    const summary = normalizeTakeoffApplySummary({
      rpcData,
      request: payload,
      jobId: normalizedJobId,
    });

    const hasAuditableMappingTransformations = mappingPreview.items.some(
      (item) => !item.original.is_excluded && item.action !== "none"
    );
    const hasEstimateLineMappingUpdates = mappingPreview.items.some(
      (item) =>
        !item.original.is_excluded &&
        (item.action === "rename" ||
          item.action === "set_price" ||
          item.action === "set_category")
    );
    const hasAssemblyInsertions = mappingPreview.items.some(
      (item) => !item.original.is_excluded && item.action === "apply_assembly"
    );

    if (hasAuditableMappingTransformations) {
      const estimateLineByItemId = new Map<string, string | null>();

      if (hasEstimateLineMappingUpdates) {
        const appliedEstimateLines = await loadAppliedEstimateLinesForTakeoffJob({
          supabase,
          tenantId,
          estimateVersionId: jobRow.estimate_version_id,
          jobId: normalizedJobId,
          targetSectionId: payload.target_section_id ?? null,
        });
        const mappedEstimateLineIds = mapPreviewItemsToEstimateLineIds({
          previewItems: mappingPreview.items,
          estimateLines: appliedEstimateLines,
        });
        for (const [itemId, estimateItemId] of mappedEstimateLineIds.entries()) {
          estimateLineByItemId.set(itemId, estimateItemId);
        }

        const estimateLineUpdates = buildEstimateLineUpdatesFromMappingPreview({
          previewItems: mappingPreview.items,
          estimateLineByItemId,
        });
        await applyEstimateLineUpdatesFromMapping({
          estimateVersionId: jobRow.estimate_version_id,
          updates: estimateLineUpdates,
          supabase,
          tenantId,
        });
      }

      if (hasAssemblyInsertions) {
        await applyAssemblyInsertionsFromMapping({
          estimateVersionId: jobRow.estimate_version_id,
          targetSectionId: payload.target_section_id ?? null,
          previewItems: mappingPreview.items,
        });
      }

      await logTakeoffMappingApplyAuditEvents({
        supabase,
        tenantId,
        userId,
        jobId: normalizedJobId,
        estimateVersionId: jobRow.estimate_version_id,
        previewItems: mappingPreview.items,
        estimateLineByItemId,
      });
    }

    const updatedJobRow = await getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedJobId,
    });

    if (updatedJobRow.status !== "applied") {
      throw new TakeoffError({
        status: 500,
        code: TakeoffErrorCode.INTERNAL_ERROR,
        message: "Le job takeoff n'est pas dans le statut attendu apres apply.",
        details: {
          expected_status: "applied",
          current_status: updatedJobRow.status,
        },
        retryable: false,
        jobId: normalizedJobId,
      });
    }

    await logTakeoffAuditEvent({
      supabase,
      tenantId,
      userId,
      jobId: normalizedJobId,
      estimateVersionId: jobRow.estimate_version_id,
      action: "takeoff.apply.completed",
      metadata: takeoffAuditMetadataBuilders["takeoff.apply.completed"]({
        estimate_version_id: jobRow.estimate_version_id,
        applied_items_count: summary.created_count + summary.updated_count,
        excluded_items_count: summary.ignored_count,
      }),
      mode: "non-blocking",
    });

    return {
      job: normalizeTakeoffJobSummaryRow(updatedJobRow),
      summary,
    };
  } catch (error) {
    const mappedError = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      fallbackMessage: "Impossible d'appliquer le job takeoff.",
      retryable: false,
      jobId: normalizedJobId,
    });

    if (auditContext && normalizedJobId) {
      await logTakeoffAuditEvent({
        supabase: auditContext.supabase,
        tenantId: auditContext.tenantId,
        userId: auditContext.userId,
        jobId: normalizedJobId,
        estimateVersionId: auditContext.estimateVersionId,
        action: "takeoff.apply.failed",
        metadata: takeoffAuditMetadataBuilders["takeoff.apply.failed"]({
          estimate_version_id: auditContext.estimateVersionId,
          error_code:
            typeof mappedError.code === "string" ? mappedError.code : null,
          error_message: mappedError.message,
          retryable: mappedError.retryable,
        }),
        mode: "non-blocking",
      });
    }

    throw mappedError;
  }
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

const TAKEOFF_ITEM_BATCH_MAX = 100;

const takeoffItemPatchFieldSchema = z
  .object({
    designation: z.string().trim().min(1, "designation ne peut pas etre vide.").max(500).optional(),
    quantity: z.number().finite().positive("quantity doit etre > 0.").optional(),
    unit: z.string().trim().min(1, "unit ne peut pas etre vide.").max(64).optional(),
    is_excluded: z.boolean().optional(),
    exclusion_reason: z.string().trim().min(1).max(500).nullable().optional(),
    is_verified: z.boolean().optional(),
    evidence: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (fields) => Object.keys(fields).length > 0,
    { message: "Au moins un champ de mise a jour est requis." }
  )
  .refine(
    (fields) => {
      if (fields.is_excluded === true && !fields.exclusion_reason) {
        return false;
      }
      return true;
    },
    { message: "exclusion_reason est obligatoire quand is_excluded = true." }
  );

export const takeoffItemBatchPatchSchema = z
  .object({
    items: z
      .array(
        z.object({
          item_id: z.string().uuid("item_id invalide."),
          updated_at: z.string().min(1, "updated_at est requis."),
          fields: takeoffItemPatchFieldSchema,
        })
      )
      .min(1, "Au moins un item est requis.")
      .max(TAKEOFF_ITEM_BATCH_MAX, `Maximum ${TAKEOFF_ITEM_BATCH_MAX} items par batch.`),
  })
  .strict();

export async function batchUpdateTakeoffItems(
  jobId: string,
  body: unknown
): Promise<TakeoffItemBatchPatchResponse> {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const request = parseWithSchema(
    takeoffItemBatchPatchSchema,
    body,
    "Payload de mise a jour invalide."
  ) as TakeoffItemBatchPatchRequest;

  // Verify job exists, same tenant, status completed
  const jobRow = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (jobRow.status !== "completed") {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job doit etre en statut completed pour modifier les items.",
      details: {
        current_status: jobRow.status,
        allowed_statuses: ["completed"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const results: TakeoffItemPatchResult[] = [];

  for (const entry of request.items) {
    try {
      // Fetch current item
      const { data: currentItem, error: fetchError } = await supabase
        .from("takeoff_items" as never)
        .select(TAKEOFF_ITEMS_SELECT as never)
        .eq("id" as never, entry.item_id as never)
        .eq("job_id" as never, normalizedJobId as never)
        .eq("tenant_id" as never, tenantId as never)
        .maybeSingle();

      if (fetchError) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Impossible de charger l'item.",
        });
        continue;
      }

      if (!currentItem) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Item introuvable.",
        });
        continue;
      }

      const typedItem = currentItem as TakeoffItemRow;

      // OCC check
      if (typedItem.updated_at !== entry.updated_at) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Conflit de concurrence: l'item a ete modifie depuis votre derniere lecture.",
        });
        continue;
      }

      // Build update payload
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      const auditFields: Array<{
        field: string;
        previous: unknown;
        next: unknown;
      }> = [];

      if (entry.fields.designation !== undefined) {
        auditFields.push({
          field: "designation",
          previous: typedItem.designation,
          next: entry.fields.designation,
        });
        updatePayload.designation = entry.fields.designation;
      }

      if (entry.fields.quantity !== undefined) {
        auditFields.push({
          field: "quantity",
          previous: typedItem.quantity,
          next: entry.fields.quantity,
        });
        updatePayload.quantity = entry.fields.quantity;
      }

      if (entry.fields.unit !== undefined) {
        auditFields.push({
          field: "unit",
          previous: typedItem.unit,
          next: entry.fields.unit,
        });
        updatePayload.unit = entry.fields.unit;
      }

      if (entry.fields.is_excluded !== undefined) {
        auditFields.push({
          field: "is_excluded",
          previous: typedItem.is_excluded,
          next: entry.fields.is_excluded,
        });
        updatePayload.is_excluded = entry.fields.is_excluded;

        if (entry.fields.is_excluded) {
          updatePayload.exclusion_reason =
            entry.fields.exclusion_reason ?? null;
        } else {
          updatePayload.exclusion_reason = null;
        }
      } else if (entry.fields.exclusion_reason !== undefined) {
        updatePayload.exclusion_reason = entry.fields.exclusion_reason;
      }

      if (entry.fields.is_verified !== undefined) {
        auditFields.push({
          field: "is_verified",
          previous: typedItem.is_verified,
          next: entry.fields.is_verified,
        });
        updatePayload.is_verified = entry.fields.is_verified;

        if (entry.fields.is_verified) {
          updatePayload.verified_at = new Date().toISOString();
          updatePayload.verified_by = userId;
        } else {
          updatePayload.verified_at = null;
          updatePayload.verified_by = null;
        }
      }

      if (entry.fields.evidence !== undefined) {
        auditFields.push({
          field: "evidence",
          previous: typedItem.evidence,
          next: entry.fields.evidence,
        });
        updatePayload.evidence = entry.fields.evidence;
      }

      // Execute update
      const { data: updatedData, error: updateError } = await supabase
        .from("takeoff_items" as never)
        .update(updatePayload as never)
        .eq("id" as never, entry.item_id as never)
        .eq("job_id" as never, normalizedJobId as never)
        .eq("tenant_id" as never, tenantId as never)
        .eq("updated_at" as never, entry.updated_at as never)
        .select(TAKEOFF_ITEMS_SELECT as never)
        .maybeSingle();

      if (updateError) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Impossible de mettre a jour l'item.",
        });
        continue;
      }

      if (!updatedData) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Conflit de concurrence: l'item a ete modifie depuis votre derniere lecture.",
        });
        continue;
      }

      const updatedItem = normalizeTakeoffItemRow(updatedData as TakeoffItemRow);

      // Audit events (non-blocking)
      for (const audit of auditFields) {
        if (audit.field === "is_excluded" && audit.next === true) {
          logTakeoffAuditEvent({
            supabase,
            tenantId,
            userId,
            jobId: normalizedJobId,
            estimateVersionId: jobRow.estimate_version_id,
            action: "takeoff.item.excluded",
            metadata: takeoffAuditMetadataBuilders["takeoff.item.excluded"]({
              item_id: entry.item_id,
              reason: entry.fields.exclusion_reason ?? null,
            }),
            tableName: "takeoff_items",
            mode: "non-blocking",
          });
        } else {
          logTakeoffAuditEvent({
            supabase,
            tenantId,
            userId,
            jobId: normalizedJobId,
            estimateVersionId: jobRow.estimate_version_id,
            action: "takeoff.item.modified",
            metadata: takeoffAuditMetadataBuilders["takeoff.item.modified"]({
              item_id: entry.item_id,
              field: audit.field,
              previous_value: audit.previous as null,
              next_value: audit.next as null,
            }),
            tableName: "takeoff_items",
            mode: "non-blocking",
          });
        }
      }

      results.push({
        item_id: entry.item_id,
        success: true,
        item: updatedItem,
      });
    } catch {
      results.push({
        item_id: entry.item_id,
        success: false,
        error: "Erreur interne lors de la mise a jour de l'item.",
      });
    }
  }

  return {
    results,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  };
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

import "server-only";

import { parseWithSchema } from "@/lib/takeoff/server-helpers";

import { z } from "zod";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

import { mapSupabaseError } from "@/lib/estimates/errors";

import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";

import { resolveTakeoffOperatorState } from "@/lib/takeoff/operator-state";

import {
  takeoffJobIdSchema,
  type GetTakeoffJobDetailsQuery,
  type ListTakeoffJobsQuery,
} from "@/lib/takeoff/schemas";

import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

import {
  type TakeoffProcessingStrategy,
  type TakeoffProviderBatchState,
  type TakeoffJobDetailResponse,
  type TakeoffJobItem,
  type TakeoffJobListResponse,
  type TakeoffJobResult,
  type TakeoffJobStatusCounters,
  type TakeoffJobSummary,
  type TakeoffJobListPeriod,
} from "@/lib/takeoff/types";

const DEFAULT_TAKEOFF_JOBS_LIST_LIMIT = 20;

const DEFAULT_TAKEOFF_JOB_ITEMS_LIMIT = 50;

const TAKEOFF_PROJECT_VERSIONS_BATCH_SIZE = 1000;

const TAKEOFF_JOB_LIST_PERIOD_DAYS: Record<TakeoffJobListPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const TAKEOFF_JOB_LIST_SELECT = [
  "id",
  "estimate_version_id",
  "status",
  "level",
  "processing_strategy",
  "provider_batch_id",
  "provider_batch_state",
  "provider_batch_updated_at",
  "source_file_name",
  "source_file_type",
  "source_file_size_bytes",
  "plan_set_id",
  "prompt_version",
  "schema_version",
  "model",
  "thinking_level",
  "media_resolution",
  "retry_count",
  "next_retry_at",
  "last_error_at",
  "dispatch_status",
  "dispatch_outcome",
  "dispatch_trigger",
  "dispatch_correlation_id",
  "dispatch_status_code",
  "dispatch_updated_at",
  "provider_reconcile_due_at",
  "provider_reconcile_attempt_count",
  "provider_reconcile_lease_expires_at",
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

export const TAKEOFF_JOB_DETAIL_SELECT = [
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

export const TAKEOFF_ITEMS_SELECT = [
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

export const jsonRecordSchema = z.record(z.string(), z.unknown());

const takeoffJobSummarySchema: z.ZodType<TakeoffJobSummary> = z
  .object({
    id: z.string().uuid(),
    estimate_version_id: z.string().uuid(),
    status: z.string(),
    level: z.string(),
    processing_strategy: z.enum(["sync", "batch"]).nullable().optional(),
    provider_batch_id: z.string().nullable().optional(),
    provider_batch_state: z
      .enum([
        "submitted",
        "pending",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "expired",
        "unknown",
      ])
      .nullable()
      .optional(),
    provider_batch_updated_at: z.string().nullable().optional(),
    source_file_name: z.string().nullable(),
    source_file_type: z.string().nullable(),
    source_file_size_bytes: z.number().int().nonnegative().nullable(),
    plan_set_id: z.string().uuid().nullable().optional(),
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
    dispatch_status: z
      .enum(["started", "queued", "trigger_failed"])
      .nullable()
      .optional(),
    dispatch_outcome: z
      .enum([
        "accepted",
        "configuration_missing",
        "http_error",
        "timeout",
        "network_error",
      ])
      .nullable()
      .optional(),
    dispatch_trigger: z
      .enum(["create", "retry", "manual", "reconcile"])
      .nullable()
      .optional(),
    dispatch_correlation_id: z.string().uuid().nullable().optional(),
    dispatch_status_code: z.number().int().min(100).max(599).nullable().optional(),
    dispatch_updated_at: z.string().nullable().optional(),
    provider_reconcile_due_at: z.string().nullable().optional(),
    provider_reconcile_attempt_count: z.number().int().nonnegative().nullable().optional(),
    provider_reconcile_lease_expires_at: z.string().nullable().optional(),
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
    processing_strategy: row.processing_strategy ?? null,
    provider_batch_id: row.provider_batch_id ?? null,
    provider_batch_state: row.provider_batch_state ?? null,
    provider_batch_updated_at: row.provider_batch_updated_at ?? null,
    source_file_name: row.source_file_name,
    source_file_type: row.source_file_type,
    source_file_size_bytes: row.source_file_size_bytes,
    plan_set_id: row.plan_set_id ?? null,
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
    dispatch_status: row.dispatch_status ?? null,
    dispatch_outcome: row.dispatch_outcome ?? null,
    dispatch_trigger: row.dispatch_trigger ?? null,
    dispatch_correlation_id: row.dispatch_correlation_id ?? null,
    dispatch_status_code: row.dispatch_status_code ?? null,
    dispatch_updated_at: row.dispatch_updated_at ?? null,
    provider_reconcile_due_at: row.provider_reconcile_due_at ?? null,
    provider_reconcile_attempt_count: row.provider_reconcile_attempt_count ?? 0,
    provider_reconcile_lease_expires_at:
      row.provider_reconcile_lease_expires_at ?? null,
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

export type TakeoffJobDetailRow = {
  id: string;
  estimate_version_id: string;
  status: string;
  level: string;
  processing_strategy: TakeoffProcessingStrategy | null;
  provider_batch_id: string | null;
  provider_batch_state: TakeoffProviderBatchState | null;
  provider_batch_updated_at: string | null;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  source_file_path: string | null;
  plan_set_id?: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  media_resolution: string | null;
  retry_count: number | null;
  next_retry_at: string | null;
  last_error_at: string | null;
  dispatch_status: "started" | "queued" | "trigger_failed" | null;
  dispatch_outcome:
    | "accepted"
    | "configuration_missing"
    | "http_error"
    | "timeout"
    | "network_error"
    | null;
  dispatch_trigger: "create" | "retry" | "manual" | "reconcile" | null;
  dispatch_correlation_id: string | null;
  dispatch_status_code: number | null;
  dispatch_updated_at: string | null;
  provider_reconcile_due_at: string | null;
  provider_reconcile_attempt_count: number | null;
  provider_reconcile_lease_token?: string | null;
  provider_reconcile_lease_expires_at: string | null;
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

export type TakeoffItemRow = {
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

export type AuthenticatedTakeoffContext = Awaited<
  ReturnType<typeof getAuthenticatedContext>
>;

function decorateTakeoffJobSummaryWithOperatorState(
  job: TakeoffJobSummary,
  tenantRole?: string | null
): TakeoffJobSummary {
  const operatorState = resolveTakeoffOperatorState({
    status: job.status,
    processingStrategy: job.processing_strategy,
    providerBatchId: job.provider_batch_id,
    providerBatchState: job.provider_batch_state,
    providerReconcileDueAt: job.provider_reconcile_due_at ?? null,
    providerReconcileLeaseExpiresAt:
      job.provider_reconcile_lease_expires_at ?? null,
    errorCode: job.error_code,
    retryCount: job.retry_count,
    tenantRole,
  });

  return {
    ...job,
    operator_state: operatorState.state,
    operator_state_label: operatorState.label,
    can_reconcile: operatorState.canReconcile,
    can_cancel: operatorState.canCancel,
    can_resubmit: operatorState.canResubmit,
  };
}

export function normalizeTakeoffJobSummaryRow(
  row: unknown,
  tenantRole?: string | null
): TakeoffJobSummary {
  return decorateTakeoffJobSummaryWithOperatorState(
    parseWithSchema(
      takeoffJobSummarySchema,
      row,
      "Données takeoff_jobs invalides en base."
    ),
    tenantRole
  );
}

function normalizeTakeoffJobSummaryRows(
  rows: unknown[],
  tenantRole?: string | null
): TakeoffJobSummary[] {
  return rows.map((row) => normalizeTakeoffJobSummaryRow(row, tenantRole));
}

function normalizeTakeoffResultRow(row: unknown): TakeoffJobResult {
  return parseWithSchema(
    takeoffJobResultSchema,
    row,
    "Données takeoff_results invalides en base."
  );
}

export function normalizeTakeoffItemRow(row: unknown): TakeoffJobItem {
  return parseWithSchema(
    takeoffJobItemSchema,
    row,
    "Données takeoff_items invalides en base."
  );
}

function normalizeTakeoffItemRows(rows: unknown[]): TakeoffJobItem[] {
  return rows.map((row) => normalizeTakeoffItemRow(row));
}

export async function getAuthenticatedTakeoffContext(): Promise<AuthenticatedTakeoffContext> {
  const context = await getAuthenticatedContext();
  await assertTakeoffEnabled(context.tenantId, { supabase: context.supabase });
  return context;
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

export async function getTakeoffJobDetailByIdOrThrow(input: {
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
      mapSupabaseError(error, "Impossible de charger le résultat du job takeoff."),
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

export async function listTakeoffItemsByJobId(input: {
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
        mapSupabaseError(error, "Impossible de résoudre les versions du projet."),
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
  const { supabase, tenantId, tenantRole } = await getAuthenticatedTakeoffContext();
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
          "Impossible de résoudre le numéro de version."
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

  const jobs = normalizeTakeoffJobSummaryRows(
    (data ?? []) as TakeoffJobDetailRow[],
    tenantRole
  );
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
  const { supabase, tenantId, tenantRole } = await getAuthenticatedTakeoffContext();
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
    job: normalizeTakeoffJobSummaryRow(jobRow, tenantRole),
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

const MAX_TAKEOFF_JOB_ITEMS_LIMIT = 200;

export async function listAllTakeoffItemsByJobId(input: {
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

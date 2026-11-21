import { mapSupabaseError } from "@/lib/http/api-response";
import { TAKEOFF_PROCESSING_LEASE_TTL_SECONDS } from "@/lib/takeoff/constants";
import { takeoffAnalysisFailureFields } from "@/lib/takeoff/completion-outcome";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { warning } from "@/lib/takeoff/exchange-normalization";
import {
  TAKEOFF_JOB_PROCESSING_SELECT,
  parseTakeoffJobRow,
  type TakeoffJobProcessingRow,
} from "@/lib/takeoff/job-lifecycle";
import type { buildLevelCRunMetricRows } from "@/lib/takeoff/level-c-chunk-metrics";
import type { ProcessableTakeoffLevel, Supabase } from "@/lib/takeoff/processing-context";

const TAKEOFF_PROCESSING_LEASE_TTL_MS = TAKEOFF_PROCESSING_LEASE_TTL_SECONDS * 1000;
const ATOMIC_PERSISTENCE_ROLLBACK_MARKER = "atomic_persistence_rollback_applied";

export type TakeoffClaimObservation = { status: string; retryCount: number };

export async function fetchCurrentTakeoffJobStatus(input: {
  supabase: Supabase;
  job: Pick<TakeoffJobProcessingRow, "id" | "tenant_id">;
  level: ProcessableTakeoffLevel;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select("status" as never)
    .eq("id" as never, input.job.id as never)
    .eq("tenant_id" as never, input.job.tenant_id as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de vérifier le statut courant du job takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  if (!data || typeof data !== "object" || !("status" in data)) {
    return null;
  }

  const status = (data as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

export function buildProcessingStatusConflictError(input: {
  jobId: string;
  currentStatus: string | null;
  operation: string;
  level: ProcessableTakeoffLevel;
}) {
  return new TakeoffError({
    status: 409,
    code: TakeoffErrorCode.CONFLICT,
    message:
      input.currentStatus === "canceled"
        ? "Le job a été annulé pendant le traitement."
        : "Le job n'est plus en cours de traitement.",
    details: {
      expected_status: "processing",
      current_status: input.currentStatus,
      operation: input.operation,
    },
    retryable: false,
    jobId: input.jobId,
    level: input.level,
  });
}

export function isCanceledDuringProcessingConflict(error: TakeoffError) {
  if (error.code !== TakeoffErrorCode.CONFLICT) {
    return false;
  }

  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return false;
  }

  return (details as Record<string, unknown>).current_status === "canceled";
}

export async function getTakeoffJobForProcessing(input: {
  supabase: Supabase;
  jobId: string;
  tenantId: string | null;
  level: ProcessableTakeoffLevel;
}): Promise<TakeoffJobProcessingRow> {
  let query = input.supabase
    .from("takeoff_jobs" as never)
    .select(TAKEOFF_JOB_PROCESSING_SELECT as never)
    .eq("id" as never, input.jobId as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
        level: input.level,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      retryable: false,
      jobId: input.jobId,
      level: input.level,
    });
  }

  return parseTakeoffJobRow(data);
}

export async function markJobAsProcessing(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  hostId: string;
  startedAtIso: string;
  model: string;
  promptVersion: string;
  level: ProcessableTakeoffLevel;
  observed: TakeoffClaimObservation;
}): Promise<TakeoffJobProcessingRow> {
  const processingLeaseToken = crypto.randomUUID();
  const processingLeaseExpiresAt = new Date(
    Date.parse(input.startedAtIso) + TAKEOFF_PROCESSING_LEASE_TTL_MS
  ).toISOString();

  const { data, error } = await input.supabase.rpc("claim_observed_local_takeoff_job" as never, {
    p_job_id: input.job.id, p_tenant_id: input.job.tenant_id, p_host_id: input.hostId,
    p_started_at: input.startedAtIso, p_lease_token: processingLeaseToken,
    p_lease_expires_at: processingLeaseExpiresAt, p_model: input.model,
    p_prompt_version: input.promptVersion,
    p_observed_status: input.observed.status, p_observed_retry_count: input.observed.retryCount,
  } as never).maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de basculer le job en traitement (processing)."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      code: TakeoffErrorCode.CONFLICT,
      message: `Le job ne peut pas être traité depuis le statut '${input.job.status}'.`,
      details: {
        current_status: input.job.status,
      },
      retryable: false,
      jobId: input.job.id,
      level: input.level,
    });
  }

  return parseTakeoffJobRow(data);
}

/**
 * The failure, its retry decision and its diagnostic commit together, under the job's unexpired lease. Returns the failure
 * as recorded, for the audit: the worker's own, unless the database ended the job otherwise.
 */
export async function recordLocalTakeoffFailure(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  completedAtIso: string;
  durationMs: number;
  error: TakeoffError;
  diagnostic: Record<string, unknown> | null;
  runMetrics: ReturnType<typeof buildLevelCRunMetricRows>;
}) {
  const { data, error } = await input.supabase.rpc("record_local_takeoff_failure" as never, {
    p_job_id: input.job.id,
    p_tenant_id: input.job.tenant_id,
    p_lease_token: input.job.processing_lease_token,
    p_failure: {
      completed_at: input.completedAtIso,
      duration_ms: input.durationMs,
      error_code: input.error.code,
      error_message: input.error.message,
      ...takeoffAnalysisFailureFields({
        retryable: input.error.retryable,
        retryCount: input.job.retry_count,
        completedAtIso: input.completedAtIso,
      }),
    },
    p_diagnostic: input.diagnostic,
    p_run_metrics: input.runMetrics,
  } as never);

  if (error) {
    console.error("Impossible de marquer le job takeoff en échec.", {
      job_id: input.job.id,
      tenant_id: input.job.tenant_id,
      error,
    });
  }
  if (!data) throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease takeoff n'est plus disponible pour clore le job.", retryable: false, jobId: input.job.id });
  // The end the database recorded: it ends without a retry an attempt that holds a paid call of unknown outcome
  // (migration 20261121181031_takeoff_plan_dispatcher.sql); before it answered only its diagnostic.
  const recorded = data as { error_code?: unknown; error_message?: unknown; retry_scheduled?: unknown };
  if (typeof recorded.error_code !== "string" || recorded.error_code === input.error.code) return input.error;
  return new TakeoffError({ code: recorded.error_code as TakeoffErrorCode, status: input.error.status, retryable: recorded.retry_scheduled === true,
    message: typeof recorded.error_message === "string" ? recorded.error_message : input.error.message, jobId: input.job.id });
}

/**
 * The worker's end of an attempt that may have held the Mac's slot (migration 20261121181031_takeoff_plan_dispatcher.sql):
 * whatever ended the job (its own write, or a member's stop that made that write refused), the Mac is given back for the
 * next plan. A no-op once the job's end gave it back, or for an attempt that never held it; best effort: the slot lapses
 * with the lease anyway.
 */
export async function releaseTakeoffHostSlot(supabase: Supabase, input: { hostId: string; leaseToken: string }) {
  try {
    const { error } = await supabase.rpc("release_takeoff_host_slot" as never,
      { p_host_id: input.hostId, p_lease_token: input.leaseToken } as never);
    if (error) console.error("takeoff.host_slot.release_failed", { host_id: input.hostId, code: error.code });
  } catch {
    console.error("takeoff.host_slot.release_failed", { host_id: input.hostId });
  }
}

export function annotateAtomicPersistenceRollbackError(error: TakeoffError) {
  const details: Record<string, unknown> =
    error.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? { ...(error.details as Record<string, unknown>) }
      : { cause: error.details };

  details[ATOMIC_PERSISTENCE_ROLLBACK_MARKER] = true;

  return new TakeoffError({
    code: error.code,
    status: error.status,
    message: error.message,
    details,
    retryable: error.retryable,
    jobId: error.jobId,
    level: error.level,
  });
}

export function hasAtomicPersistenceRollbackError(error: TakeoffError) {
  if (!error.details || typeof error.details !== "object" || Array.isArray(error.details)) {
    return false;
  }

  return (
    (error.details as Record<string, unknown>)[ATOMIC_PERSISTENCE_ROLLBACK_MARKER] === true
  );
}

function extractRawResponseFromTakeoffError(error: TakeoffError): unknown {
  const details = error.details;
  if (!details || typeof details !== "object") {
    return details ?? null;
  }

  const record = details as Record<string, unknown>;

  if ("cause" in record) {
    return record.cause;
  }

  return record;
}

/** The failure diagnostic that replaces the job's previous rows, or null when there is nothing to retain. */
export function buildFailureDiagnostic(input: {
  error: TakeoffError;
  durationMs: number;
  model: string;
  promptVersion: string;
  retainMetrics: boolean;
}): Record<string, unknown> | null {
  const rawResponse = extractRawResponseFromTakeoffError(input.error);
  if (rawResponse == null && !input.retainMetrics) {
    return null;
  }

  return {
    extracted_json: {},
    warnings: [
      warning({
        code: "PROCESSING_FAILED",
        message: input.error.message,
        severity: input.error.retryable ? "warning" : "error",
      }),
    ],
    tables: [],
    provider_meta: {
      status: "failed",
      model: input.model,
      prompt_version: input.promptVersion,
      error_code: input.error.code,
    },
    raw_response: rawResponse ?? null,
    token_count: 0,
    cost_cents: 0,
    duration_ms: input.durationMs,
  };
}

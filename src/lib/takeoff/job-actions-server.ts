import "server-only";

import { mapSupabaseError } from "@/lib/http/api-response";
import { hasScheduledLocalTakeoffRetry } from "@/lib/takeoff/completion-outcome";
import { assertLocalTakeoffResumeReady } from "@/lib/ai/chatgpt-takeoff";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TAKEOFF_RETRY_BACKOFF_SECONDS, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  normalizeTakeoffJobSummaryRow,
  TAKEOFF_JOB_DETAIL_SELECT,
  type TakeoffJobDetailRow,
} from "@/lib/takeoff/job-read-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import {
  assertTakeoffOperatorActionRole,
  parseWithSchema,
  TAKEOFF_TENANT_ADMIN_ROLE,
  TAKEOFF_TENANT_ENGINEER_ROLE,
} from "@/lib/takeoff/server-helpers";
import type { TakeoffJobActionResponse } from "@/lib/takeoff/types";

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
  action: "cancel" | "resubmit";
}): TakeoffError {
  const message =
    input.action === "resubmit"
      ? "Le job doit être en statut failed ou canceled pour être resoumis."
      : "Le job doit être en statut pending ou processing pour être annulé.";

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

function toTakeoffOperatorAuditRole(
  tenantRole: string | null | undefined
): "admin" | "engineer" | null {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) {
    return "admin";
  }

  if (tenantRole === TAKEOFF_TENANT_ENGINEER_ROLE) {
    return "engineer";
  }

  return null;
}

function buildTakeoffJobResetUpdate(input: { retryCount: number }) {
  return {
    status: "pending",
    retry_count: input.retryCount + 1,
    next_retry_at: null,
    last_error_at: null,
    started_at: null,
    completed_at: null,
    token_count: null,
    cost_cents: null,
    duration_ms: null,
    error_code: null,
    error_message: null,
  };
}

function assertCanManuallyResubmitAnalysis(job: TakeoffJobDetailRow) {
  const message = job.analysis_outcome
    ? "Cette analyse est close. Préparez une nouvelle analyse depuis l’affaire."
    : hasScheduledLocalTakeoffRetry(job) ? "Une reprise automatique de cette analyse est déjà programmée." : null;
  if (message) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message,
      retryable: false,
      jobId: job.id,
    });
  }
}

export async function resubmitTakeoffJob(
  jobId: string
): Promise<TakeoffJobActionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);

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
  assertCanManuallyResubmitAnalysis(existingJob);
  await assertLocalTakeoffResumeReady(supabase, tenantId, existingJob);

  if (existingJob.status !== "failed" && existingJob.status !== "canceled") {
    throw buildTerminalStatusConflictError({
      action: "resubmit",
      status: existingJob.status,
      allowedStatuses: ["failed", "canceled"],
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

  if (existingJob.status === "failed" && existingJob.completed_at) {
    const requiredBackoffMs = getTakeoffRetryBackoffMs(retryCount);
    const completedAtMs = Date.parse(existingJob.completed_at);
    if (Number.isFinite(completedAtMs)) {
      const earliestRetryAtMs = completedAtMs + requiredBackoffMs;
      if (Date.now() < earliestRetryAtMs) {
        throw new TakeoffError({
          status: 409,
          code: TakeoffErrorCode.CONFLICT,
          message: "Le délai de relance n'est pas encore écoulé pour cette analyse.",
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
    .update(buildTakeoffJobResetUpdate({ retryCount }) as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedJobId as never)
    .in("status" as never, ["failed", "canceled"] as never)
    .select(TAKEOFF_JOB_DETAIL_SELECT as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de resoumettre le job takeoff."),
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
      message: "Le job n'est plus dans un statut resoumettable.",
      details: {
        allowed_statuses: ["failed", "canceled"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const updatedJob = data as TakeoffJobDetailRow;

  await logTakeoffAuditEvent({
    supabase,
    tenantId,
    userId,
    jobId: normalizedJobId,
    estimateVersionId: updatedJob.estimate_version_id,
    action: "takeoff.job.resubmitted",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.resubmitted"]({
      from_attempt: retryCount + 1,
      to_attempt: retryCount + 2,
      reason: "manual_resubmit",
      requested_by_role: toTakeoffOperatorAuditRole(tenantRole),
      from_status: existingJob.status,
      from_provider_batch_state: existingJob.provider_batch_state,
      outcome: "applied",
    }),
    mode: "non-blocking",
  });

  return {
    job: normalizeTakeoffJobSummaryRow(updatedJob, tenantRole),
    command: "resubmit",
    outcome: "applied",
  };
}

export async function cancelTakeoffJob(jobId: string): Promise<TakeoffJobActionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
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
    job: normalizeTakeoffJobSummaryRow(updatedJob, tenantRole),
    command: "cancel",
    outcome: "applied",
  };
}

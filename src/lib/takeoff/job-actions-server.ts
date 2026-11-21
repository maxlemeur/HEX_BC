import "server-only";

import { mapSupabaseError } from "@/lib/http/api-response";
import { assertLocalTakeoffResumeReady } from "@/lib/ai/chatgpt-takeoff";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  normalizeTakeoffJobSummaryRow,
  TAKEOFF_JOB_DETAIL_SELECT,
  type TakeoffJobDetailRow,
} from "@/lib/takeoff/job-read-server";
import {
  canTakeoffResumeViewerAct,
  describeTakeoffResume,
  getTakeoffRetryBackoffMs,
  resolveTakeoffOperatorState,
  toTakeoffOperatorStateInput,
  type TakeoffResumeDecision,
  type TakeoffResumeViewer,
} from "@/lib/takeoff/operator-state";
import { readTakeoffResumeViewers } from "@/lib/takeoff/resume-viewer-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import {
  assertTakeoffOperatorActionRole,
  parseWithSchema,
  TAKEOFF_TENANT_ADMIN_ROLE,
  TAKEOFF_TENANT_ENGINEER_ROLE,
} from "@/lib/takeoff/server-helpers";
import type { TakeoffJobActionResponse } from "@/lib/takeoff/types";

function buildTerminalStatusConflictError(input: {
  status: string;
  allowedStatuses: string[];
}): TakeoffError {
  return new TakeoffError({
    status: 409,
    code: TakeoffErrorCode.CONFLICT,
    message: "Le job doit être en statut pending ou processing pour être annulé.",
    details: {
      action: "cancel",
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

/**
 * The refusal of a retry the resume policy does not allow, with the policy's reason as its code: the list and the
 * detail showed the same decision. A member who may not act on the affaire is refused as such, whatever the job.
 */
function buildResumeRefusal(job: TakeoffJobDetailRow, decision: TakeoffResumeDecision, viewer: TakeoffResumeViewer): TakeoffError {
  const [status, code] = !canTakeoffResumeViewerAct(viewer) || decision.reason === "launched_by_other"
    ? [403, TakeoffErrorCode.FORBIDDEN] as const
    : decision.reason === "legacy_provider" || decision.reason === "execution_unavailable" || decision.reason === "other_mac"
      ? [422, TakeoffErrorCode.AI_PROVIDER] as const
      : [409, TakeoffErrorCode.CONFLICT] as const;
  const retryCount = job.retry_count ?? 0;
  return new TakeoffError({
    status,
    code,
    message: describeTakeoffResume(decision) ?? "Cette analyse n’est pas arrêtée : elle ne peut pas être soumise à nouveau.",
    details: {
      resume: { action: decision.action, reason: decision.reason, available_at: decision.availableAt },
      ...decision.reason === "not_stopped" ? { action: "resubmit", current_status: job.status, allowed_statuses: ["failed", "canceled"] } : {},
      ...decision.reason === "retry_limit" ? { retry_count: retryCount, retry_max: TAKEOFF_RETRY_MAX } : {},
      ...decision.reason === "retry_delay" ? {
        retry_count: retryCount, retry_backoff_ms: getTakeoffRetryBackoffMs(retryCount), retry_available_at: decision.availableAt,
      } : {},
    },
    retryable: false,
    jobId: job.id,
  });
}

export async function resubmitTakeoffJob(
  jobId: string
): Promise<TakeoffJobActionResponse> {
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
  // Role, rights on the affaire, state, recorded end, retry schedule, delay and Mac are read again now: the screen
  // showed a decision of the same policy, which may have changed since.
  const viewerOf = await readTakeoffResumeViewers({
    supabase, tenantId, member: { userId, tenantRole }, projectIds: [existingJob.project_id],
  });
  const viewer = viewerOf(existingJob.project_id);
  const { resume } = resolveTakeoffOperatorState(toTakeoffOperatorStateInput(existingJob, viewer));
  if (resume.action !== "retry_now") throw buildResumeRefusal(existingJob, resume, viewer);
  // The launcher's ChatGPT connection, model and Mac, which no list reads.
  await assertLocalTakeoffResumeReady(supabase, tenantId, existingJob);

  const retryCount = existingJob.retry_count ?? 0;
  // Compare and set: a concurrent retry, a scheduled retry or a recorded end since the read leaves the row unchanged.
  let reset = supabase
    .from("takeoff_jobs" as never)
    .update(buildTakeoffJobResetUpdate({ retryCount }) as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedJobId as never)
    .eq("status" as never, existingJob.status as never)
    .is("analysis_outcome" as never, null)
    .is("next_retry_at" as never, null);
  reset = existingJob.retry_count === null
    ? reset.is("retry_count" as never, null)
    : reset.eq("retry_count" as never, existingJob.retry_count as never);
  const { data, error } = await reset
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
      message: "Cette analyse a changé depuis sa lecture. Rechargez le suivi avant de la soumettre à nouveau.",
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
    job: normalizeTakeoffJobSummaryRow(updatedJob, tenantRole, viewer),
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
      status: existingJob.status,
      allowedStatuses: ["pending", "processing"],
    });
  }

  // Read before the write: the answer's resume decision must not turn a written cancel into a reported failure.
  const viewerOf = await readTakeoffResumeViewers({
    supabase, tenantId, member: { userId, tenantRole }, projectIds: [existingJob.project_id],
  });
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
    job: normalizeTakeoffJobSummaryRow(updatedJob, tenantRole, viewerOf(updatedJob.project_id)),
    command: "cancel",
    outcome: "applied",
  };
}

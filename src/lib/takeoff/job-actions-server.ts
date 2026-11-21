import "server-only";

import { mapSupabaseError } from "@/lib/http/api-response";
import { assertLocalTakeoffResumeReady } from "@/lib/ai/chatgpt-takeoff";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { isRecord } from "@/lib/value-guards";
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
    message: "Seule une analyse en file ou en traitement peut être annulée.",
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

function toResumeDetails(decision: TakeoffResumeDecision) {
  return { action: decision.action, reason: decision.reason, available_at: decision.availableAt };
}

/** A refusal of a check the policy does not read, with the decision in force attached for the screen to adopt. */
function withResumeDecision(error: unknown, decision: TakeoffResumeDecision): unknown {
  if (!(error instanceof TakeoffError)) return error;
  return new TakeoffError({
    status: error.status,
    code: error.code,
    message: error.message,
    details: { ...(isRecord(error.details) ? error.details : {}), resume: toResumeDetails(decision) },
    retryable: error.retryable,
    jobId: error.jobId,
  });
}

/**
 * The refusal of a retry the resume policy does not allow, with the policy's reason as its code: the list and the
 * detail showed the same decision. A member who may not act on the affaire is refused as such, whatever the job.
 */
function buildResumeRefusal(job: TakeoffJobDetailRow, decision: TakeoffResumeDecision, viewer: TakeoffResumeViewer): TakeoffError {
  const [status, code] = !canTakeoffResumeViewerAct(viewer) || decision.reason === "launched_by_other"
    ? [403, TakeoffErrorCode.FORBIDDEN] as const
    : decision.reason === "legacy_provider" || decision.reason === "execution_unavailable" || decision.reason === "other_mac"
      || decision.reason === "plan_disconnected" || decision.reason === "plan_model_missing"
      ? [422, TakeoffErrorCode.AI_PROVIDER] as const
      : [409, TakeoffErrorCode.CONFLICT] as const;
  const retryCount = job.retry_count ?? 0;
  return new TakeoffError({
    status,
    code,
    message: describeTakeoffResume(decision) ?? "Cette analyse n’est pas arrêtée : elle ne peut pas être soumise à nouveau.",
    details: {
      resume: toResumeDetails(decision),
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
  // Role, rights on the affaire, state, recorded end, retry schedule, delay, Mac and the member's own ChatGPT connection
  // are read again now: the screen showed a decision of the same policy, which may have changed since.
  const decideNow = async (job: TakeoffJobDetailRow) => {
    const viewerOf = await readTakeoffResumeViewers({
      supabase, tenantId, member: { userId, tenantRole }, projectIds: [job.project_id],
    });
    const viewer = viewerOf(job.project_id);
    return { viewer, resume: resolveTakeoffOperatorState(toTakeoffOperatorStateInput(job, viewer)).resume };
  };
  // The decision a refusal carries is read after the refusal's cause: the job, the member's rights and connection again.
  const decideAgain = async () => {
    const current = await getTakeoffJobDetailByIdOrThrow({ supabase, tenantId, jobId: normalizedJobId });
    return (await decideNow(current)).resume;
  };
  const first = await decideNow(existingJob);
  if (first.resume.action !== "retry_now") throw buildResumeRefusal(existingJob, first.resume, first.viewer);
  // What no list reads (the launcher's membership, the schema, the selection confirmed at launch).
  try {
    await assertLocalTakeoffResumeReady(supabase, tenantId, existingJob);
  } catch (error) {
    throw withResumeDecision(error, await decideAgain());
  }
  // The right to write the affaire is read again just before the write, which the database guards by the same role and
  // ownership rule (row security of the update) and by the launcher (below).
  const { viewer, resume } = await decideNow(existingJob);
  if (resume.action !== "retry_now") throw buildResumeRefusal(existingJob, resume, viewer);

  const retryCount = existingJob.retry_count ?? 0;
  // Compare and set: a concurrent retry, a scheduled retry, a recorded end or another launcher since the read leaves the
  // row unchanged.
  let reset = supabase
    .from("takeoff_jobs" as never)
    .update(buildTakeoffJobResetUpdate({ retryCount }) as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedJobId as never)
    .eq("status" as never, existingJob.status as never)
    .eq("created_by" as never, userId as never)
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
    // The answer carries the decision now in force, which the row adopts.
    const now = await decideAgain();
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Cette analyse a changé depuis sa lecture. Rechargez le suivi avant de la soumettre à nouveau.",
      details: {
        resume: toResumeDetails(now),
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
  // The right to write the affaire, read just before the write, which the database guards by the same role and
  // ownership rule (row security of the update).
  const viewerOf = await readTakeoffResumeViewers({
    supabase, tenantId, member: { userId, tenantRole }, projectIds: [existingJob.project_id],
  });
  if (!canTakeoffResumeViewerAct(viewerOf(existingJob.project_id))) {
    throw new TakeoffError({
      status: 403,
      code: TakeoffErrorCode.FORBIDDEN,
      message: "Vous ne pouvez pas annuler cette analyse : votre profil ne peut pas modifier cette affaire.",
      retryable: false,
      jobId: normalizedJobId,
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
      message: "Cette analyse n’est plus en file ni en traitement : elle ne peut plus être annulée.",
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

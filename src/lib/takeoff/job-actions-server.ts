import "server-only";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { assertLocalTakeoffResumeReady } from "@/lib/ai/chatgpt-takeoff";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  normalizeTakeoffJobSummaryRow,
  TAKEOFF_JOB_DETAIL_SELECT,
  type TakeoffJobDetailRow,
} from "@/lib/takeoff/job-read-server";
import { resolveTakeoffOperatorState } from "@/lib/takeoff/operator-state";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import {
  assertTakeoffOperatorActionRole,
  parseWithSchema,
  TAKEOFF_TENANT_ADMIN_ROLE,
  TAKEOFF_TENANT_ENGINEER_ROLE,
} from "@/lib/takeoff/server-helpers";
import type { TakeoffJobActionResponse, TakeoffProviderBatchState } from "@/lib/takeoff/types";

const TAKEOFF_PROVIDER_TERMINAL_STATES = new Set<TakeoffProviderBatchState>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

const TAKEOFF_RETRY_MAX = 3;

const TAKEOFF_RETRY_BACKOFF_SECONDS = [5, 15, 45] as const;

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
  action: "retry" | "cancel" | "resubmit";
}): TakeoffError {
  const message =
    input.action === "retry"
      ? "Le job doit être en statut failed pour être relance."
      : input.action === "resubmit"
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
    provider_batch_id: null,
    provider_batch_state: null,
    provider_batch_updated_at: null,
    provider_reconcile_due_at: null,
    provider_reconcile_attempt_count: 0,
    provider_reconcile_lease_token: null,
    provider_reconcile_lease_expires_at: null,
  };
}

function assertTakeoffProviderBatchCanReset(
  existingJob: TakeoffJobDetailRow,
  jobId: string
) {
  const hasProviderBatchReference =
    existingJob.processing_strategy === "batch" &&
    typeof existingJob.provider_batch_id === "string" &&
    existingJob.provider_batch_id.length > 0;
  const hasSucceededProviderBatch =
    hasProviderBatchReference && existingJob.provider_batch_state === "succeeded";
  const hasLiveProviderBatch =
    hasProviderBatchReference &&
    !(
      existingJob.provider_batch_state &&
      TAKEOFF_PROVIDER_TERMINAL_STATES.has(existingJob.provider_batch_state)
    );

  if (hasSucceededProviderBatch) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Le batch provider a déjà réussi. Relancez un reconcile au lieu d'une resoumission.",
      details: {
        provider_batch_id: existingJob.provider_batch_id,
        provider_batch_state: existingJob.provider_batch_state,
      },
      retryable: false,
      jobId,
    });
  }

  if (hasLiveProviderBatch) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Le job possede déjà un batch provider actif. Relancez un reconcile au lieu d'une resoumission.",
      details: {
        provider_batch_id: existingJob.provider_batch_id,
        provider_batch_state: existingJob.provider_batch_state,
      },
      retryable: false,
      jobId,
    });
  }
}

export async function reconcileTakeoffJobNow(
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
  await assertLocalTakeoffResumeReady(supabase, tenantId, existingJob);
  const operatorState = resolveTakeoffOperatorState({
    status: existingJob.status,
    processingStrategy: existingJob.processing_strategy,
    providerBatchId: existingJob.provider_batch_id,
    providerBatchState: existingJob.provider_batch_state,
    providerReconcileDueAt: existingJob.provider_reconcile_due_at,
    providerReconcileLeaseExpiresAt: existingJob.provider_reconcile_lease_expires_at,
    errorCode: existingJob.error_code,
    retryCount: existingJob.retry_count,
    tenantRole,
  });

  if (existingJob.processing_strategy !== "batch" || !existingJob.provider_batch_id) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job n'est pas un job batch relancable en reconcile.",
      details: {
        processing_strategy: existingJob.processing_strategy,
        provider_batch_id: existingJob.provider_batch_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  if (!operatorState.canReconcile) {
    await logTakeoffAuditEvent({
      supabase,
      tenantId,
      userId,
      jobId: normalizedJobId,
      estimateVersionId: existingJob.estimate_version_id,
      action: "takeoff.job.reconcile_requested",
      metadata: takeoffAuditMetadataBuilders["takeoff.job.reconcile_requested"]({
        reason: "manual_reconcile",
        requested_by_role: toTakeoffOperatorAuditRole(tenantRole),
        from_status: existingJob.status,
        from_provider_batch_state: existingJob.provider_batch_state,
        outcome: "noop",
      }),
      mode: "non-blocking",
    });

    return {
      job: normalizeTakeoffJobSummaryRow(existingJob, tenantRole),
      command: "reconcile",
      outcome: "noop",
    };
  }

  const reconcileRequestedAt = new Date().toISOString();
  const updatePayload: Partial<TakeoffJobDetailRow> = {
    provider_reconcile_due_at: reconcileRequestedAt,
    provider_reconcile_attempt_count: existingJob.provider_reconcile_attempt_count ?? 0,
    provider_reconcile_lease_token: null,
    provider_reconcile_lease_expires_at: null,
  };

  if (existingJob.status === "failed") {
    updatePayload.status = "processing";
    updatePayload.completed_at = null;
    updatePayload.last_error_at = null;
    updatePayload.error_code = null;
    updatePayload.error_message = null;
    // Reprise manuelle d'un job échoué (ex. AI_TIMEOUT après épuisement des
    // tentatives) : on repart de zéro. Sans ce reset, la garde du worker
    // ((attemptCount > MAX_ATTEMPTS)) reste vraie et le job retombe
    // immédiatement en échec, le rendant irrécupérable via l'UI.
    updatePayload.provider_reconcile_attempt_count = 0;
  }

  const query = supabase
    .from("takeoff_jobs" as never)
    .update(updatePayload as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedJobId as never);

  const { data, error } =
    existingJob.status === "failed"
      ? await query
          .eq("status" as never, "failed" as never)
          .select(TAKEOFF_JOB_DETAIL_SELECT as never)
          .maybeSingle()
      : await query
          .eq("status" as never, "processing" as never)
          .select(TAKEOFF_JOB_DETAIL_SELECT as never)
          .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de relancer le reconcile du job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  const updatedJob = (data as TakeoffJobDetailRow | null) ?? existingJob;
  const outcome = data ? "applied" : "noop";

  await logTakeoffAuditEvent({
    supabase,
    tenantId,
    userId,
    jobId: normalizedJobId,
    estimateVersionId: updatedJob.estimate_version_id,
    action: "takeoff.job.reconcile_requested",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.reconcile_requested"]({
      reason: "manual_reconcile",
      requested_by_role: toTakeoffOperatorAuditRole(tenantRole),
      from_status: existingJob.status,
      from_provider_batch_state: existingJob.provider_batch_state,
      outcome,
    }),
    mode: "non-blocking",
  });

  return {
    job: normalizeTakeoffJobSummaryRow(updatedJob, tenantRole),
    command: "reconcile",
    outcome,
  };
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
  await assertLocalTakeoffResumeReady(supabase, tenantId, existingJob);

  if (existingJob.status !== "failed" && existingJob.status !== "canceled") {
    throw buildTerminalStatusConflictError({
      action: "resubmit",
      status: existingJob.status,
      allowedStatuses: ["failed", "canceled"],
    });
  }

  const retryCount = existingJob.retry_count ?? 0;
  assertTakeoffProviderBatchCanReset(existingJob, normalizedJobId);

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

export async function retryTakeoffJob(jobId: string): Promise<TakeoffJobActionResponse> {
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
  await assertLocalTakeoffResumeReady(supabase, tenantId, existingJob);

  if (existingJob.status !== "failed") {
    throw buildTerminalStatusConflictError({
      action: "retry",
      status: existingJob.status,
      allowedStatuses: ["failed"],
    });
  }

  const retryCount = existingJob.retry_count ?? 0;
  assertTakeoffProviderBatchCanReset(existingJob, normalizedJobId);
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
    job: normalizeTakeoffJobSummaryRow(updatedJob, tenantRole),
    command: "retry",
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

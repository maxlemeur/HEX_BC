import { reportError } from "@/lib/observability/error-reporter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS,
  TAKEOFF_BATCH_RECONCILE_MAX_ATTEMPTS,
  TAKEOFF_PROCESSING_LEASE_TTL_SECONDS,
} from "@/lib/takeoff/constants";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  normalizeTakeoffWorkerJobRow,
  type TakeoffWorkerJobRow,
} from "@/lib/takeoff/job-lifecycle";
import {
  processLevelA,
  processLevelB,
  processLevelC,
  reconcileTakeoffBatchJob,
} from "@/lib/takeoff/processor";
import { getTakeoffBatchReconcileBackoffSeconds } from "@/lib/takeoff/provider-batch";
import type {
  TakeoffJobAttemptOutcome,
  TakeoffJobAttemptTrigger,
} from "@/lib/takeoff/types";
import {
  isWorkflowTenantActive,
  type WorkflowTenantClient,
} from "@/lib/workflows/active-tenant";

const TAKEOFF_RETRY_MAX = 3;
const TAKEOFF_RETRY_BACKOFF_SECONDS = [5, 15, 45] as const;
const TAKEOFF_TERMINAL_JOB_STATUSES = new Set(["completed", "canceled", "applied"]);

type SupabaseMutationResult = {
  data: unknown;
  error: unknown;
};

type SupabaseSelectBuilderLike = {
  eq: (column: string, value: unknown) => SupabaseSelectBuilderLike;
  maybeSingle: () => Promise<SupabaseMutationResult>;
};

type SupabaseUpdateBuilderLike = PromiseLike<SupabaseMutationResult> & {
  eq: (column: string, value: unknown) => SupabaseUpdateBuilderLike;
  select: (columns: string) => SupabaseUpdateBuilderLike;
  maybeSingle: () => Promise<SupabaseMutationResult>;
};

type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns: string) => SupabaseSelectBuilderLike;
    update: (payload: Record<string, unknown>) => SupabaseUpdateBuilderLike;
  };
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<SupabaseMutationResult>;
};

type TakeoffWorkerRepository = {
  getJobById: (jobId: string) => Promise<TakeoffWorkerJobRow | null>;
  isTenantActive: (tenantId: string) => Promise<boolean>;
  markUnsupportedLevelAsFailed: (input: {
    jobId: string;
    tenantId: string;
    nowIso: string;
  }) => Promise<void>;
  scheduleRetry: (input: {
    jobId: string;
    tenantId: string;
    nextRetryAtIso: string;
    lastErrorAtIso: string;
  }) => Promise<void>;
  clearRetrySchedule: (input: {
    jobId: string;
    tenantId: string;
    lastErrorAtIso?: string;
  }) => Promise<void>;
  acquireBatchReconcileLease: (input: {
    jobId: string;
    tenantId: string;
    nowIso: string;
    leaseToken: string;
    leaseExpiresAtIso: string;
  }) => Promise<{
    claimed: boolean;
    attemptCount: number | null;
  }>;
  renewLease: (input: {
    kind: "processing" | "reconcile";
    jobId: string;
    tenantId: string;
    leaseToken: string;
    nowIso: string;
    leaseExpiresAtIso: string;
  }) => Promise<void>;
  scheduleReconcile: (input: {
    jobId: string;
    tenantId: string;
    dueAtIso: string;
    leaseToken: string;
  }) => Promise<void>;
  markBatchReconcileTimeoutAsFailed: (input: {
    jobId: string;
    tenantId: string;
    nowIso: string;
    leaseToken: string;
  }) => Promise<void>;
};

type ProcessTakeoffJobAttemptOptions = {
  correlationId: string;
  trigger: TakeoffJobAttemptTrigger;
  now?: () => Date;
  processLevelAFn?: typeof processLevelA;
  processLevelBFn?: typeof processLevelB;
  processLevelCFn?: typeof processLevelC;
  reconcileTakeoffBatchJobFn?: typeof reconcileTakeoffBatchJob;
  repository?: TakeoffWorkerRepository;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
};

function getRetryBackoffSeconds(retryCount: number) {
  const clamped = Math.max(0, Math.min(retryCount, TAKEOFF_RETRY_BACKOFF_SECONDS.length - 1));
  return TAKEOFF_RETRY_BACKOFF_SECONDS[clamped];
}

function sanitizeRetryCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isBatchReconcileCandidate(job: TakeoffWorkerJobRow) {
  return (
    job.status === "processing" &&
    job.processing_strategy === "batch" &&
    typeof job.provider_batch_id === "string" &&
    job.provider_batch_id.length > 0
  );
}

function hasTerminalProviderBatchState(job: TakeoffWorkerJobRow) {
  return ["succeeded", "failed", "cancelled", "expired"].includes(
    job.provider_batch_state ?? ""
  );
}

function createSupabaseTakeoffWorkerRepository(
  supabase: SupabaseClientLike
): TakeoffWorkerRepository {
  return {
    async getJobById(jobId) {
      const { data, error } = await supabase
        .from("takeoff_jobs")
        .select(
          [
            "id",
            "tenant_id",
            "level",
            "status",
            "processing_strategy",
            "provider_batch_id",
            "provider_batch_state",
            "provider_reconcile_due_at",
            "provider_reconcile_attempt_count",
            "provider_reconcile_lease_token",
            "provider_reconcile_lease_expires_at",
            "retry_count",
            "error_code",
            "error_message",
            "created_by",
            "next_retry_at",
            "last_error_at",
          ].join(",")
        )
        .eq("id", jobId)
        .maybeSingle();

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de lire le job takeoff.",
          retryable: false,
          jobId,
        });
      }

      return normalizeTakeoffWorkerJobRow(data);
    },

    async isTenantActive(tenantId) {
      return isWorkflowTenantActive(
        supabase as unknown as WorkflowTenantClient,
        tenantId
      );
    },

    async markUnsupportedLevelAsFailed(input) {
      const { error } = await supabase
        .from("takeoff_jobs")
        .update({
          status: "failed",
          completed_at: input.nowIso,
          error_code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
          error_message: "Le niveau takeoff n'est pas encore supporte par le worker async.",
          next_retry_at: null,
          last_error_at: input.nowIso,
        })
        .eq("id", input.jobId)
        .eq("tenant_id", input.tenantId);

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de marquer le job takeoff en echec.",
          retryable: false,
          jobId: input.jobId,
        });
      }
    },

    async scheduleRetry(input) {
      const { error } = await supabase
        .from("takeoff_jobs")
        .update({
          next_retry_at: input.nextRetryAtIso,
          last_error_at: input.lastErrorAtIso,
        })
        .eq("id", input.jobId)
        .eq("tenant_id", input.tenantId)
        .eq("status", "failed");

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de programmer la relance automatique du job.",
          retryable: false,
          jobId: input.jobId,
        });
      }
    },

    async clearRetrySchedule(input) {
      const payload: Record<string, unknown> = {
        next_retry_at: null,
      };

      if (input.lastErrorAtIso) {
        payload.last_error_at = input.lastErrorAtIso;
      }

      const { error } = await supabase
        .from("takeoff_jobs")
        .update(payload)
        .eq("id", input.jobId)
        .eq("tenant_id", input.tenantId);

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de nettoyer la planification des retries du job.",
          retryable: false,
          jobId: input.jobId,
        });
      }
    },

    async acquireBatchReconcileLease(input) {
      const { data, error } = await (supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<SupabaseMutationResult>;
      }).rpc("acquire_takeoff_batch_reconcile_lease", {
        p_job_id: input.jobId,
        p_tenant_id: input.tenantId,
        p_now: input.nowIso,
        p_lease_token: input.leaseToken,
        p_lease_expires_at: input.leaseExpiresAtIso,
      });

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de reserver le lease de reconciliation batch.",
          retryable: false,
          jobId: input.jobId,
        });
      }

      const row =
        Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object"
          ? (data[0] as Record<string, unknown>)
          : null;

      return {
        claimed: row?.claimed === true,
        attemptCount:
          typeof row?.provider_reconcile_attempt_count === "number"
            ? row.provider_reconcile_attempt_count
            : null,
      };
    },

    async renewLease(input) {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<SupabaseMutationResult>;
      }).rpc(
        input.kind === "processing"
          ? "renew_takeoff_processing_lease"
          : "renew_takeoff_batch_reconcile_lease",
        {
          p_job_id: input.jobId,
          p_tenant_id: input.tenantId,
          p_lease_token: input.leaseToken,
          p_now: input.nowIso,
          p_lease_expires_at: input.leaseExpiresAtIso,
        }
      );
      if (error || data !== true) throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease takeoff n'est plus disponible.", retryable: false, jobId: input.jobId });
    },

    async scheduleReconcile(input) {
      const { data, error } = await supabase
        .from("takeoff_jobs")
        .update({
          provider_reconcile_due_at: input.dueAtIso,
          provider_reconcile_lease_token: null,
          provider_reconcile_lease_expires_at: null,
        })
        .eq("id", input.jobId)
        .eq("tenant_id", input.tenantId)
        .eq("status", "processing")
        .eq("provider_reconcile_lease_token", input.leaseToken)
        .select("id")
        .maybeSingle();

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de reprogrammer la reconciliation batch.",
          retryable: false,
          jobId: input.jobId,
        });
      }
      if (!data) throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease de reconciliation n'est plus disponible.", retryable: false, jobId: input.jobId });
    },

    async markBatchReconcileTimeoutAsFailed(input) {
      const { data, error } = await supabase
        .from("takeoff_jobs")
        .update({
          status: "failed",
          completed_at: input.nowIso,
          error_code: TakeoffErrorCode.AI_TIMEOUT,
          error_message:
            "Le batch provider n'a pas atteint d'etat terminal apres epuisement des tentatives de reconciliation.",
          provider_reconcile_due_at: null,
          provider_reconcile_lease_token: null,
          provider_reconcile_lease_expires_at: null,
          last_error_at: input.nowIso,
        })
        .eq("id", input.jobId)
        .eq("tenant_id", input.tenantId)
        .eq("status", "processing")
        .eq("provider_reconcile_lease_token", input.leaseToken)
        .select("id")
        .maybeSingle();

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de clore le job batch en timeout provider.",
          retryable: false,
          jobId: input.jobId,
        });
      }
      if (!data) throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease de reconciliation n'est plus disponible.", retryable: false, jobId: input.jobId });
    },
  };
}

function buildOutcome(input: {
  jobId: string;
  tenantId: string | null;
  level: string | null;
  status: TakeoffJobAttemptOutcome["status"];
  trigger: TakeoffJobAttemptTrigger;
  retryCount: number;
  retryable: boolean;
  shouldRequeue: boolean;
  requeueReason?: TakeoffJobAttemptOutcome["requeue_reason"];
  nextRunInSeconds?: number | null;
  nextRunAt?: string | null;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  correlationId: string;
}): TakeoffJobAttemptOutcome {
  return {
    job_id: input.jobId,
    tenant_id: input.tenantId,
    level: input.level,
    status: input.status,
    trigger: input.trigger,
    retry_count: input.retryCount,
    attempt: input.retryCount + 1,
    retryable: input.retryable,
    should_requeue: input.shouldRequeue,
    requeue_reason: input.requeueReason ?? null,
    next_run_in_seconds: input.nextRunInSeconds ?? null,
    next_run_at: input.nextRunAt ?? null,
    duration_ms: input.durationMs,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    correlation_id: input.correlationId,
  };
}

export async function processTakeoffJobAttempt(
  jobId: string,
  options: ProcessTakeoffJobAttemptOptions
): Promise<TakeoffJobAttemptOutcome> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const logger = options.logger ?? console;
  const serviceRoleClient =
    createServiceRoleClient() as unknown as SupabaseClientLike;
  const repository =
    options.repository ??
    createSupabaseTakeoffWorkerRepository(serviceRoleClient);
  const processLevelAFn = options.processLevelAFn ?? processLevelA;
  const processLevelBFn = options.processLevelBFn ?? processLevelB;
  const processLevelCFn = options.processLevelCFn ?? processLevelC;

  if (!isUuidLike(jobId)) {
    throw new TakeoffError({
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "job_id doit etre un UUID valide.",
      retryable: false,
      jobId,
    });
  }

  const job = await repository.getJobById(jobId);
  if (!job) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      retryable: false,
      jobId,
    });
  }

  const retryCount = sanitizeRetryCount(job.retry_count);
  const durationMs = Math.max(0, now().getTime() - startedAt.getTime());
  const reconcileTakeoffBatchJobFn =
    options.reconcileTakeoffBatchJobFn ?? reconcileTakeoffBatchJob;

  if (TAKEOFF_TERMINAL_JOB_STATUSES.has(job.status)) {
    return buildOutcome({
      jobId: job.id,
      tenantId: job.tenant_id,
      level: job.level,
      status: job.status === "canceled" ? "canceled" : "noop_terminal",
      trigger: options.trigger,
      retryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs,
      errorCode: job.error_code,
      errorMessage: job.error_message,
      correlationId: options.correlationId,
    });
  }

  if (!(await repository.isTenantActive(job.tenant_id))) {
    return buildOutcome({
      jobId: job.id,
      tenantId: job.tenant_id,
      level: job.level,
      status: "noop_terminal",
      trigger: options.trigger,
      retryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      errorCode: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
      errorMessage: "Le tenant est suspendu; le worker n'a execute aucun effet externe.",
      correlationId: options.correlationId,
    });
  }

  const assertTenantActive = async (tenantId: string) => {
    if (!(await repository.isTenantActive(tenantId))) {
      throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
        message: "Le tenant a ete suspendu avant l'appel fournisseur.",
        retryable: true,
        jobId: job.id,
        level:
          job.level === "A" || job.level === "B" || job.level === "C"
            ? job.level
            : undefined,
      });
    }
  };

  if (job.status === "failed") {
    const nextRetryAtMs = job.next_retry_at
      ? Date.parse(job.next_retry_at)
      : Number.NaN;
    const retryIsScheduled =
      options.trigger === "retry" && Number.isFinite(nextRetryAtMs);

    if (retryCount >= TAKEOFF_RETRY_MAX || !retryIsScheduled) {
      await repository.clearRetrySchedule({
        jobId: job.id,
        tenantId: job.tenant_id,
        lastErrorAtIso: job.last_error_at ?? now().toISOString(),
      });
      logger.error("Takeoff async worker rejected an unscheduled or exhausted retry", {
        job_id: job.id,
        tenant_id: job.tenant_id,
        retry_count: retryCount,
        trigger: options.trigger,
        correlation_id: options.correlationId,
      });

      return buildOutcome({
        jobId: job.id,
        tenantId: job.tenant_id,
        level: job.level,
        status: "failed_terminal",
        trigger: options.trigger,
        retryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: job.error_code,
        errorMessage: job.error_message,
        correlationId: options.correlationId,
      });
    }

    if (nextRetryAtMs > now().getTime()) {
      const nextRunInSeconds = Math.max(
        1,
        Math.ceil((nextRetryAtMs - now().getTime()) / 1000)
      );
      return buildOutcome({
        jobId: job.id,
        tenantId: job.tenant_id,
        level: job.level,
        status: "failed_retryable",
        trigger: options.trigger,
        retryCount,
        retryable: true,
        shouldRequeue: true,
        requeueReason: "retry",
        nextRunInSeconds,
        nextRunAt: job.next_retry_at,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: job.error_code,
        errorMessage: job.error_message,
        correlationId: options.correlationId,
      });
    }
  }

  if (isBatchReconcileCandidate(job)) {
    const leaseToken = crypto.randomUUID();
    const nowIso = now().toISOString();
    const leaseExpiresAtIso = new Date(
      now().getTime() + TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS * 1000
    ).toISOString();
    const lease = await repository.acquireBatchReconcileLease({
      jobId: job.id,
      tenantId: job.tenant_id,
      nowIso,
      leaseToken,
      leaseExpiresAtIso,
    });

    if (!lease.claimed) {
      return buildOutcome({
        jobId: job.id,
        tenantId: job.tenant_id,
        level: job.level,
        status: "in_progress",
        trigger: options.trigger,
        retryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs,
        errorCode: job.error_code,
        errorMessage: job.error_message,
        correlationId: options.correlationId,
      });
    }

    if (
      (lease.attemptCount ?? 0) > TAKEOFF_BATCH_RECONCILE_MAX_ATTEMPTS &&
      !hasTerminalProviderBatchState(job)
    ) {
      await repository.markBatchReconcileTimeoutAsFailed({
        jobId: job.id,
        tenantId: job.tenant_id,
        nowIso,
        leaseToken,
      });

      return buildOutcome({
        jobId: job.id,
        tenantId: job.tenant_id,
        level: job.level,
        status: "failed_terminal",
        trigger: options.trigger,
        retryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: TakeoffErrorCode.AI_TIMEOUT,
        errorMessage:
          "Le batch provider n'a pas atteint d'etat terminal apres epuisement des tentatives de reconciliation.",
        correlationId: options.correlationId,
      });
    }

    try {
      const reconcileResult = await reconcileTakeoffBatchJobFn(job.id, {
        tenantId: job.tenant_id,
        userId: job.created_by ?? undefined,
        supabase: serviceRoleClient as never,
        now,
        assertTenantActive,
        renewLease: ({ jobId: claimedJobId, tenantId, leaseToken: token }) => {
          const leaseNow = now();
          return repository.renewLease({ kind: "reconcile", jobId: claimedJobId, tenantId, leaseToken: token, nowIso: leaseNow.toISOString(), leaseExpiresAtIso: new Date(leaseNow.getTime() + TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS * 1000).toISOString() });
        },
      });

      if (reconcileResult.status === "awaiting_provider_result") {
        const backoffSeconds = getTakeoffBatchReconcileBackoffSeconds(
          lease.attemptCount ?? 1
        );
        const nextRunAtIso = new Date(now().getTime() + backoffSeconds * 1000).toISOString();

        await repository.scheduleReconcile({
          jobId: job.id,
          tenantId: job.tenant_id,
          dueAtIso: nextRunAtIso,
          leaseToken,
        });

        return buildOutcome({
          jobId: job.id,
          tenantId: job.tenant_id,
          level: job.level,
          status: "awaiting_provider_result",
          trigger: options.trigger,
          retryCount,
          retryable: false,
          shouldRequeue: true,
          requeueReason: "reconcile",
          nextRunInSeconds: backoffSeconds,
          nextRunAt: nextRunAtIso,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          errorCode: null,
          errorMessage: null,
          correlationId: options.correlationId,
        });
      }

      const refreshed = await repository.getJobById(job.id);
      const refreshedRetryCount = sanitizeRetryCount(refreshed?.retry_count ?? retryCount);

      return buildOutcome({
        jobId: job.id,
        tenantId: job.tenant_id,
        level: job.level,
        status: "completed",
        trigger: options.trigger,
        retryCount: refreshedRetryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: refreshed?.error_code,
        errorMessage: refreshed?.error_message,
        correlationId: options.correlationId,
      });
    } catch (error) {
      const mappedError = toTakeoffError(error, {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        fallbackMessage: "La reconciliation batch du job takeoff a echoue.",
        jobId: job.id,
        level: job.level === "A" || job.level === "B" || job.level === "C" ? job.level : undefined,
      });
      const refreshed = await repository.getJobById(job.id);
      const current = refreshed ?? job;

      if (current.status === "processing" && isBatchReconcileCandidate(current) && mappedError.retryable) {
        const backoffSeconds = getTakeoffBatchReconcileBackoffSeconds(
          lease.attemptCount ?? current.provider_reconcile_attempt_count ?? 1
        );
        const nextRunAtIso = new Date(now().getTime() + backoffSeconds * 1000).toISOString();

        await repository.scheduleReconcile({
          jobId: current.id,
          tenantId: current.tenant_id,
          dueAtIso: nextRunAtIso,
          leaseToken,
        });

        logger.warn("Takeoff async worker scheduled reconcile retry", {
          job_id: current.id,
          tenant_id: current.tenant_id,
          level: current.level,
          attempt: lease.attemptCount ?? 1,
          duration_ms: Math.max(0, now().getTime() - startedAt.getTime()),
          status: "awaiting_provider_result",
          correlation_id: options.correlationId,
          error_code: mappedError.code,
        });

        return buildOutcome({
          jobId: current.id,
          tenantId: current.tenant_id,
          level: current.level,
          status: "awaiting_provider_result",
          trigger: options.trigger,
          retryCount: sanitizeRetryCount(current.retry_count),
          retryable: true,
          shouldRequeue: true,
          requeueReason: "reconcile",
          nextRunInSeconds: backoffSeconds,
          nextRunAt: nextRunAtIso,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          errorCode: mappedError.code,
          errorMessage: mappedError.message,
          correlationId: options.correlationId,
        });
      }

      if (current.status === "canceled") {
        await repository.clearRetrySchedule({
          jobId: current.id,
          tenantId: current.tenant_id,
        });

        return buildOutcome({
          jobId: current.id,
          tenantId: current.tenant_id,
          level: current.level,
          status: "canceled",
          trigger: options.trigger,
          retryCount: sanitizeRetryCount(current.retry_count),
          retryable: false,
          shouldRequeue: false,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          errorCode: current.error_code,
          errorMessage: current.error_message,
          correlationId: options.correlationId,
        });
      }

      if (TAKEOFF_TERMINAL_JOB_STATUSES.has(current.status)) {
        return buildOutcome({
          jobId: current.id,
          tenantId: current.tenant_id,
          level: current.level,
          status: "failed_terminal",
          trigger: options.trigger,
          retryCount: sanitizeRetryCount(current.retry_count),
          retryable: false,
          shouldRequeue: false,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          errorCode: current.error_code ?? mappedError.code,
          errorMessage: current.error_message ?? mappedError.message,
          correlationId: options.correlationId,
        });
      }

      return buildOutcome({
        jobId: current.id,
        tenantId: current.tenant_id,
        level: current.level,
        status: "in_progress",
        trigger: options.trigger,
        retryCount: sanitizeRetryCount(current.retry_count),
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: current.error_code ?? mappedError.code,
        errorMessage: current.error_message ?? mappedError.message,
        correlationId: options.correlationId,
      });
    }
  }

  if (job.status === "processing") {
    return buildOutcome({
      jobId: job.id,
      tenantId: job.tenant_id,
      level: job.level,
      status: "in_progress",
      trigger: options.trigger,
      retryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs,
      errorCode: job.error_code,
      errorMessage: job.error_message,
      correlationId: options.correlationId,
    });
  }

  let processLevelFn:
    | typeof processLevelA
    | typeof processLevelB
    | typeof processLevelC
    | null = null;

  if (job.level === "A") {
    processLevelFn = processLevelAFn;
  } else if (job.level === "B") {
    processLevelFn = processLevelBFn;
  } else if (job.level === "C") {
    processLevelFn = processLevelCFn;
  }

  if (!processLevelFn) {
    const nowIso = now().toISOString();
    await repository.markUnsupportedLevelAsFailed({
      jobId: job.id,
      tenantId: job.tenant_id,
      nowIso,
    });

    return buildOutcome({
      jobId: job.id,
      tenantId: job.tenant_id,
      level: job.level,
      status: "failed_terminal",
      trigger: options.trigger,
      retryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      errorCode: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
      errorMessage: "Le niveau takeoff n'est pas encore supporte par le worker async.",
      correlationId: options.correlationId,
    });
  }

  try {
    const result = await processLevelFn(job.id, {
      tenantId: job.tenant_id,
      userId: job.created_by ?? undefined,
      supabase: serviceRoleClient as never,
      now,
      assertTenantActive,
      renewLease: ({ jobId: claimedJobId, tenantId, leaseToken }) => {
        const leaseNow = now();
        return repository.renewLease({ kind: "processing", jobId: claimedJobId, tenantId, leaseToken, nowIso: leaseNow.toISOString(), leaseExpiresAtIso: new Date(leaseNow.getTime() + TAKEOFF_PROCESSING_LEASE_TTL_SECONDS * 1000).toISOString() });
      },
    });

    if (result.status === "submitted_to_provider") {
      const nextRunAtIso = now().toISOString();

      return buildOutcome({
        jobId: job.id,
        tenantId: job.tenant_id,
        level: job.level,
        status: "submitted_to_provider",
        trigger: options.trigger,
        retryCount,
        retryable: false,
        shouldRequeue: true,
        requeueReason: "reconcile",
        nextRunInSeconds: 0,
        nextRunAt: nextRunAtIso,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: null,
        errorMessage: null,
        correlationId: options.correlationId,
      });
    }

    const refreshed = await repository.getJobById(job.id);
    const refreshedRetryCount = sanitizeRetryCount(refreshed?.retry_count ?? retryCount);

    return buildOutcome({
      jobId: job.id,
      tenantId: job.tenant_id,
      level: job.level,
      status: "completed",
      trigger: options.trigger,
      retryCount: refreshedRetryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      errorCode: refreshed?.error_code,
      errorMessage: refreshed?.error_message,
      correlationId: options.correlationId,
    });
  } catch (error) {
    const mappedError = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      fallbackMessage: "Le traitement async du job takeoff a echoue.",
      jobId: job.id,
      level:
        job.level === "A" || job.level === "B" || job.level === "C"
          ? job.level
          : undefined,
    });

    const refreshed = await repository.getJobById(job.id);
    const current = refreshed ?? job;
    const currentRetryCount = sanitizeRetryCount(current.retry_count);

    if (current.status === "processing") {
      return buildOutcome({
        jobId: current.id,
        tenantId: current.tenant_id,
        level: current.level,
        status: "in_progress",
        trigger: options.trigger,
        retryCount: currentRetryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: current.error_code,
        errorMessage: current.error_message,
        correlationId: options.correlationId,
      });
    }

    if (current.status === "canceled") {
      await repository.clearRetrySchedule({
        jobId: current.id,
        tenantId: current.tenant_id,
      });

      return buildOutcome({
        jobId: current.id,
        tenantId: current.tenant_id,
        level: current.level,
        status: "canceled",
        trigger: options.trigger,
        retryCount: currentRetryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: current.error_code,
        errorMessage: current.error_message,
        correlationId: options.correlationId,
      });
    }

    if (TAKEOFF_TERMINAL_JOB_STATUSES.has(current.status)) {
      return buildOutcome({
        jobId: current.id,
        tenantId: current.tenant_id,
        level: current.level,
        status: "noop_terminal",
        trigger: options.trigger,
        retryCount: currentRetryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: current.error_code,
        errorMessage: current.error_message,
        correlationId: options.correlationId,
      });
    }

    const retryable = mappedError.retryable;
    const shouldRetry = current.status === "failed" && retryable && currentRetryCount < TAKEOFF_RETRY_MAX;

    if (shouldRetry) {
      const backoffSeconds = getRetryBackoffSeconds(currentRetryCount);
      const nextRetryAtIso = new Date(now().getTime() + backoffSeconds * 1000).toISOString();
      const lastErrorAtIso = now().toISOString();

      await repository.scheduleRetry({
        jobId: current.id,
        tenantId: current.tenant_id,
        nextRetryAtIso,
        lastErrorAtIso,
      });

      logger.warn("Takeoff async worker scheduled retry", {
        job_id: current.id,
        tenant_id: current.tenant_id,
        level: current.level,
        attempt: currentRetryCount + 1,
        duration_ms: Math.max(0, now().getTime() - startedAt.getTime()),
        status: "failed_retryable",
        correlation_id: options.correlationId,
      });

      return buildOutcome({
        jobId: current.id,
        tenantId: current.tenant_id,
        level: current.level,
        status: "failed_retryable",
        trigger: options.trigger,
        retryCount: currentRetryCount,
        retryable: true,
        shouldRequeue: true,
        requeueReason: "retry",
        nextRunInSeconds: backoffSeconds,
        nextRunAt: nextRetryAtIso,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        errorCode: current.error_code ?? mappedError.code,
        errorMessage: current.error_message ?? mappedError.message,
        correlationId: options.correlationId,
      });
    }

    await repository.clearRetrySchedule({
      jobId: current.id,
      tenantId: current.tenant_id,
      lastErrorAtIso: now().toISOString(),
    });

    logger.error("Takeoff async worker reached terminal failure", {
      job_id: current.id,
      tenant_id: current.tenant_id,
      level: current.level,
      attempt: currentRetryCount + 1,
      duration_ms: Math.max(0, now().getTime() - startedAt.getTime()),
      status: "failed_terminal",
      correlation_id: options.correlationId,
      error_code: current.error_code ?? mappedError.code,
    });
    reportError({
      error: new Error(current.error_message ?? mappedError.message),
      source: "takeoff.async-worker",
      context: {
        job_id: current.id,
        tenant_id: current.tenant_id,
        status: "failed_terminal",
        correlation_id: options.correlationId,
        error_code: current.error_code ?? mappedError.code,
      },
    });

    return buildOutcome({
      jobId: current.id,
      tenantId: current.tenant_id,
      level: current.level,
      status: "failed_terminal",
      trigger: options.trigger,
      retryCount: currentRetryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      errorCode: current.error_code ?? mappedError.code,
      errorMessage: current.error_message ?? mappedError.message,
      correlationId: options.correlationId,
    });
  }
}

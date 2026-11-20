import { reportError } from "@/lib/observability/error-reporter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  TAKEOFF_PROCESSING_LEASE_TTL_SECONDS,
  TAKEOFF_RETRY_BACKOFF_SECONDS,
  TAKEOFF_RETRY_MAX,
} from "@/lib/takeoff/constants";
import { assertTakeoffJobUsesLocalProvider, TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  normalizeTakeoffWorkerJobRow,
  type TakeoffLeaseRenewal,
  type TakeoffWorkerJobRow,
} from "@/lib/takeoff/job-lifecycle";
import {
  type ProcessLevelAOptions,
  processLevelA,
  processLevelB,
  processLevelC,
} from "@/lib/takeoff/processor";
import type {
  TakeoffJobAttemptOutcome,
  TakeoffJobAttemptTrigger,
} from "@/lib/takeoff/types";
import {
  isWorkflowTenantActive,
  type WorkflowTenantClient,
} from "@/lib/workflows/active-tenant";

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
  renewLease: (input: {
    jobId: string;
    tenantId: string;
    leaseToken: string;
    nowIso: string;
    leaseExpiresAtIso: string;
  }) => Promise<void>;
};

type ProcessTakeoffJobAttemptOptions = {
  correlationId: string;
  trigger: TakeoffJobAttemptTrigger;
  now?: () => Date;
  processLevelAFn?: typeof processLevelA;
  processLevelBFn?: typeof processLevelB;
  processLevelCFn?: typeof processLevelC;
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
            "execution_provider",
            "analysis_outcome",
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
          analysis_outcome: "failure",
          error_code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
          error_message: "Le niveau takeoff n'est pas encore supporte par le worker async.",
          next_retry_at: null,
          last_error_at: input.nowIso,
        })
        .eq("id", input.jobId)
        .eq("tenant_id", input.tenantId)
        .eq("status", "pending");

      if (error) {
        throw toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage: "Impossible de marquer le job takeoff en échec.",
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

    async renewLease(input) {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<SupabaseMutationResult>;
      }).rpc(
        "renew_takeoff_processing_lease",
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

type TakeoffLevelProcessor =
  | typeof processLevelA
  | typeof processLevelB
  | typeof processLevelC;


// What one attempt knows once its job is loaded. Every step reads the clock
// through `now`, so the order of the steps is the order of the clock reads.
type TakeoffJobAttempt = {
  job: TakeoffWorkerJobRow;
  retryCount: number;
  // Measured right after the job is loaded; untouchedJobOutcome reports it.
  durationAfterLoadMs: number;
  startedAt: Date;
  now: () => Date;
  trigger: TakeoffJobAttemptTrigger;
  correlationId: string;
  logger: Pick<typeof console, "info" | "warn" | "error">;
  repository: TakeoffWorkerRepository;
  serviceRoleClient: SupabaseClientLike;
  assertTenantActive: (tenantId: string) => Promise<void>;
};

type TakeoffJobAttemptOutcomeFields = Omit<
  Parameters<typeof buildOutcome>[0],
  "jobId" | "tenantId" | "level" | "trigger" | "correlationId"
>;

function attemptOutcome(
  attempt: TakeoffJobAttempt,
  job: TakeoffWorkerJobRow,
  fields: TakeoffJobAttemptOutcomeFields
): TakeoffJobAttemptOutcome {
  return buildOutcome({
    jobId: job.id,
    tenantId: job.tenant_id,
    level: job.level,
    trigger: attempt.trigger,
    correlationId: attempt.correlationId,
    ...fields,
  });
}

// Outcome of an attempt that leaves the job as it found it. It reports the
// duration measured when the job was loaded.
function untouchedJobOutcome(
  attempt: TakeoffJobAttempt,
  status: TakeoffJobAttemptOutcome["status"]
) {
  const { job } = attempt;
  return attemptOutcome(attempt, job, {
    status,
    retryCount: attempt.retryCount,
    retryable: false,
    shouldRequeue: false,
    durationMs: attempt.durationAfterLoadMs,
    errorCode: job.error_code,
    errorMessage: job.error_message,
  });
}

function elapsedMs(attempt: TakeoffJobAttempt) {
  return Math.max(0, attempt.now().getTime() - attempt.startedAt.getTime());
}

function toTakeoffLevel(level: string) {
  return level === "A" || level === "B" || level === "C" ? level : undefined;
}

function assertTakeoffJobId(jobId: string) {
  if (!isUuidLike(jobId)) {
    throw new TakeoffError({
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "job_id doit être un UUID valide.",
      retryable: false,
      jobId,
    });
  }
}

async function loadTakeoffWorkerJob(repository: TakeoffWorkerRepository, jobId: string) {
  const job = await repository.getJobById(jobId);
  if (!job) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      retryable: false,
      jobId,
    });
  }

  return job;
}

async function assertTenantStillActive(
  repository: TakeoffWorkerRepository,
  job: TakeoffWorkerJobRow,
  tenantId: string
) {
  if (!(await repository.isTenantActive(tenantId))) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
      message: "Le tenant a été suspendu avant l'appel fournisseur.",
      retryable: true,
      jobId: job.id,
      level: toTakeoffLevel(job.level),
    });
  }
}

function takeoffLeaseRenewal(attempt: TakeoffJobAttempt): TakeoffLeaseRenewal {
  return ({ jobId, tenantId, leaseToken }) => {
    const leaseNow = attempt.now();
    return attempt.repository.renewLease({
      jobId,
      tenantId,
      leaseToken,
      nowIso: leaseNow.toISOString(),
      leaseExpiresAtIso: new Date(leaseNow.getTime() + TAKEOFF_PROCESSING_LEASE_TTL_SECONDS * 1000).toISOString(),
    });
  };
}

function takeoffProcessorOptions(
  attempt: TakeoffJobAttempt,
  renewLease: TakeoffLeaseRenewal
): ProcessLevelAOptions {
  return {
    tenantId: attempt.job.tenant_id,
    userId: attempt.job.created_by ?? undefined,
    supabase: attempt.serviceRoleClient as never,
    now: attempt.now,
    assertTenantActive: attempt.assertTenantActive,
    renewLease,
  };
}

// A failed job runs again only as a scheduled retry within its budget, once
// the retry is due. Returns null when the retry may run now.
async function gateFailedJobRetry(
  attempt: TakeoffJobAttempt
): Promise<TakeoffJobAttemptOutcome | null> {
  const { job, now, retryCount } = attempt;
  const nextRetryAtMs = job.next_retry_at
    ? Date.parse(job.next_retry_at)
    : Number.NaN;
  const retryIsScheduled =
    attempt.trigger === "retry" && Number.isFinite(nextRetryAtMs);

  if (job.execution_provider === "chatgpt_local") {
    if (job.analysis_outcome === "failure" || !Number.isFinite(nextRetryAtMs) || retryCount >= TAKEOFF_RETRY_MAX) {
      return attemptOutcome(attempt, job, {
        status: job.analysis_outcome === "failure" ? "failed_terminal" : "noop_terminal",
        retryCount,
        retryable: false,
        shouldRequeue: false,
        durationMs: elapsedMs(attempt),
        errorCode: job.error_code,
        errorMessage: job.error_message,
      });
    }
    return retryIsScheduled && nextRetryAtMs <= now().getTime() ? null : scheduledRetryOutcome(attempt, job);
  }

  if (retryCount >= TAKEOFF_RETRY_MAX || !retryIsScheduled) {
    await attempt.repository.clearRetrySchedule({
      jobId: job.id,
      tenantId: job.tenant_id,
      lastErrorAtIso: job.last_error_at ?? now().toISOString(),
    });
    attempt.logger.error("Takeoff async worker rejected an unscheduled or exhausted retry", {
      job_id: job.id,
      tenant_id: job.tenant_id,
      retry_count: retryCount,
      trigger: attempt.trigger,
      correlation_id: attempt.correlationId,
    });

    return attemptOutcome(attempt, job, {
      status: "failed_terminal",
      retryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: elapsedMs(attempt),
      errorCode: job.error_code,
      errorMessage: job.error_message,
    });
  }

  if (nextRetryAtMs > now().getTime()) {
    return scheduledRetryOutcome(attempt, job);
  }

  return null;
}

function scheduledRetryOutcome(attempt: TakeoffJobAttempt, job: TakeoffWorkerJobRow) {
  const remaining = Date.parse(job.next_retry_at ?? "") - attempt.now().getTime();
  return attemptOutcome(attempt, job, {
    status: "failed_retryable",
    retryCount: sanitizeRetryCount(job.retry_count),
    retryable: true,
    shouldRequeue: true,
    requeueReason: "retry",
    nextRunInSeconds: Math.max(0, Math.ceil(remaining / 1000)),
    nextRunAt: job.next_retry_at,
    durationMs: elapsedMs(attempt),
    errorCode: job.error_code,
    errorMessage: job.error_message,
  });
}

async function completedJobOutcome(attempt: TakeoffJobAttempt) {
  const refreshed = await attempt.repository.getJobById(attempt.job.id);
  const refreshedRetryCount = sanitizeRetryCount(refreshed?.retry_count ?? attempt.retryCount);

  return attemptOutcome(attempt, attempt.job, {
    status: "completed",
    retryCount: refreshedRetryCount,
    retryable: false,
    shouldRequeue: false,
    durationMs: elapsedMs(attempt),
    errorCode: refreshed?.error_code,
    errorMessage: refreshed?.error_message,
  });
}

async function settleCanceledJob(attempt: TakeoffJobAttempt, current: TakeoffWorkerJobRow) {
  await attempt.repository.clearRetrySchedule({
    jobId: current.id,
    tenantId: current.tenant_id,
  });

  return attemptOutcome(attempt, current, {
    status: "canceled",
    retryCount: sanitizeRetryCount(current.retry_count),
    retryable: false,
    shouldRequeue: false,
    durationMs: elapsedMs(attempt),
    errorCode: current.error_code,
    errorMessage: current.error_message,
  });
}

function selectLevelProcessor(
  level: string,
  options: ProcessTakeoffJobAttemptOptions
): TakeoffLevelProcessor | null {
  if (level === "A") return options.processLevelAFn ?? processLevelA;
  if (level === "B") return options.processLevelBFn ?? processLevelB;
  if (level === "C") return options.processLevelCFn ?? processLevelC;
  return null;
}

async function failUnsupportedLevel(attempt: TakeoffJobAttempt) {
  const { job } = attempt;
  const nowIso = attempt.now().toISOString();
  await attempt.repository.markUnsupportedLevelAsFailed({
    jobId: job.id,
    tenantId: job.tenant_id,
    nowIso,
  });

  return attemptOutcome(attempt, job, {
    status: "failed_terminal",
    retryCount: attempt.retryCount,
    retryable: false,
    shouldRequeue: false,
    durationMs: elapsedMs(attempt),
    errorCode: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
    errorMessage: "Le niveau takeoff n'est pas encore supporte par le worker async.",
  });
}

async function scheduleJobRetry(
  attempt: TakeoffJobAttempt,
  current: TakeoffWorkerJobRow,
  currentRetryCount: number,
  mappedError: TakeoffError
) {
  const backoffSeconds = getRetryBackoffSeconds(currentRetryCount);
  const nextRetryAtIso = new Date(attempt.now().getTime() + backoffSeconds * 1000).toISOString();
  const lastErrorAtIso = attempt.now().toISOString();

  await attempt.repository.scheduleRetry({
    jobId: current.id,
    tenantId: current.tenant_id,
    nextRetryAtIso,
    lastErrorAtIso,
  });

  attempt.logger.warn("Takeoff async worker scheduled retry", {
    job_id: current.id,
    tenant_id: current.tenant_id,
    level: current.level,
    attempt: currentRetryCount + 1,
    duration_ms: elapsedMs(attempt),
    status: "failed_retryable",
    correlation_id: attempt.correlationId,
  });

  return attemptOutcome(attempt, current, {
    status: "failed_retryable",
    retryCount: currentRetryCount,
    retryable: true,
    shouldRequeue: true,
    requeueReason: "retry",
    nextRunInSeconds: backoffSeconds,
    nextRunAt: nextRetryAtIso,
    durationMs: elapsedMs(attempt),
    errorCode: current.error_code ?? mappedError.code,
    errorMessage: current.error_message ?? mappedError.message,
  });
}

async function failJobTerminally(
  attempt: TakeoffJobAttempt,
  current: TakeoffWorkerJobRow,
  currentRetryCount: number,
  mappedError: TakeoffError
) {
  if (current.execution_provider !== "chatgpt_local") {
    await attempt.repository.clearRetrySchedule({
      jobId: current.id,
      tenantId: current.tenant_id,
      lastErrorAtIso: attempt.now().toISOString(),
    });
  }

  attempt.logger.error("Takeoff async worker reached terminal failure", {
    job_id: current.id,
    tenant_id: current.tenant_id,
    level: current.level,
    attempt: currentRetryCount + 1,
    duration_ms: elapsedMs(attempt),
    status: "failed_terminal",
    correlation_id: attempt.correlationId,
    error_code: current.error_code ?? mappedError.code,
  });
  reportError({
    error: new Error(current.error_message ?? mappedError.message),
    source: "takeoff.async-worker",
    context: {
      job_id: current.id,
      tenant_id: current.tenant_id,
      status: "failed_terminal",
      correlation_id: attempt.correlationId,
      error_code: current.error_code ?? mappedError.code,
    },
  });

  return attemptOutcome(attempt, current, {
    status: "failed_terminal",
    retryCount: currentRetryCount,
    retryable: false,
    shouldRequeue: false,
    durationMs: elapsedMs(attempt),
    errorCode: current.error_code ?? mappedError.code,
    errorMessage: current.error_message ?? mappedError.message,
  });
}

async function settleLevelProcessingFailure(attempt: TakeoffJobAttempt, error: unknown) {
  const { job } = attempt;
  const mappedError = toTakeoffError(error, {
    fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
    fallbackMessage: "Le traitement async du job takeoff a echoue.",
    jobId: job.id,
    level: toTakeoffLevel(job.level),
  });

  const refreshed = await attempt.repository.getJobById(job.id);
  const current = refreshed ?? job;
  const currentRetryCount = sanitizeRetryCount(current.retry_count);

  if (current.status === "processing") {
    return attemptOutcome(attempt, current, {
      status: "in_progress",
      retryCount: currentRetryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: elapsedMs(attempt),
      errorCode: current.error_code,
      errorMessage: current.error_message,
    });
  }

  if (current.status === "canceled") {
    return settleCanceledJob(attempt, current);
  }

  if (TAKEOFF_TERMINAL_JOB_STATUSES.has(current.status)) {
    return attemptOutcome(attempt, current, {
      status: "noop_terminal",
      retryCount: currentRetryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: elapsedMs(attempt),
      errorCode: current.error_code,
      errorMessage: current.error_message,
    });
  }

  if (current.execution_provider === "chatgpt_local" && current.status === "failed") {
    if (current.analysis_outcome === "failure") {
      return failJobTerminally(attempt, current, currentRetryCount, mappedError);
    }
    const scheduled = current.next_retry_at && currentRetryCount < TAKEOFF_RETRY_MAX;
    if (scheduled && (current.next_retry_at !== job.next_retry_at || currentRetryCount !== attempt.retryCount)) {
      return scheduledRetryOutcome(attempt, current);
    }
    // The processor did not advance a due retry. Leave its schedule for the
    // local recovery poll instead of immediately repeating a failed claim.
    return attemptOutcome(attempt, current, {
      status: scheduled ? "in_progress" : "noop_terminal",
      retryCount: currentRetryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: elapsedMs(attempt),
      errorCode: current.error_code,
      errorMessage: current.error_message,
    });
  }

  const shouldRetry =
    current.status === "failed" && mappedError.retryable && currentRetryCount < TAKEOFF_RETRY_MAX;

  if (shouldRetry) {
    return scheduleJobRetry(attempt, current, currentRetryCount, mappedError);
  }

  return failJobTerminally(attempt, current, currentRetryCount, mappedError);
}

// Runs the level processor under the processing lease the job's claim holds.
async function runLevelProcessor(
  attempt: TakeoffJobAttempt,
  processLevelFn: TakeoffLevelProcessor
) {
  try {
    await processLevelFn(attempt.job.id, takeoffProcessorOptions(attempt, takeoffLeaseRenewal(attempt)));
    // Awaited here so that a failure to refresh the job is handled as a
    // processing failure.
    return await completedJobOutcome(attempt);
  } catch (error) {
    return settleLevelProcessingFailure(attempt, error);
  }
}

export async function processTakeoffJobAttempt(
  jobId: string,
  options: ProcessTakeoffJobAttemptOptions
): Promise<TakeoffJobAttemptOutcome> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const serviceRoleClient =
    createServiceRoleClient() as unknown as SupabaseClientLike;
  const repository =
    options.repository ??
    createSupabaseTakeoffWorkerRepository(serviceRoleClient);

  assertTakeoffJobId(jobId);
  const job = await loadTakeoffWorkerJob(repository, jobId);
  const attempt: TakeoffJobAttempt = {
    job,
    retryCount: sanitizeRetryCount(job.retry_count),
    durationAfterLoadMs: Math.max(0, now().getTime() - startedAt.getTime()),
    startedAt,
    now,
    trigger: options.trigger,
    correlationId: options.correlationId,
    logger: options.logger ?? console,
    repository,
    serviceRoleClient,
    assertTenantActive: (tenantId) => assertTenantStillActive(repository, job, tenantId),
  };

  if (TAKEOFF_TERMINAL_JOB_STATUSES.has(job.status)) {
    return untouchedJobOutcome(attempt, job.status === "canceled" ? "canceled" : "noop_terminal");
  }

  if (!(await repository.isTenantActive(job.tenant_id))) {
    return attemptOutcome(attempt, job, {
      status: "noop_terminal",
      retryCount: attempt.retryCount,
      retryable: false,
      shouldRequeue: false,
      durationMs: elapsedMs(attempt),
      errorCode: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
      errorMessage: "Le tenant est suspendu; le worker n'a execute aucun effet externe.",
    });
  }

  // Before any write: a job of a former provider is never run, retried nor scheduled again.
  assertTakeoffJobUsesLocalProvider(job);

  if (job.status === "failed") {
    const retryGateOutcome = await gateFailedJobRetry(attempt);
    if (retryGateOutcome) return retryGateOutcome;
  }

  if (job.status === "processing") {
    return untouchedJobOutcome(attempt, "in_progress");
  }

  const processLevelFn = selectLevelProcessor(job.level, options);
  if (!processLevelFn) {
    return failUnsupportedLevel(attempt);
  }

  return runLevelProcessor(attempt, processLevelFn);
}

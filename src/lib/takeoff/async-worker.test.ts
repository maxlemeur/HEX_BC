import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/observability/error-reporter", () => ({
  reportError: vi.fn(),
}));

import { reportError } from "@/lib/observability/error-reporter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

type WorkerJobRow = {
  id: string;
  tenant_id: string;
  level: string;
  status: string;
  processing_strategy: string | null;
  provider_batch_id: string | null;
  provider_batch_state: string | null;
  provider_reconcile_due_at: string | null;
  provider_reconcile_attempt_count: number;
  provider_reconcile_lease_token: string | null;
  provider_reconcile_lease_expires_at: string | null;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  next_retry_at: string | null;
  last_error_at: string | null;
};

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CORRELATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIXED_NOW = new Date("2026-02-25T11:00:00.000Z");

function createWorkerRepository(initialJob: WorkerJobRow) {
  const state = {
    job: { ...initialJob },
    scheduleCalls: [] as Array<{
      jobId: string;
      tenantId: string;
      nextRetryAtIso: string;
      lastErrorAtIso: string;
    }>,
    clearCalls: [] as Array<{
      jobId: string;
      tenantId: string;
      lastErrorAtIso?: string;
    }>,
    reconcileCalls: [] as Array<{
      jobId: string;
      tenantId: string;
      dueAtIso: string;
      leaseToken: string;
    }>,
    unsupportedCalls: [] as Array<{
      jobId: string;
      tenantId: string;
      nowIso: string;
    }>,
  };

  const repository = {
    getJobById: vi.fn(async () => ({ ...state.job })),
    isTenantActive: vi.fn(async () => true),
    markUnsupportedLevelAsFailed: vi.fn(
      async (input: { jobId: string; tenantId: string; nowIso: string }) => {
        state.unsupportedCalls.push(input);
        state.job = {
          ...state.job,
          status: "failed",
          error_code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
          error_message: "Le niveau takeoff n'est pas encore supporte par le worker async.",
          last_error_at: input.nowIso,
          next_retry_at: null,
        };
      }
    ),
    scheduleRetry: vi.fn(
      async (input: {
        jobId: string;
        tenantId: string;
        nextRetryAtIso: string;
        lastErrorAtIso: string;
      }) => {
        state.scheduleCalls.push(input);
        state.job = {
          ...state.job,
          status: "failed",
          next_retry_at: input.nextRetryAtIso,
          last_error_at: input.lastErrorAtIso,
        };
      }
    ),
    clearRetrySchedule: vi.fn(
      async (input: {
        jobId: string;
        tenantId: string;
        lastErrorAtIso?: string;
      }) => {
        state.clearCalls.push(input);
        state.job = {
          ...state.job,
          next_retry_at: null,
          last_error_at: input.lastErrorAtIso ?? state.job.last_error_at,
        };
      }
    ),
    acquireBatchReconcileLease: vi.fn(
      async (input: { jobId: string; tenantId: string; nowIso: string; leaseToken: string; leaseExpiresAtIso: string }): Promise<{ claimed: boolean; attemptCount: number | null }> => {
        void input;
        return { claimed: false, attemptCount: null };
      }
    ),
    renewLease: vi.fn(async () => undefined),
    scheduleReconcile: vi.fn(
      async (input: { jobId: string; tenantId: string; dueAtIso: string; leaseToken: string }) => {
        state.reconcileCalls.push(input);
        state.job = {
          ...state.job,
          provider_reconcile_due_at: input.dueAtIso,
          provider_reconcile_lease_token: null,
          provider_reconcile_lease_expires_at: null,
        };
      }
    ),
    markBatchReconcileTimeoutAsFailed: vi.fn(
      async (input: { jobId: string; tenantId: string; nowIso: string; leaseToken: string }) => {
        state.job = {
          ...state.job,
          status: "failed",
          error_code: TakeoffErrorCode.AI_TIMEOUT,
          error_message:
            "Le batch provider n'a pas atteint d'état terminal après epuisement des tentatives de reconciliation.",
          provider_reconcile_due_at: null,
          provider_reconcile_lease_token: null,
          provider_reconcile_lease_expires_at: null,
          last_error_at: input.nowIso,
        };
      }
    ),
  };

  return {
    state,
    repository,
  };
}

describe("processTakeoffJobAttempt", () => {
  it("does not invoke a processor for a suspended tenant", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 0,
      error_code: null,
      error_message: null,
      created_by: null,
      next_retry_at: null,
      last_error_at: null,
    });
    repository.isTenantActive.mockResolvedValue(false);
    const processLevelAFn = vi.fn();

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "create",
      repository,
      processLevelAFn: processLevelAFn as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("noop_terminal");
    expect(outcome.error_code).toBe(TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE);
    expect(processLevelAFn).not.toHaveBeenCalled();
  });

  it("schedules retry on retryable failed job", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 0,
      error_code: null,
      error_message: null,
      created_by: null,
      next_retry_at: null,
      last_error_at: null,
    });

    const processLevelAFn = vi.fn(async () => {
      state.job = {
        ...state.job,
        status: "failed",
        retry_count: 0,
        error_code: TakeoffErrorCode.AI_TIMEOUT,
        error_message: "Timed out",
      };

      throw new TakeoffError({
        code: TakeoffErrorCode.AI_TIMEOUT,
        message: "Timed out",
        retryable: true,
        jobId: JOB_ID,
        level: "A",
      });
    });

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "retry",
      repository,
      processLevelAFn,
      now: () => FIXED_NOW,
      logger,
    });

    expect(outcome.status).toBe("failed_retryable");
    expect(outcome.should_requeue).toBe(true);
    expect(outcome.requeue_reason).toBe("retry");
    expect(outcome.next_run_in_seconds).toBe(5);
    expect(repository.scheduleRetry).toHaveBeenCalledTimes(1);
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns failed_terminal when retry budget is exhausted", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "failed",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 3,
      error_code: TakeoffErrorCode.AI_TIMEOUT,
      error_message: "Timed out",
      created_by: null,
      next_retry_at: null,
      last_error_at: FIXED_NOW.toISOString(),
    });

    const processLevelAFn = vi.fn(async () => {
      state.job = {
        ...state.job,
        status: "failed",
        retry_count: 3,
        error_code: TakeoffErrorCode.AI_TIMEOUT,
        error_message: "Timed out",
      };

      throw new TakeoffError({
        code: TakeoffErrorCode.AI_TIMEOUT,
        message: "Timed out",
        retryable: true,
        jobId: JOB_ID,
        level: "A",
      });
    });

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "retry",
      repository,
      processLevelAFn,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("failed_terminal");
    expect(outcome.should_requeue).toBe(false);
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(repository.clearRetrySchedule).toHaveBeenCalledTimes(1);
    expect(processLevelAFn).not.toHaveBeenCalled();
  });

  it("does not process a failed job before its scheduled retry time", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "failed",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 1,
      error_code: TakeoffErrorCode.AI_TIMEOUT,
      error_message: "Timed out",
      created_by: null,
      next_retry_at: "2026-02-25T11:00:30.000Z",
      last_error_at: FIXED_NOW.toISOString(),
    });
    const processLevelAFn = vi.fn();

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "retry",
      repository,
      processLevelAFn: processLevelAFn as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("failed_retryable");
    expect(outcome.should_requeue).toBe(true);
    expect(outcome.next_run_in_seconds).toBe(30);
    expect(processLevelAFn).not.toHaveBeenCalled();
  });

  it("processes a legitimate scheduled retry once its backoff is due", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "failed",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 1,
      error_code: TakeoffErrorCode.AI_TIMEOUT,
      error_message: "Timed out",
      created_by: null,
      next_retry_at: FIXED_NOW.toISOString(),
      last_error_at: FIXED_NOW.toISOString(),
    });
    const processLevelAFn = vi.fn(async () => {
      state.job = { ...state.job, status: "completed" };
      return {
        jobId: JOB_ID,
        resultId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        status: "completed" as const,
        itemsCount: 1,
        warningsCount: 0,
        tokenCount: 100,
        costCents: 12,
        durationMs: 250,
      };
    });

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "retry",
      repository,
      processLevelAFn,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("completed");
    expect(processLevelAFn).toHaveBeenCalledTimes(1);
  });

  it("does not schedule retry from stale persisted retryable error codes", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "failed",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 1,
      error_code: TakeoffErrorCode.AI_TIMEOUT,
      error_message: "Timed out during previous attempt",
      created_by: null,
      next_retry_at: null,
      last_error_at: FIXED_NOW.toISOString(),
    });

    const processLevelAFn = vi.fn(async () => {
      throw new TakeoffError({
        code: TakeoffErrorCode.INTERNAL_ERROR,
        message: "Unable to bootstrap processor dependencies.",
        retryable: false,
        jobId: JOB_ID,
        level: "A",
      });
    });

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "retry",
      repository,
      processLevelAFn,
      now: () => FIXED_NOW,
      logger,
    });

    expect(outcome.status).toBe("failed_terminal");
    expect(outcome.should_requeue).toBe(false);
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(repository.clearRetrySchedule).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("returns in_progress when concurrent trigger sees processing status", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "processing",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 1,
      error_code: null,
      error_message: null,
      created_by: null,
      next_retry_at: null,
      last_error_at: null,
    });

    const processLevelAFn = vi.fn();

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "manual",
      repository,
      processLevelAFn: processLevelAFn as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("in_progress");
    expect(processLevelAFn).not.toHaveBeenCalled();
  });

  it("reconciles persisted terminal batch states instead of timing them out", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "processing",
      processing_strategy: "batch",
      provider_batch_id: "batches/test-terminal",
      provider_batch_state: "succeeded",
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 4,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 1,
      error_code: null,
      error_message: null,
      created_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      next_retry_at: null,
      last_error_at: null,
    });

    repository.acquireBatchReconcileLease.mockResolvedValueOnce({
      claimed: true,
      attemptCount: 999,
    });
    const reconcileTakeoffBatchJobFn = vi.fn(async () => {
      state.job = {
        ...state.job,
        status: "completed",
        error_code: null,
        error_message: null,
      };

      return {
        jobId: JOB_ID,
        resultId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        status: "completed" as const,
        itemsCount: 1,
        warningsCount: 0,
        tokenCount: 100,
        costCents: 12,
        durationMs: 250,
      };
    });

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "reconcile",
      repository,
      reconcileTakeoffBatchJobFn,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("completed");
    expect(reconcileTakeoffBatchJobFn).toHaveBeenCalledTimes(1);
    expect(repository.markBatchReconcileTimeoutAsFailed).not.toHaveBeenCalled();
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
  });

  it("renews the five-minute batch lease and fences reconcile scheduling with its token", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "processing",
      processing_strategy: "batch",
      provider_batch_id: "batches/test-pending",
      provider_batch_state: "running",
      provider_reconcile_due_at: FIXED_NOW.toISOString(),
      provider_reconcile_attempt_count: 1,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      retry_count: 0,
      error_code: null,
      error_message: null,
      created_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      next_retry_at: null,
      last_error_at: null,
    });
    repository.acquireBatchReconcileLease.mockResolvedValueOnce({ claimed: true, attemptCount: 2 });
    const reconcile = vi.fn(async (_jobId: string, options: { renewLease?: (input: { jobId: string; tenantId: string; leaseToken: string }) => Promise<void> }) => {
      const token = repository.acquireBatchReconcileLease.mock.calls[0]![0].leaseToken;
      await options.renewLease?.({ jobId: JOB_ID, tenantId: TENANT_ID, leaseToken: token });
      return { jobId: JOB_ID, status: "awaiting_provider_result" as const, providerBatchId: "batches/test-pending", providerBatchStateRaw: "JOB_STATE_RUNNING", durationMs: 10 };
    });

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "reconcile",
      repository,
      reconcileTakeoffBatchJobFn: reconcile as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const claim = repository.acquireBatchReconcileLease.mock.calls[0]![0];
    expect(claim.leaseExpiresAtIso).toBe("2026-02-25T11:05:00.000Z");
    expect(repository.renewLease).toHaveBeenCalledWith(expect.objectContaining({ kind: "reconcile", leaseToken: claim.leaseToken, leaseExpiresAtIso: "2026-02-25T11:05:00.000Z" }));
    expect(repository.scheduleReconcile).toHaveBeenCalledWith(expect.objectContaining({ leaseToken: claim.leaseToken }));
    expect(outcome.status).toBe("awaiting_provider_result");
  });
});

type AttemptProcessorOptions = {
  tenantId: string;
  userId?: string;
  supabase: unknown;
  now: () => Date;
  assertTenantActive: (tenantId: string) => Promise<void>;
  renewLease: (input: { jobId: string; tenantId: string; leaseToken: string }) => Promise<void>;
};

type AttemptProcessor = (jobId: string, options: AttemptProcessorOptions) => Promise<unknown>;

type RecordedMock = {
  mock: { calls: unknown[][]; invocationCallOrder: number[] };
};

const LEASE_TOKEN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CREATED_BY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RESULT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BATCH_TIMEOUT_MESSAGE =
  "Le batch provider n'a pas atteint d'état terminal après epuisement des tentatives de reconciliation.";

function at(seconds: number) {
  return new Date(FIXED_NOW.getTime() + seconds * 1000).toISOString();
}

function workerJob(overrides: Partial<WorkerJobRow> = {}): WorkerJobRow {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    level: "A",
    status: "pending",
    processing_strategy: "sync",
    provider_batch_id: null,
    provider_batch_state: null,
    provider_reconcile_due_at: null,
    provider_reconcile_attempt_count: 0,
    provider_reconcile_lease_token: null,
    provider_reconcile_lease_expires_at: null,
    retry_count: 0,
    error_code: null,
    error_message: null,
    created_by: CREATED_BY,
    next_retry_at: null,
    last_error_at: null,
    ...overrides,
  };
}

function batchJob(overrides: Partial<WorkerJobRow> = {}) {
  return workerJob({
    status: "processing",
    processing_strategy: "batch",
    provider_batch_id: "batches/test-running",
    provider_batch_state: "running",
    provider_reconcile_attempt_count: 1,
    ...overrides,
  });
}

function completedResult() {
  return {
    jobId: JOB_ID,
    resultId: RESULT_ID,
    status: "completed" as const,
    itemsCount: 1,
    warningsCount: 0,
    tokenCount: 100,
    costCents: 12,
    durationMs: 250,
  };
}

function awaitingProviderResult() {
  return {
    jobId: JOB_ID,
    status: "awaiting_provider_result" as const,
    providerBatchId: "batches/test-running",
    providerBatchStateRaw: "JOB_STATE_RUNNING",
    durationMs: 10,
  };
}

// Each call to the clock moves it one second forward, so every duration and
// due date in an outcome records when, in the attempt, the clock was read.
function createTickingClock() {
  let tick = 0;
  return () => new Date(FIXED_NOW.getTime() + tick++ * 1000);
}

function callSequence(mocks: Record<string, RecordedMock>) {
  return Object.entries(mocks)
    .flatMap(([name, fn]) =>
      fn.mock.calls.map((args, index) => ({
        order: fn.mock.invocationCallOrder[index]!,
        call: [name, ...args],
      }))
    )
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.call);
}

function expectedOutcome(input: {
  status: string;
  trigger: string;
  durationMs: number;
  level?: string;
  retryCount?: number;
  retryable?: boolean;
  shouldRequeue?: boolean;
  requeueReason?: string | null;
  nextRunInSeconds?: number | null;
  nextRunAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const retryCount = input.retryCount ?? 0;
  return {
    job_id: JOB_ID,
    tenant_id: TENANT_ID,
    level: input.level ?? "A",
    status: input.status,
    trigger: input.trigger,
    retry_count: retryCount,
    attempt: retryCount + 1,
    retryable: input.retryable ?? false,
    should_requeue: input.shouldRequeue ?? false,
    requeue_reason: input.requeueReason ?? null,
    next_run_in_seconds: input.nextRunInSeconds ?? null,
    next_run_at: input.nextRunAt ?? null,
    duration_ms: input.durationMs,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    correlation_id: CORRELATION_ID,
  };
}

function createAttemptHarness(initialJob: WorkerJobRow) {
  const { state, repository } = createWorkerRepository(initialJob);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const now = createTickingClock();
  const processLevelAFn = vi.fn<AttemptProcessor>();
  const processLevelBFn = vi.fn<AttemptProcessor>();
  const processLevelCFn = vi.fn<AttemptProcessor>();
  const reconcileTakeoffBatchJobFn = vi.fn<AttemptProcessor>();

  const run = (trigger: "create" | "retry" | "manual" | "reconcile", jobId = JOB_ID) =>
    processTakeoffJobAttempt(jobId, {
      correlationId: CORRELATION_ID,
      trigger,
      repository,
      processLevelAFn: processLevelAFn as never,
      processLevelBFn: processLevelBFn as never,
      processLevelCFn: processLevelCFn as never,
      reconcileTakeoffBatchJobFn: reconcileTakeoffBatchJobFn as never,
      now,
      logger,
    });

  const sequence = () =>
    callSequence({
      ...(repository as unknown as Record<string, RecordedMock>),
      processLevelA: processLevelAFn as unknown as RecordedMock,
      processLevelB: processLevelBFn as unknown as RecordedMock,
      processLevelC: processLevelCFn as unknown as RecordedMock,
      reconcileTakeoffBatchJob: reconcileTakeoffBatchJobFn as unknown as RecordedMock,
      "logger.info": logger.info as unknown as RecordedMock,
      "logger.warn": logger.warn as unknown as RecordedMock,
      "logger.error": logger.error as unknown as RecordedMock,
      reportError: vi.mocked(reportError) as unknown as RecordedMock,
    });

  const claimLease = (attemptCount: number | null) => {
    repository.acquireBatchReconcileLease.mockResolvedValueOnce({ claimed: true, attemptCount });
  };

  return {
    state,
    repository,
    logger,
    now,
    processLevelAFn,
    processLevelBFn,
    processLevelCFn,
    reconcileTakeoffBatchJobFn,
    run,
    sequence,
    claimLease,
  };
}

const leaseClaim = {
  jobId: JOB_ID,
  tenantId: TENANT_ID,
  nowIso: at(2),
  leaseToken: LEASE_TOKEN,
  leaseExpiresAtIso: at(3 + 300),
};

describe("processTakeoffJobAttempt attempt endings", () => {
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(LEASE_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("entry guards", () => {
    it("rejects a job id that is not a UUID before reading the job", async () => {
      const harness = createAttemptHarness(workerJob());

      await expect(harness.run("create", "not-a-uuid")).rejects.toMatchObject({
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "job_id doit être un UUID valide.",
        retryable: false,
      });
      expect(harness.sequence()).toEqual([]);
    });

    it("rejects a job that no longer exists", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.repository.getJobById.mockResolvedValueOnce(null as never);

      await expect(harness.run("create")).rejects.toMatchObject({
        code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
        message: "Job takeoff introuvable.",
        retryable: false,
      });
      expect(harness.sequence()).toEqual([["getJobById", JOB_ID]]);
    });

    it.each([
      ["completed", "noop_terminal"],
      ["applied", "noop_terminal"],
      ["canceled", "canceled"],
    ])("settles a %s job without checking the tenant", async (status, outcomeStatus) => {
      const harness = createAttemptHarness(
        workerJob({ status, retry_count: 2, error_code: "AI_TIMEOUT", error_message: "Ancien échec" })
      );

      const outcome = await harness.run("manual");

      expect(outcome).toEqual(
        expectedOutcome({
          status: outcomeStatus,
          trigger: "manual",
          retryCount: 2,
          durationMs: 1000,
          errorCode: "AI_TIMEOUT",
          errorMessage: "Ancien échec",
        })
      );
      expect(harness.sequence()).toEqual([["getJobById", JOB_ID]]);
    });

    it("leaves a job of a suspended tenant untouched", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.repository.isTenantActive.mockResolvedValueOnce(false);

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "noop_terminal",
          trigger: "create",
          durationMs: 2000,
          errorCode: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
          errorMessage: "Le tenant est suspendu; le worker n'a execute aucun effet externe.",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
      ]);
    });
  });

  describe("failed job gate", () => {
    it("closes an exhausted retry budget and keeps the last error date", async () => {
      const harness = createAttemptHarness(
        workerJob({
          status: "failed",
          retry_count: 3,
          error_code: "AI_TIMEOUT",
          error_message: "Timed out",
          next_retry_at: at(-10),
          last_error_at: at(-60),
        })
      );

      const outcome = await harness.run("retry");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "retry",
          retryCount: 3,
          durationMs: 2000,
          errorCode: "AI_TIMEOUT",
          errorMessage: "Timed out",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["clearRetrySchedule", { jobId: JOB_ID, tenantId: TENANT_ID, lastErrorAtIso: at(-60) }],
        [
          "logger.error",
          "Takeoff async worker rejected an unscheduled or exhausted retry",
          {
            job_id: JOB_ID,
            tenant_id: TENANT_ID,
            retry_count: 3,
            trigger: "retry",
            correlation_id: CORRELATION_ID,
          },
        ],
      ]);
    });

    it("rejects a failed job that was not triggered as a scheduled retry", async () => {
      const harness = createAttemptHarness(
        workerJob({
          status: "failed",
          retry_count: 1,
          error_code: "AI_TIMEOUT",
          error_message: "Timed out",
          next_retry_at: at(-10),
        })
      );

      const outcome = await harness.run("manual");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "manual",
          retryCount: 1,
          durationMs: 3000,
          errorCode: "AI_TIMEOUT",
          errorMessage: "Timed out",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["clearRetrySchedule", { jobId: JOB_ID, tenantId: TENANT_ID, lastErrorAtIso: at(2) }],
        [
          "logger.error",
          "Takeoff async worker rejected an unscheduled or exhausted retry",
          expect.objectContaining({ trigger: "manual", retry_count: 1 }),
        ],
      ]);
      expect(harness.processLevelAFn).not.toHaveBeenCalled();
    });

    it("waits for a scheduled retry that is not due yet", async () => {
      const harness = createAttemptHarness(
        workerJob({
          status: "failed",
          retry_count: 1,
          error_code: "AI_TIMEOUT",
          error_message: "Timed out",
          next_retry_at: at(30),
        })
      );

      const outcome = await harness.run("retry");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_retryable",
          trigger: "retry",
          retryCount: 1,
          retryable: true,
          shouldRequeue: true,
          requeueReason: "retry",
          nextRunInSeconds: 27,
          nextRunAt: at(30),
          durationMs: 4000,
          errorCode: "AI_TIMEOUT",
          errorMessage: "Timed out",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
      ]);
    });

    it("runs a due scheduled retry through the level processor", async () => {
      const harness = createAttemptHarness(
        workerJob({ status: "failed", retry_count: 1, next_retry_at: at(-1) })
      );
      harness.processLevelAFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "completed" };
        return completedResult();
      });

      const outcome = await harness.run("retry");

      expect(outcome).toEqual(
        expectedOutcome({ status: "completed", trigger: "retry", retryCount: 1, durationMs: 3000 })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelA", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
      ]);
    });
  });

  describe("provider batch reconcile", () => {
    it("leaves a batch whose reconcile lease is held by another worker", async () => {
      const harness = createAttemptHarness(batchJob());

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({ status: "in_progress", trigger: "reconcile", durationMs: 1000 })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
      ]);
    });

    it("fails a batch that exhausted its reconcile attempts without a terminal provider state", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(25);

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "reconcile",
          durationMs: 4000,
          errorCode: TakeoffErrorCode.AI_TIMEOUT,
          errorMessage: BATCH_TIMEOUT_MESSAGE,
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        [
          "markBatchReconcileTimeoutAsFailed",
          { jobId: JOB_ID, tenantId: TENANT_ID, nowIso: at(2), leaseToken: LEASE_TOKEN },
        ],
      ]);
    });

    it("renews the lease and schedules the next reconcile while the provider is still running", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(3);
      harness.reconcileTakeoffBatchJobFn.mockImplementationOnce(async (jobId, options) => {
        await options.renewLease({ jobId, tenantId: TENANT_ID, leaseToken: LEASE_TOKEN });
        return awaitingProviderResult();
      });

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "awaiting_provider_result",
          trigger: "reconcile",
          shouldRequeue: true,
          requeueReason: "reconcile",
          nextRunInSeconds: 40,
          nextRunAt: at(5 + 40),
          durationMs: 6000,
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        ["reconcileTakeoffBatchJob", JOB_ID, expect.anything()],
        [
          "renewLease",
          {
            kind: "reconcile",
            jobId: JOB_ID,
            tenantId: TENANT_ID,
            leaseToken: LEASE_TOKEN,
            nowIso: at(4),
            leaseExpiresAtIso: at(4 + 300),
          },
        ],
        [
          "scheduleReconcile",
          { jobId: JOB_ID, tenantId: TENANT_ID, dueAtIso: at(5 + 40), leaseToken: LEASE_TOKEN },
        ],
      ]);
    });

    it("reports a reconciled batch with the refreshed job", async () => {
      const harness = createAttemptHarness(batchJob({ retry_count: 1 }));
      harness.claimLease(null);
      harness.reconcileTakeoffBatchJobFn.mockImplementationOnce(async () => {
        harness.state.job = {
          ...harness.state.job,
          status: "completed",
          retry_count: 2,
          error_message: "Note du rapprochement",
        };
        return completedResult();
      });

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "completed",
          trigger: "reconcile",
          retryCount: 2,
          durationMs: 4000,
          errorMessage: "Note du rapprochement",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        ["reconcileTakeoffBatchJob", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
      ]);
      expect(harness.reconcileTakeoffBatchJobFn.mock.calls[0]![1]).toEqual({
        tenantId: TENANT_ID,
        userId: CREATED_BY,
        supabase: vi.mocked(createServiceRoleClient).mock.results.at(-1)!.value,
        now: harness.now,
        assertTenantActive: expect.any(Function),
        renewLease: expect.any(Function),
      });
    });

    it("schedules another reconcile after a retryable failure while the batch is still processing", async () => {
      const harness = createAttemptHarness(batchJob({ provider_reconcile_attempt_count: 3 }));
      harness.claimLease(null);
      harness.reconcileTakeoffBatchJobFn.mockRejectedValueOnce(
        new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, message: "Provider indisponible", retryable: true })
      );

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "awaiting_provider_result",
          trigger: "reconcile",
          retryable: true,
          shouldRequeue: true,
          requeueReason: "reconcile",
          nextRunInSeconds: 40,
          nextRunAt: at(4 + 40),
          durationMs: 6000,
          errorCode: TakeoffErrorCode.AI_PROVIDER,
          errorMessage: "Provider indisponible",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        ["reconcileTakeoffBatchJob", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
        [
          "scheduleReconcile",
          { jobId: JOB_ID, tenantId: TENANT_ID, dueAtIso: at(4 + 40), leaseToken: LEASE_TOKEN },
        ],
        [
          "logger.warn",
          "Takeoff async worker scheduled reconcile retry",
          {
            job_id: JOB_ID,
            tenant_id: TENANT_ID,
            level: "A",
            attempt: 1,
            duration_ms: 5000,
            status: "awaiting_provider_result",
            correlation_id: CORRELATION_ID,
            error_code: TakeoffErrorCode.AI_PROVIDER,
          },
        ],
      ]);
    });

    it("settles a batch canceled during reconcile", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockImplementationOnce(async () => {
        harness.state.job = {
          ...harness.state.job,
          status: "canceled",
          error_message: "Annulé par l'utilisateur",
        };
        throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Job annulé", retryable: false });
      });

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "canceled",
          trigger: "reconcile",
          durationMs: 4000,
          errorMessage: "Annulé par l'utilisateur",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        ["reconcileTakeoffBatchJob", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
        ["clearRetrySchedule", { jobId: JOB_ID, tenantId: TENANT_ID }],
      ]);
    });

    it("reports a terminal failure when the batch reached a terminal status before the reconcile error", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "completed" };
        throw new TakeoffError({ code: TakeoffErrorCode.AI_SCHEMA, message: "Sortie invalide", retryable: true });
      });

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "reconcile",
          durationMs: 4000,
          errorCode: TakeoffErrorCode.AI_SCHEMA,
          errorMessage: "Sortie invalide",
        })
      );
      expect(harness.repository.scheduleReconcile).not.toHaveBeenCalled();
      expect(harness.repository.clearRetrySchedule).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: "a non-retryable error while the batch is still processing",
        afterError: {},
        expected: { errorCode: TakeoffErrorCode.AI_SAFETY, errorMessage: "Bloqué" },
      },
      {
        name: "a failure recorded by the reconcile itself",
        afterError: { status: "failed", error_code: "AI_PROVIDER", error_message: "Batch en échec" },
        expected: { errorCode: "AI_PROVIDER", errorMessage: "Batch en échec" },
      },
    ])("leaves the batch in progress after $name", async ({ afterError, expected }) => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, ...afterError };
        throw new TakeoffError({ code: TakeoffErrorCode.AI_SAFETY, message: "Bloqué", retryable: false });
      });

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({ status: "in_progress", trigger: "reconcile", durationMs: 4000, ...expected })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        ["reconcileTakeoffBatchJob", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
      ]);
    });

    it("treats a reconcile lease lost while scheduling the next reconcile as a reconcile failure", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockResolvedValueOnce(awaitingProviderResult());
      harness.repository.scheduleReconcile.mockRejectedValueOnce(
        new TakeoffError({
          code: TakeoffErrorCode.CONFLICT,
          message: "Le lease de reconciliation n'est plus disponible.",
          retryable: false,
        })
      );

      const outcome = await harness.run("reconcile");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "in_progress",
          trigger: "reconcile",
          durationMs: 5000,
          errorCode: TakeoffErrorCode.CONFLICT,
          errorMessage: "Le lease de reconciliation n'est plus disponible.",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["acquireBatchReconcileLease", leaseClaim],
        ["reconcileTakeoffBatchJob", JOB_ID, expect.anything()],
        [
          "scheduleReconcile",
          { jobId: JOB_ID, tenantId: TENANT_ID, dueAtIso: at(4 + 20), leaseToken: LEASE_TOKEN },
        ],
        ["getJobById", JOB_ID],
      ]);
    });

    it("handles a failed refresh after a completed reconcile as a reconcile failure", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "completed" };
        return completedResult();
      });
      harness.repository.getJobById
        .mockImplementationOnce(async () => ({ ...harness.state.job }))
        .mockRejectedValueOnce(new Error("lecture impossible"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const outcome = await harness.run("reconcile");

        expect(outcome).toEqual(
          expectedOutcome({
            status: "failed_terminal",
            trigger: "reconcile",
            durationMs: 4000,
            errorCode: TakeoffErrorCode.INTERNAL_ERROR,
            errorMessage: "La reconciliation batch du job takeoff a echoue.",
          })
        );
        expect(harness.repository.getJobById).toHaveBeenCalledTimes(3);
        expect(consoleError).toHaveBeenCalledWith("Unexpected takeoff error", expect.any(Error));
      } finally {
        consoleError.mockRestore();
      }
    });

    it("propagates a failure to refresh the job after a reconcile error", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockRejectedValueOnce(
        new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: true })
      );
      const readFailure = new Error("lecture impossible");
      harness.repository.getJobById
        .mockImplementationOnce(async () => ({ ...harness.state.job }))
        .mockRejectedValueOnce(readFailure);

      await expect(harness.run("reconcile")).rejects.toBe(readFailure);
      expect(harness.repository.scheduleReconcile).not.toHaveBeenCalled();
      expect(harness.logger.warn).not.toHaveBeenCalled();
    });

    it("propagates a failure to schedule the reconcile retry", async () => {
      const harness = createAttemptHarness(batchJob());
      harness.claimLease(2);
      harness.reconcileTakeoffBatchJobFn.mockRejectedValueOnce(
        new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: true })
      );
      const conflict = new TakeoffError({ code: TakeoffErrorCode.CONFLICT, retryable: false });
      harness.repository.scheduleReconcile.mockRejectedValueOnce(conflict);

      await expect(harness.run("reconcile")).rejects.toBe(conflict);
      expect(harness.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("level processing", () => {
    it("leaves a job another worker is processing", async () => {
      const harness = createAttemptHarness(workerJob({ status: "processing" }));

      const outcome = await harness.run("manual");

      expect(outcome).toEqual(
        expectedOutcome({ status: "in_progress", trigger: "manual", durationMs: 1000 })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
      ]);
    });

    it("fails a job whose level the worker does not support", async () => {
      const harness = createAttemptHarness(workerJob({ level: "D" }));

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "create",
          level: "D",
          durationMs: 3000,
          errorCode: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
          errorMessage: "Le niveau takeoff n'est pas encore supporte par le worker async.",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["markUnsupportedLevelAsFailed", { jobId: JOB_ID, tenantId: TENANT_ID, nowIso: at(2) }],
      ]);
    });

    it.each(["A", "B", "C"] as const)(
      "runs level %s through its processor and reports the refreshed job",
      async (level) => {
        const harness = createAttemptHarness(workerJob({ level, created_by: null }));
        const processor = {
          A: harness.processLevelAFn,
          B: harness.processLevelBFn,
          C: harness.processLevelCFn,
        }[level];
        processor.mockImplementationOnce(async () => {
          harness.state.job = {
            ...harness.state.job,
            status: "completed",
            retry_count: 1,
            error_code: "PARTIAL",
          };
          return completedResult();
        });

        const outcome = await harness.run("create");

        expect(outcome).toEqual(
          expectedOutcome({
            status: "completed",
            trigger: "create",
            level,
            retryCount: 1,
            durationMs: 2000,
            errorCode: "PARTIAL",
          })
        );
        expect(harness.sequence()).toEqual([
          ["getJobById", JOB_ID],
          ["isTenantActive", TENANT_ID],
          [`processLevel${level}`, JOB_ID, expect.anything()],
          ["getJobById", JOB_ID],
        ]);
        expect(processor.mock.calls[0]![1]).toEqual({
          tenantId: TENANT_ID,
          userId: undefined,
          supabase: vi.mocked(createServiceRoleClient).mock.results.at(-1)!.value,
          now: harness.now,
          assertTenantActive: expect.any(Function),
          renewLease: expect.any(Function),
        });
      }
    );

    it("requeues a job submitted to the provider batch for an immediate reconcile", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockResolvedValueOnce({
        jobId: JOB_ID,
        status: "submitted_to_provider",
        providerBatchId: "batches/test-running",
        durationMs: 10,
      });

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "submitted_to_provider",
          trigger: "create",
          shouldRequeue: true,
          requeueReason: "reconcile",
          nextRunInSeconds: 0,
          nextRunAt: at(2),
          durationMs: 3000,
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelA", JOB_ID, expect.anything()],
      ]);
    });

    it("renews the thirty-minute processing lease on the processor's request", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockImplementationOnce(async (jobId, options) => {
        await options.renewLease({ jobId, tenantId: TENANT_ID, leaseToken: LEASE_TOKEN });
        harness.state.job = { ...harness.state.job, status: "completed" };
        return completedResult();
      });

      await harness.run("create");

      expect(harness.repository.renewLease.mock.calls).toEqual([
        [
          {
            kind: "processing",
            jobId: JOB_ID,
            tenantId: TENANT_ID,
            leaseToken: LEASE_TOKEN,
            nowIso: at(2),
            leaseExpiresAtIso: at(2 + 1800),
          },
        ],
      ]);
    });

    it("leaves the job in progress when the processing lease is lost", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.repository.renewLease.mockRejectedValueOnce(
        new TakeoffError({
          code: TakeoffErrorCode.CONFLICT,
          message: "Le lease takeoff n'est plus disponible.",
          retryable: false,
          jobId: JOB_ID,
        })
      );
      harness.processLevelAFn.mockImplementationOnce(async (jobId, options) => {
        harness.state.job = { ...harness.state.job, status: "processing" };
        await options.renewLease({ jobId, tenantId: TENANT_ID, leaseToken: LEASE_TOKEN });
        return completedResult();
      });

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({ status: "in_progress", trigger: "create", durationMs: 3000 })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelA", JOB_ID, expect.anything()],
        ["renewLease", expect.objectContaining({ kind: "processing" })],
        ["getJobById", JOB_ID],
      ]);
    });

    it("stops before the provider call when the tenant is suspended during processing", async () => {
      const harness = createAttemptHarness(workerJob({ level: "B" }));
      harness.repository.isTenantActive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      harness.processLevelBFn.mockImplementationOnce(async (_jobId, options) => {
        const suspended = options.assertTenantActive(TENANT_ID);
        await expect(suspended).rejects.toMatchObject({
          code: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
          message: "Le tenant a été suspendu avant l'appel fournisseur.",
          retryable: true,
          jobId: JOB_ID,
          level: "B",
        });
        return suspended;
      });

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "create",
          level: "B",
          durationMs: 4000,
          errorCode: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
          errorMessage: "Le tenant a été suspendu avant l'appel fournisseur.",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelB", JOB_ID, expect.anything()],
        ["isTenantActive", TENANT_ID],
        ["getJobById", JOB_ID],
        ["clearRetrySchedule", { jobId: JOB_ID, tenantId: TENANT_ID, lastErrorAtIso: at(2) }],
        ["logger.error", "Takeoff async worker reached terminal failure", expect.anything()],
        ["reportError", expect.anything()],
      ]);
    });

    it("settles a job canceled during processing", async () => {
      const harness = createAttemptHarness(workerJob({ retry_count: 1 }));
      harness.processLevelAFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "canceled", error_code: "CANCELED" };
        throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: true });
      });

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "canceled",
          trigger: "create",
          retryCount: 1,
          durationMs: 2000,
          errorCode: "CANCELED",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelA", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
        ["clearRetrySchedule", { jobId: JOB_ID, tenantId: TENANT_ID }],
      ]);
    });

    it.each(["completed", "applied"])(
      "reports no-op when the job became %s before the processing error",
      async (status) => {
        const harness = createAttemptHarness(workerJob());
        harness.processLevelAFn.mockImplementationOnce(async () => {
          harness.state.job = { ...harness.state.job, status, error_message: "Déjà traité" };
          throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: true });
        });

        const outcome = await harness.run("create");

        expect(outcome).toEqual(
          expectedOutcome({
            status: "noop_terminal",
            trigger: "create",
            durationMs: 2000,
            errorMessage: "Déjà traité",
          })
        );
        expect(harness.sequence()).toEqual([
          ["getJobById", JOB_ID],
          ["isTenantActive", TENANT_ID],
          ["processLevelA", JOB_ID, expect.anything()],
          ["getJobById", JOB_ID],
        ]);
      }
    );

    it.each([
      [0, 5],
      [1, 15],
      [2, 45],
    ])(
      "schedules retry %i of a retryable failure after %i seconds",
      async (retryCount, backoffSeconds) => {
        const harness = createAttemptHarness(workerJob({ retry_count: retryCount }));
        harness.processLevelAFn.mockImplementationOnce(async () => {
          harness.state.job = { ...harness.state.job, status: "failed", error_code: "AI_TIMEOUT" };
          throw new TakeoffError({ code: TakeoffErrorCode.AI_RATE_LIMIT, message: "Trop de requêtes", retryable: true });
        });

        const outcome = await harness.run("create");

        expect(outcome).toEqual(
          expectedOutcome({
            status: "failed_retryable",
            trigger: "create",
            retryCount,
            retryable: true,
            shouldRequeue: true,
            requeueReason: "retry",
            nextRunInSeconds: backoffSeconds,
            nextRunAt: at(2 + backoffSeconds),
            durationMs: 5000,
            errorCode: "AI_TIMEOUT",
            errorMessage: "Trop de requêtes",
          })
        );
        expect(harness.sequence()).toEqual([
          ["getJobById", JOB_ID],
          ["isTenantActive", TENANT_ID],
          ["processLevelA", JOB_ID, expect.anything()],
          ["getJobById", JOB_ID],
          [
            "scheduleRetry",
            {
              jobId: JOB_ID,
              tenantId: TENANT_ID,
              nextRetryAtIso: at(2 + backoffSeconds),
              lastErrorAtIso: at(3),
            },
          ],
          [
            "logger.warn",
            "Takeoff async worker scheduled retry",
            {
              job_id: JOB_ID,
              tenant_id: TENANT_ID,
              level: "A",
              attempt: retryCount + 1,
              duration_ms: 4000,
              status: "failed_retryable",
              correlation_id: CORRELATION_ID,
            },
          ],
        ]);
      }
    );

    it("ends a retryable failure that exhausted its retry budget", async () => {
      const harness = createAttemptHarness(workerJob({ retry_count: 3 }));
      harness.processLevelAFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "failed" };
        throw new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "Timed out", retryable: true });
      });

      const outcome = await harness.run("retry");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "retry",
          retryCount: 3,
          durationMs: 4000,
          errorCode: TakeoffErrorCode.AI_TIMEOUT,
          errorMessage: "Timed out",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelA", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
        ["clearRetrySchedule", { jobId: JOB_ID, tenantId: TENANT_ID, lastErrorAtIso: at(2) }],
        [
          "logger.error",
          "Takeoff async worker reached terminal failure",
          {
            job_id: JOB_ID,
            tenant_id: TENANT_ID,
            level: "A",
            attempt: 4,
            duration_ms: 3000,
            status: "failed_terminal",
            correlation_id: CORRELATION_ID,
            error_code: TakeoffErrorCode.AI_TIMEOUT,
          },
        ],
        [
          "reportError",
          {
            error: new Error("Timed out"),
            source: "takeoff.async-worker",
            context: {
              job_id: JOB_ID,
              tenant_id: TENANT_ID,
              status: "failed_terminal",
              correlation_id: CORRELATION_ID,
              error_code: TakeoffErrorCode.AI_TIMEOUT,
            },
          },
        ],
      ]);
    });

    it("ends a retryable failure when the job was not marked failed", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockRejectedValueOnce(
        new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "Timed out", retryable: true })
      );

      const outcome = await harness.run("create");

      expect(outcome.status).toBe("failed_terminal");
      expect(harness.repository.scheduleRetry).not.toHaveBeenCalled();
      expect(harness.repository.clearRetrySchedule).toHaveBeenCalledWith({
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        lastErrorAtIso: at(2),
      });
    });

    it("maps an unexpected processor exception to the async processing failure", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockRejectedValueOnce(new Error("socket hang up"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const outcome = await harness.run("create");

        expect(outcome).toEqual(
          expectedOutcome({
            status: "failed_terminal",
            trigger: "create",
            durationMs: 4000,
            errorCode: TakeoffErrorCode.INTERNAL_ERROR,
            errorMessage: "Le traitement async du job takeoff a echoue.",
          })
        );
        expect(consoleError).toHaveBeenCalledWith("Unexpected takeoff error", expect.any(Error));
        expect(vi.mocked(reportError)).toHaveBeenCalledWith(
          expect.objectContaining({ error: new Error("Le traitement async du job takeoff a echoue.") })
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it("handles a failed refresh after a completed processing as a processing failure", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "completed" };
        return completedResult();
      });
      const readFailure = new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
      harness.repository.getJobById
        .mockImplementationOnce(async () => ({ ...harness.state.job }))
        .mockRejectedValueOnce(readFailure);

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({ status: "noop_terminal", trigger: "create", durationMs: 2000 })
      );
      expect(harness.repository.getJobById).toHaveBeenCalledTimes(3);
    });

    it.each([
      {
        stage: "the refresh after a processing error",
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.getJobById
            .mockImplementationOnce(async () => ({ ...harness.state.job }))
            .mockRejectedValueOnce(failure);
        },
        status: "failed",
      },
      {
        stage: "the retry scheduling",
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.scheduleRetry.mockRejectedValueOnce(failure);
        },
        status: "failed",
      },
      {
        stage: "the terminal failure write",
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.clearRetrySchedule.mockRejectedValueOnce(failure);
        },
        status: "pending",
      },
    ])("propagates a failure of $stage without logging the settlement", async ({ arrange, status }) => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status };
        throw new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, retryable: true });
      });
      const failure = new Error("écriture impossible");
      arrange(harness, failure);

      await expect(harness.run("create")).rejects.toBe(failure);
      expect(harness.logger.warn).not.toHaveBeenCalled();
      expect(harness.logger.error).not.toHaveBeenCalled();
      expect(vi.mocked(reportError)).not.toHaveBeenCalled();
    });
  });

  describe("repository failures outside the processing step", () => {
    it.each([
      {
        stage: "the job read",
        job: workerJob(),
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.getJobById.mockRejectedValueOnce(failure);
        },
      },
      {
        stage: "the tenant check",
        job: workerJob(),
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.isTenantActive.mockRejectedValueOnce(failure);
        },
      },
      {
        stage: "the rejected retry write",
        job: workerJob({ status: "failed", retry_count: 3 }),
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.clearRetrySchedule.mockRejectedValueOnce(failure);
        },
      },
      {
        stage: "the reconcile lease claim",
        job: batchJob(),
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.acquireBatchReconcileLease.mockRejectedValueOnce(failure);
        },
      },
      {
        stage: "the batch timeout write",
        job: batchJob(),
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.claimLease(25);
          harness.repository.markBatchReconcileTimeoutAsFailed.mockRejectedValueOnce(failure);
        },
      },
      {
        stage: "the unsupported level write",
        job: workerJob({ level: "Z" }),
        arrange: (harness: ReturnType<typeof createAttemptHarness>, failure: Error) => {
          harness.repository.markUnsupportedLevelAsFailed.mockRejectedValueOnce(failure);
        },
      },
    ])("propagates a failure of $stage unchanged", async ({ job, arrange }) => {
      const harness = createAttemptHarness(job);
      const failure = new Error("base indisponible");
      arrange(harness, failure);

      await expect(harness.run("retry")).rejects.toBe(failure);
      expect(harness.logger.error).not.toHaveBeenCalled();
      expect(harness.processLevelAFn).not.toHaveBeenCalled();
      expect(harness.reconcileTakeoffBatchJobFn).not.toHaveBeenCalled();
    });
  });
});

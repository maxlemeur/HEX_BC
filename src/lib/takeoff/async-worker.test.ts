import { describe, expect, it, vi } from "vitest";

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
    }>,
    unsupportedCalls: [] as Array<{
      jobId: string;
      tenantId: string;
      nowIso: string;
    }>,
  };

  const repository = {
    getJobById: vi.fn(async () => ({ ...state.job })),
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
      async (): Promise<{ claimed: boolean; attemptCount: number | null }> => ({
        claimed: false,
        attemptCount: null,
      })
    ),
    scheduleReconcile: vi.fn(
      async (input: { jobId: string; tenantId: string; dueAtIso: string }) => {
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
      async (input: { jobId: string; tenantId: string; nowIso: string }) => {
        state.job = {
          ...state.job,
          status: "failed",
          error_code: TakeoffErrorCode.AI_TIMEOUT,
          error_message:
            "Le batch provider n'a pas atteint d'etat terminal apres epuisement des tentatives de reconciliation.",
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
  it("returns completed outcome when level A succeeds", async () => {
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
      created_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      next_retry_at: null,
      last_error_at: null,
    });

    const processLevelAFn = vi.fn(async () => {
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
      trigger: "create",
      repository,
      processLevelAFn,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.should_requeue).toBe(false);
    expect(repository.clearRetrySchedule).toHaveBeenCalledTimes(1);
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
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
    expect(repository.clearRetrySchedule).toHaveBeenCalledTimes(1);
  });

  it("marks unsupported levels as terminal failures", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "Z",
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

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "create",
      repository,
      processLevelAFn: vi.fn() as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("failed_terminal");
    expect(outcome.error_code).toBe(TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED);
    expect(repository.markUnsupportedLevelAsFailed).toHaveBeenCalledTimes(1);
  });

  it("dispatches level B jobs to the level B processor", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "B",
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

    const processLevelBFn = vi.fn(async () => {
      state.job = {
        ...state.job,
        status: "completed",
      };

      return {
        jobId: JOB_ID,
        resultId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        status: "completed" as const,
        itemsCount: 3,
        warningsCount: 0,
        tokenCount: 222,
        costCents: 10,
        durationMs: 500,
        tablesCount: 2,
      };
    });

    const processLevelAFn = vi.fn();
    const processLevelCFn = vi.fn();

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "create",
      repository,
      processLevelAFn: processLevelAFn as never,
      processLevelBFn: processLevelBFn as never,
      processLevelCFn: processLevelCFn as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("completed");
    expect(processLevelBFn).toHaveBeenCalledTimes(1);
    expect(processLevelAFn).not.toHaveBeenCalled();
    expect(processLevelCFn).not.toHaveBeenCalled();
  });

  it("dispatches level C jobs to the level C processor", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "C",
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

    const processLevelCFn = vi.fn(async () => {
      state.job = {
        ...state.job,
        status: "completed",
      };

      return {
        jobId: JOB_ID,
        resultId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        status: "completed" as const,
        itemsCount: 4,
        warningsCount: 1,
        tokenCount: 800,
        costCents: 30,
        durationMs: 1_500,
        tablesCount: 0,
        chunksCount: 3,
        pageCount: 26,
      };
    });

    const processLevelAFn = vi.fn();
    const processLevelBFn = vi.fn();

    const outcome = await processTakeoffJobAttempt(JOB_ID, {
      correlationId: CORRELATION_ID,
      trigger: "create",
      repository,
      processLevelAFn: processLevelAFn as never,
      processLevelBFn: processLevelBFn as never,
      processLevelCFn: processLevelCFn as never,
      now: () => FIXED_NOW,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(outcome.status).toBe("completed");
    expect(processLevelCFn).toHaveBeenCalledTimes(1);
    expect(processLevelAFn).not.toHaveBeenCalled();
    expect(processLevelBFn).not.toHaveBeenCalled();
  });
});

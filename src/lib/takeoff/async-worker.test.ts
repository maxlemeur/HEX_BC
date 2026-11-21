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
import { takeoffAnalysisFailureFields } from "@/lib/takeoff/completion-outcome";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

type WorkerJobRow = {
  id: string;
  tenant_id: string;
  level: string;
  status: string;
  execution_provider: string | null;
  analysis_outcome?: string | null;
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
    clearCalls: [] as Array<{
      jobId: string;
      tenantId: string;
      lastErrorAtIso?: string;
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
        return true;
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
    renewLease: vi.fn(async () => undefined),
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
      execution_provider: "chatgpt_local",
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

  it("returns the retry that the processor committed", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "pending",
      execution_provider: "chatgpt_local",
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
        next_retry_at: at(5),
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
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns failed_terminal when retry budget is exhausted", async () => {
    const { state, repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "failed",
      analysis_outcome: "failure",
      execution_provider: "chatgpt_local",
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
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(processLevelAFn).not.toHaveBeenCalled();
  });

  it("does not process a failed job before its scheduled retry time", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "failed",
      execution_provider: "chatgpt_local",
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
      execution_provider: "chatgpt_local",
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
      execution_provider: "chatgpt_local",
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

    expect(outcome.status).toBe("noop_terminal");
    expect(outcome.should_requeue).toBe(false);
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(processLevelAFn).not.toHaveBeenCalled();
  });

  it("returns in_progress when concurrent trigger sees processing status", async () => {
    const { repository } = createWorkerRepository({
      id: JOB_ID,
      tenant_id: TENANT_ID,
      level: "A",
      status: "processing",
      execution_provider: "chatgpt_local",
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

function at(seconds: number) {
  return new Date(FIXED_NOW.getTime() + seconds * 1000).toISOString();
}

function workerJob(overrides: Partial<WorkerJobRow> = {}): WorkerJobRow {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    level: "A",
    status: "pending",
    execution_provider: "chatgpt_local",
    retry_count: 0,
    error_code: null,
    error_message: null,
    created_by: CREATED_BY,
    next_retry_at: null,
    last_error_at: null,
    ...overrides,
  };
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

  const run = (trigger: "create" | "retry" | "manual", jobId = JOB_ID) =>
    processTakeoffJobAttempt(jobId, {
      correlationId: CORRELATION_ID,
      trigger,
      repository,
      processLevelAFn: processLevelAFn as never,
      processLevelBFn: processLevelBFn as never,
      processLevelCFn: processLevelCFn as never,
      now,
      logger,
    });

  const sequence = () =>
    callSequence({
      ...(repository as unknown as Record<string, RecordedMock>),
      processLevelA: processLevelAFn as unknown as RecordedMock,
      processLevelB: processLevelBFn as unknown as RecordedMock,
      processLevelC: processLevelCFn as unknown as RecordedMock,
      "logger.info": logger.info as unknown as RecordedMock,
      "logger.warn": logger.warn as unknown as RecordedMock,
      "logger.error": logger.error as unknown as RecordedMock,
      reportError: vi.mocked(reportError) as unknown as RecordedMock,
    });

  return {
    state,
    repository,
    logger,
    now,
    processLevelAFn,
    processLevelBFn,
    processLevelCFn,
    run,
    sequence,
  };
}

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
      vi.mocked(createServiceRoleClient).mockClear();

      await expect(harness.run("create", "not-a-uuid")).rejects.toMatchObject({
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "job_id doit être un UUID valide.",
        retryable: false,
      });
      expect(harness.sequence()).toEqual([]);
      expect(createServiceRoleClient).toHaveBeenCalledTimes(1);
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

    it("refuses a job of a former provider before any write or processing", async () => {
      const harness = createAttemptHarness(
        workerJob({ status: "failed", execution_provider: "gemini", retry_count: 1, next_retry_at: at(-60), error_code: "AI_TIMEOUT" })
      );

      await expect(harness.run("retry")).rejects.toMatchObject({
        code: TakeoffErrorCode.AI_PROVIDER,
        status: 422,
        retryable: false,
        message: expect.stringContaining("Cet ancien métré"),
      });
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
      ]);
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
    it("leaves a historical exhausted retry and its error date untouched", async () => {
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
          status: "noop_terminal",
          trigger: "retry",
          retryCount: 3,
          durationMs: 1000,
          errorCode: "AI_TIMEOUT",
          errorMessage: "Timed out",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
      ]);
      expect(harness.state.job.last_error_at).toBe(at(-60));
    });

    it("keeps the committed retry when a manual trigger is replayed", async () => {
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
          status: "failed_retryable",
          retryable: true,
          shouldRequeue: true,
          requeueReason: "retry",
          nextRunInSeconds: 0,
          nextRunAt: at(-10),
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
          // The claim accepts only the state this attempt loaded and decided on.
          claimObservation: { status: "pending", retryCount: 0 },
        });
      }
    );

    it("reports the loaded retry count when the job cannot be read again after processing", async () => {
      const harness = createAttemptHarness(workerJob({ retry_count: 2 }));
      harness.processLevelAFn.mockResolvedValueOnce(completedResult());
      harness.repository.getJobById
        .mockImplementationOnce(async () => ({ ...harness.state.job }))
        .mockResolvedValueOnce(null as never);

      const outcome = await harness.run("create");

      expect(outcome).toEqual(
        expectedOutcome({ status: "completed", trigger: "create", retryCount: 2, durationMs: 2000 })
      );
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
        ["renewLease", expect.objectContaining({ jobId: JOB_ID, leaseToken: LEASE_TOKEN })],
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
          durationMs: 3000,
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
        ["logger.error", "Takeoff async worker reached terminal failure", expect.objectContaining({
          error_code: TakeoffErrorCode.TAKEOFF_TENANT_INACTIVE,
        })],
        ["reportError", expect.objectContaining({ source: "takeoff.async-worker" })],
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
      "returns the committed retry %i with a %i second delay",
      async (retryCount, backoffSeconds) => {
        const harness = createAttemptHarness(workerJob({ retry_count: retryCount }));
        harness.processLevelAFn.mockImplementationOnce(async () => {
          harness.state.job = {
            ...harness.state.job, status: "failed", error_code: "AI_TIMEOUT", error_message: "Trop de requêtes",
            ...takeoffAnalysisFailureFields({ retryable: true, retryCount, completedAtIso: at(2) }),
          };
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
            durationMs: 3000,
            errorCode: "AI_TIMEOUT",
            errorMessage: "Trop de requêtes",
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

    it("ends a retryable failure that exhausted its retry budget", async () => {
      const harness = createAttemptHarness(workerJob({ retry_count: 3 }));
      harness.processLevelAFn.mockImplementationOnce(async () => {
        harness.state.job = { ...harness.state.job, status: "failed", analysis_outcome: "failure" };
        throw new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "Timed out", retryable: true });
      });

      const outcome = await harness.run("retry");

      expect(outcome).toEqual(
        expectedOutcome({
          status: "failed_terminal",
          trigger: "retry",
          retryCount: 3,
          durationMs: 3000,
          errorCode: TakeoffErrorCode.AI_TIMEOUT,
          errorMessage: "Timed out",
        })
      );
      expect(harness.sequence()).toEqual([
        ["getJobById", JOB_ID],
        ["isTenantActive", TENANT_ID],
        ["processLevelA", JOB_ID, expect.anything()],
        ["getJobById", JOB_ID],
        [
          "logger.error",
          "Takeoff async worker reached terminal failure",
          {
            job_id: JOB_ID,
            tenant_id: TENANT_ID,
            level: "A",
            attempt: 4,
            duration_ms: 2000,
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

    it("leaves an unclaimed job available after a retryable failure", async () => {
      const harness = createAttemptHarness(workerJob());
      harness.processLevelAFn.mockRejectedValueOnce(
        new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "Timed out", retryable: true })
      );

      const outcome = await harness.run("create");

      expect(outcome.status).toBe("failed_terminal");
      expect(outcome.error_code).toBe(TakeoffErrorCode.AI_TIMEOUT);
      expect(outcome.should_requeue).toBe(false);
      expect(harness.state.job.status).toBe("pending");
      expect(harness.repository.clearRetrySchedule).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ source: "takeoff.async-worker" }));
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
            durationMs: 3000,
            errorCode: TakeoffErrorCode.INTERNAL_ERROR,
            errorMessage: "Le traitement async du job takeoff a echoue.",
          })
        );
        expect(consoleError).toHaveBeenCalledWith("Unexpected takeoff error", expect.any(Error));
        expect(vi.mocked(reportError)).toHaveBeenCalledWith(expect.objectContaining({
          error: new Error("Le traitement async du job takeoff a echoue."),
          source: "takeoff.async-worker",
        }));
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
    });
  });
});

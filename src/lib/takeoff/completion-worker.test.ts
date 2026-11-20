import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { normalizeTakeoffWorkerJobRow } from "@/lib/takeoff/job-lifecycle";

const id = "8f400000-0000-4000-8000-000000000021";
const tenant = "8f400000-0000-4000-8000-000000000010";
const now = new Date("2026-11-20T08:00:00Z");
const nextRetryAt = new Date(now.getTime() + 5_000).toISOString();

function fixture(status: string) {
  const row = normalizeTakeoffWorkerJobRow({ id, tenant_id: tenant, status, level: "C", execution_provider: "chatgpt_local" })!;
  const repository = {
    getJobById: vi.fn(async () => ({ ...row })),
    isTenantActive: vi.fn(async () => true),
    markUnsupportedLevelAsFailed: vi.fn(),
    scheduleRetry: vi.fn(),
    clearRetrySchedule: vi.fn(),
    renewLease: vi.fn(),
    acquireBatchReconcileLease: vi.fn(),
    scheduleReconcile: vi.fn(),
    markBatchReconcileTimeoutAsFailed: vi.fn(),
  };
  return { row, repository, options: { correlationId: id, now: () => now, repository, logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  } } };
}

describe("durable takeoff failure decisions", () => {
  it("keeps a retry committed by the processor despite a later exception", async () => {
    const { row, options, repository } = fixture("pending");
    const outcome = await processTakeoffJobAttempt(id, {
      ...options, trigger: "create", processLevelCFn: vi.fn(async () => {
        row.status = "failed";
        row.error_code = TakeoffErrorCode.AI_TIMEOUT;
        row.next_retry_at = nextRetryAt;
        throw new Error("failure while recording post-attempt diagnostics");
      }),
    });
    expect(outcome).toMatchObject({ status: "failed_retryable", next_run_at: nextRetryAt, error_code: "AI_TIMEOUT" });
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
  });

  it("preserves a committed retry when the original callback is delivered again", async () => {
    const { row, options, repository } = fixture("failed");
    row.next_retry_at = nextRetryAt;
    const processLevelCFn = vi.fn();
    const outcome = await processTakeoffJobAttempt(id, { ...options, trigger: "create", processLevelCFn });
    expect(outcome).toMatchObject({ status: "failed_retryable", next_run_at: nextRetryAt });
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(processLevelCFn).not.toHaveBeenCalled();
  });

  it("leaves an unclaimed due retry to bounded recovery instead of immediately requeueing it", async () => {
    const { row, options, repository } = fixture("failed");
    row.next_retry_at = new Date(now.getTime() - 1_000).toISOString();
    const outcome = await processTakeoffJobAttempt(id, {
      ...options, trigger: "retry",
      processLevelCFn: vi.fn().mockRejectedValue(new Error("lease claim failed")),
    });
    expect(outcome).toMatchObject({ status: "in_progress", should_requeue: false });
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
  });

  it("does not infer a definitive failure from a historical failed status", async () => {
    const { repository, options } = fixture("failed");
    const processLevelCFn = vi.fn().mockRejectedValue(new TakeoffError({
      code: TakeoffErrorCode.AI_PROVIDER, message: "fixture error", retryable: false,
    }));
    const outcome = await processTakeoffJobAttempt(id, { ...options, trigger: "retry", processLevelCFn });
    expect(outcome).toMatchObject({ status: "noop_terminal", should_requeue: false });
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(processLevelCFn).not.toHaveBeenCalled();
  });
});

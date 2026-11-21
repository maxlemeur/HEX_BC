import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { reportError } from "@/lib/observability/error-reporter";
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
    clearRetrySchedule: vi.fn(),
    renewLease: vi.fn(),
  };
  return { row, repository, options: { correlationId: id, now: () => now, repository, logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  } } };
}

describe("durable takeoff failure decisions", () => {
  it("reports a rejected admission without settling the accepted pending job", async () => {
    const { options } = fixture("pending");
    const outcome = await processTakeoffJobAttempt(id, {
      ...options, trigger: "create", processLevelCFn: vi.fn().mockRejectedValue(new TakeoffError({
        code: TakeoffErrorCode.CONFLICT, message: "fixture admission rejected", retryable: false,
      })),
    });
    expect(outcome).toMatchObject({ status: "failed_terminal", error_code: "CONFLICT", should_requeue: false });
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ source: "takeoff.async-worker",
      context: expect.objectContaining({ job_id: id, error_code: "CONFLICT" }) }));
  });

  it("keeps the thrown diagnostic on a freshly committed retry with missing diagnostic fields", async () => {
    const { row, options } = fixture("pending");
    const outcome = await processTakeoffJobAttempt(id, {
      ...options, trigger: "create", processLevelCFn: vi.fn(async () => {
        row.status = "failed";
        row.next_retry_at = nextRetryAt;
        throw new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "fixture timeout", retryable: true });
      }),
    });
    expect(outcome).toMatchObject({ error_code: "AI_TIMEOUT", error_message: "fixture timeout", next_run_in_seconds: 5 });
  });

  it("reports a freshly persisted terminal failure before notifications are activated", async () => {
    const { row, options, repository } = fixture("pending");
    const outcome = await processTakeoffJobAttempt(id, {
      ...options, trigger: "create", processLevelCFn: vi.fn(async () => {
        row.status = "failed";
        row.last_error_at = now.toISOString();
        throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, message: "fixture provider failure", retryable: false });
      }),
    });
    expect(outcome).toMatchObject({ status: "failed_terminal", error_code: "AI_PROVIDER" });
    expect(row.last_error_at).toBe(now.toISOString());
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
  });

  it("does not report unsupported-level failure when cancellation won the pending update", async () => {
    const { row, repository, options } = fixture("pending");
    row.level = "Z";
    repository.markUnsupportedLevelAsFailed.mockImplementation(async () => {
      row.status = "canceled";
      return false;
    });
    const outcome = await processTakeoffJobAttempt(id, { ...options, trigger: "create" });
    expect(outcome).toMatchObject({ status: "canceled", should_requeue: false });
  });
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

  it("reports a due retry whose claim was rejected and leaves its schedule to the recovery poll", async () => {
    const { row, options, repository } = fixture("failed");
    const dueAt = new Date(now.getTime() - 1_000).toISOString();
    Object.assign(row, { next_retry_at: dueAt, error_code: TakeoffErrorCode.AI_TIMEOUT, error_message: "fixture earlier timeout" });
    vi.mocked(reportError).mockClear();
    const outcome = await processTakeoffJobAttempt(id, {
      ...options, trigger: "retry",
      processLevelCFn: vi.fn().mockRejectedValue(new Error("lease claim failed")),
    });
    expect(outcome).toMatchObject({ status: "failed_terminal", should_requeue: false, error_code: "INTERNAL_ERROR" });
    expect(repository.clearRetrySchedule).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: "failed", next_retry_at: dueAt });
    // The rejected attempt is reported, not the earlier failure the schedule retries.
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({
      error: new Error("Le traitement async du job takeoff a echoue."), source: "takeoff.async-worker",
      context: expect.objectContaining({ job_id: id, error_code: "INTERNAL_ERROR" }),
    }));
    expect(options.logger.error).toHaveBeenCalledWith("Takeoff async worker reached terminal failure",
      expect.objectContaining({ job_id: id, error_code: "INTERNAL_ERROR" }));
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

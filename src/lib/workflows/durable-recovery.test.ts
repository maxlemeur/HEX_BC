import { describe, expect, it, vi } from "vitest";

import {
  MAX_DURABLE_RECOVERY_ATTEMPTS,
  recoverDurableWorkflows,
} from "@/lib/workflows/durable-recovery";

const TAKEOFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INTAKE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STORAGE_CLEANUP_RESULT = {
  claimed: 1,
  removed: 1,
  failed: 0,
  skipped: false,
  errors: [],
};
const EMAIL_OUTBOX_RESULT = {
  claimed: 1,
  sent: 1,
  failed: 0,
  dead: 0,
  skipped: false,
  errors: [],
};

function createClient(dueRows: unknown[]) {
  return {
    rpc: vi.fn(async (name: string) => {
      if (name === "recover_stale_takeoff_jobs") {
        return { data: [{ job_id: TAKEOFF_ID }], error: null };
      }
      return { data: dueRows, error: null };
    }),
  };
}

function createRetryStore() {
  const counts = new Map<string, number>();
  const dead = new Set<string>();
  return {
    counts,
    dead,
    getRetryCount: vi.fn(async (workId: string) => counts.get(workId) ?? 0),
    incrementRetryCount: vi.fn(async (workId: string) => {
      const next = (counts.get(workId) ?? 0) + 1;
      counts.set(workId, next);
      return next;
    }),
    markDead: vi.fn(async (workId: string) => {
      dead.add(workId);
    }),
  };
}

describe("durable workflow recovery", () => {
  it("dispatches due takeoff and intake work with their durable trigger", async () => {
    const client = createClient([
      {
        workflow_kind: "takeoff",
        work_id: TAKEOFF_ID,
        trigger_kind: "retry",
      },
      {
        workflow_kind: "affaire_intake",
        work_id: INTAKE_ID,
        trigger_kind: "process",
      },
    ]);
    const triggerTakeoff = vi.fn().mockResolvedValue({
      triggered: true,
      correlationId: "correlation",
      statusCode: 202,
    });
    const processIntake = vi.fn().mockResolvedValue("ready");
    const persistTakeoffDispatch = vi.fn().mockResolvedValue(true);
    const drainStorageCleanup = vi
      .fn()
      .mockResolvedValue(STORAGE_CLEANUP_RESULT);
    const drainEmailOutbox = vi.fn().mockResolvedValue(EMAIL_OUTBOX_RESULT);

    const result = await recoverDurableWorkflows({
      client,
      triggerTakeoff,
      persistTakeoffDispatch,
      processIntake,
      drainStorageCleanup,
      drainEmailOutbox,
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    });

    expect(triggerTakeoff).toHaveBeenCalledWith({
      jobId: TAKEOFF_ID,
      trigger: "retry",
    });
    expect(processIntake).toHaveBeenCalledWith(INTAKE_ID);
    expect(persistTakeoffDispatch).toHaveBeenCalledWith({
      jobId: TAKEOFF_ID,
      trigger: "retry",
      result: expect.objectContaining({ triggered: true }),
    });
    expect(drainStorageCleanup).toHaveBeenCalledWith({
      client: undefined,
      limit: 25,
    });
    expect(drainEmailOutbox).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      recoveredUnknownTakeoffJobs: 1,
      dueCount: 2,
      dispatchedCount: 2,
      failedCount: 0,
      skippedCount: 0,
      deadCount: 0,
      failures: [],
      procurementStorageCleanup: STORAGE_CLEANUP_RESULT,
      emailOutbox: EMAIL_OUTBOX_RESULT,
    });
  });

  it("keeps refused dispatches due and caps expensive intake work per run", async () => {
    const client = createClient([
      {
        workflow_kind: "takeoff",
        work_id: TAKEOFF_ID,
        trigger_kind: "create",
      },
      {
        workflow_kind: "affaire_intake",
        work_id: INTAKE_ID,
        trigger_kind: "process",
      },
    ]);
    const triggerTakeoff = vi.fn().mockResolvedValue({
      triggered: false,
      correlationId: "correlation",
      statusCode: 503,
    });
    const processIntake = vi.fn();
    const persistTakeoffDispatch = vi.fn().mockResolvedValue(true);
    const drainStorageCleanup = vi
      .fn()
      .mockResolvedValue(STORAGE_CLEANUP_RESULT);

    const result = await recoverDurableWorkflows({
      client,
      triggerTakeoff,
      persistTakeoffDispatch,
      processIntake,
      drainStorageCleanup,
      drainEmailOutbox: async () => EMAIL_OUTBOX_RESULT,
      maxIntakePerRun: 0,
    });

    expect(processIntake).not.toHaveBeenCalled();
    expect(persistTakeoffDispatch).toHaveBeenCalledWith({
      jobId: TAKEOFF_ID,
      trigger: "create",
      result: expect.objectContaining({ triggered: false }),
    });
    expect(result.dispatchedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.deadCount).toBe(0);
  });

  it("marks the same workId dead after MAX_DURABLE_RECOVERY_ATTEMPTS failures and does not dispatch again", async () => {
    const client = createClient([
      {
        workflow_kind: "takeoff",
        work_id: TAKEOFF_ID,
        trigger_kind: "retry",
      },
    ]);
    const triggerTakeoff = vi.fn().mockRejectedValue(new Error("poisoned item"));
    const persistTakeoffDispatch = vi.fn();
    const processIntake = vi.fn();
    const drainStorageCleanup = vi
      .fn()
      .mockResolvedValue(STORAGE_CLEANUP_RESULT);
    const retryStore = createRetryStore();
    const deps = {
      client,
      triggerTakeoff,
      persistTakeoffDispatch,
      processIntake,
      drainStorageCleanup,
      drainEmailOutbox: async () => EMAIL_OUTBOX_RESULT,
      getRetryCount: retryStore.getRetryCount,
      incrementRetryCount: retryStore.incrementRetryCount,
      markDead: retryStore.markDead,
    };

    for (let attempt = 0; attempt < MAX_DURABLE_RECOVERY_ATTEMPTS; attempt += 1) {
      const result = await recoverDurableWorkflows(deps);
      expect(result.dispatchedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.deadCount).toBe(
        attempt === MAX_DURABLE_RECOVERY_ATTEMPTS - 1 ? 1 : 0
      );
    }

    expect(triggerTakeoff).toHaveBeenCalledTimes(MAX_DURABLE_RECOVERY_ATTEMPTS);
    expect(retryStore.incrementRetryCount).toHaveBeenCalledTimes(
      MAX_DURABLE_RECOVERY_ATTEMPTS
    );
    expect(retryStore.markDead).toHaveBeenCalledWith(TAKEOFF_ID);
    expect(retryStore.dead.has(TAKEOFF_ID)).toBe(true);
    expect(retryStore.counts.get(TAKEOFF_ID)).toBe(MAX_DURABLE_RECOVERY_ATTEMPTS);

    triggerTakeoff.mockClear();
    const capped = await recoverDurableWorkflows(deps);

    expect(triggerTakeoff).not.toHaveBeenCalled();
    expect(capped.dispatchedCount).toBe(0);
    expect(capped.failedCount).toBe(0);
    expect(capped.deadCount).toBe(1);
    expect(capped.failures).toEqual([]);
  });

  it("persists takeoff retry_count and a terminal failed status through the default table store", async () => {
    const client = createClient([
      {
        workflow_kind: "takeoff",
        work_id: TAKEOFF_ID,
        trigger_kind: "create",
      },
    ]);
    const takeoffRow: Record<string, unknown> = {
      retry_count: 0,
      status: "pending",
      next_retry_at: null,
    };
    const tableClient = {
      from(table: string) {
        expect(table).toBe("takeoff_jobs");
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: takeoffRow, error: null };
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq() {
                Object.assign(takeoffRow, payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };
    const triggerTakeoff = vi.fn().mockRejectedValue(new Error("poisoned item"));
    const drainStorageCleanup = vi
      .fn()
      .mockResolvedValue(STORAGE_CLEANUP_RESULT);
    const deps = {
      client,
      tableClient,
      triggerTakeoff,
      persistTakeoffDispatch: vi.fn(),
      processIntake: vi.fn(),
      drainStorageCleanup,
      drainEmailOutbox: async () => EMAIL_OUTBOX_RESULT,
      now: () => new Date("2026-08-19T01:00:00.000Z"),
    };

    for (let attempt = 0; attempt < MAX_DURABLE_RECOVERY_ATTEMPTS; attempt += 1) {
      await recoverDurableWorkflows(deps);
    }

    expect(takeoffRow.retry_count).toBe(MAX_DURABLE_RECOVERY_ATTEMPTS);
    expect(takeoffRow.status).toBe("failed");
    expect(takeoffRow.next_retry_at).toBeNull();
    expect(takeoffRow.error_code).toBe("DURABLE_RECOVERY_DEAD");

    triggerTakeoff.mockClear();
    const capped = await recoverDurableWorkflows(deps);
    expect(triggerTakeoff).not.toHaveBeenCalled();
    expect(capped.deadCount).toBe(1);
  });
});

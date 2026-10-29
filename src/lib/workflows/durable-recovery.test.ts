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
  blocked: 0,
  skipped: false,
  errors: [],
};

function createClient(dueRows: unknown[]) {
  return {
    rpc: vi.fn(async (name: string) => {
      if (name === "recover_stale_local_takeoff_jobs") {
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
  it("skips historic takeoff work and caps expensive intake work per run", async () => {
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
    expect(triggerTakeoff).not.toHaveBeenCalled();
    expect(persistTakeoffDispatch).not.toHaveBeenCalled();
    expect(result.dispatchedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(2);
    expect(result.deadCount).toBe(0);
  });

  it("marks the same workId dead after MAX_DURABLE_RECOVERY_ATTEMPTS failures and does not dispatch again", async () => {
    const client = createClient([
      {
        workflow_kind: "affaire_intake",
        work_id: INTAKE_ID,
        trigger_kind: "process",
      },
    ]);
    const triggerTakeoff = vi.fn().mockRejectedValue(new Error("poisoned item"));
    const persistTakeoffDispatch = vi.fn();
    const processIntake = vi.fn().mockRejectedValue(new Error("poisoned item"));
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

    expect(processIntake).toHaveBeenCalledTimes(MAX_DURABLE_RECOVERY_ATTEMPTS);
    expect(retryStore.incrementRetryCount).toHaveBeenCalledTimes(
      MAX_DURABLE_RECOVERY_ATTEMPTS
    );
    expect(retryStore.markDead).toHaveBeenCalledWith(INTAKE_ID);
    expect(retryStore.dead.has(INTAKE_ID)).toBe(true);
    expect(retryStore.counts.get(INTAKE_ID)).toBe(MAX_DURABLE_RECOVERY_ATTEMPTS);

    triggerTakeoff.mockClear();
    const capped = await recoverDurableWorkflows(deps);

    expect(triggerTakeoff).not.toHaveBeenCalled();
    expect(capped.dispatchedCount).toBe(0);
    expect(capped.failedCount).toBe(0);
    expect(capped.deadCount).toBe(1);
    expect(capped.failures).toEqual([]);
  });

  it("persists intake attempt_count and a terminal failed status through the default table store", async () => {
    const client = createClient([
      {
        workflow_kind: "affaire_intake",
        work_id: INTAKE_ID,
        trigger_kind: "process",
      },
    ]);
    const intakeRow: Record<string, unknown> = {
      attempt_count: 0,
      status: "pending",
      next_retry_at: null,
    };
    const tableClient = {
      from(table: string) {
        expect(table).toBe("affaire_intake_uploads");
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: intakeRow, error: null };
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq() {
                Object.assign(intakeRow, payload);
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
      processIntake: vi.fn().mockRejectedValue(new Error("poisoned item")),
      drainStorageCleanup,
      drainEmailOutbox: async () => EMAIL_OUTBOX_RESULT,
      now: () => new Date("2026-08-19T01:00:00.000Z"),
    };

    for (let attempt = 0; attempt < MAX_DURABLE_RECOVERY_ATTEMPTS; attempt += 1) {
      await recoverDurableWorkflows(deps);
    }

    expect(intakeRow.attempt_count).toBe(MAX_DURABLE_RECOVERY_ATTEMPTS);
    expect(intakeRow.status).toBe("failed");
    expect(intakeRow.next_retry_at).toBeNull();
    expect(intakeRow.last_error).toBe("La reprise durable a epuise son budget de tentatives.");

    triggerTakeoff.mockClear();
    const capped = await recoverDurableWorkflows(deps);
    expect(triggerTakeoff).not.toHaveBeenCalled();
    expect(capped.deadCount).toBe(1);
  });
});

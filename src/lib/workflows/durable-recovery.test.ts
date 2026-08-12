import { describe, expect, it, vi } from "vitest";

import { recoverDurableWorkflows } from "@/lib/workflows/durable-recovery";

const TAKEOFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INTAKE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STORAGE_CLEANUP_RESULT = {
  claimed: 1,
  removed: 1,
  failed: 0,
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
    const drainStorageCleanup = vi
      .fn()
      .mockResolvedValue(STORAGE_CLEANUP_RESULT);

    const result = await recoverDurableWorkflows({
      client,
      triggerTakeoff,
      processIntake,
      drainStorageCleanup,
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    });

    expect(triggerTakeoff).toHaveBeenCalledWith({
      jobId: TAKEOFF_ID,
      trigger: "retry",
    });
    expect(processIntake).toHaveBeenCalledWith(INTAKE_ID);
    expect(drainStorageCleanup).toHaveBeenCalledWith({
      client: undefined,
      limit: 25,
    });
    expect(result).toEqual({
      recoveredUnknownTakeoffJobs: 1,
      dueCount: 2,
      dispatchedCount: 2,
      failedCount: 0,
      skippedCount: 0,
      failures: [],
      procurementStorageCleanup: STORAGE_CLEANUP_RESULT,
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
    const drainStorageCleanup = vi
      .fn()
      .mockResolvedValue(STORAGE_CLEANUP_RESULT);

    const result = await recoverDurableWorkflows({
      client,
      triggerTakeoff,
      processIntake,
      drainStorageCleanup,
      maxIntakePerRun: 0,
    });

    expect(processIntake).not.toHaveBeenCalled();
    expect(result.dispatchedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });
});

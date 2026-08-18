import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({ rpc: rpcMock })),
}));

import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";

describe("persistTakeoffDispatchOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the exact trigger outcome and correlation", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          dispatch_status: "trigger_failed",
          dispatch_updated_at: "2026-08-13T20:30:00.000Z",
        },
      ],
      error: null,
    });

    await expect(
      persistTakeoffDispatchOutcome({
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        trigger: "retry",
        result: {
          triggered: false,
          correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          statusCode: 503,
          outcome: "http_error",
        },
      })
    ).resolves.toBe(true);

    expect(rpcMock).toHaveBeenCalledWith("record_takeoff_dispatch_outcome", {
      p_job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p_trigger: "retry",
      p_correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      p_outcome: "http_error",
      p_status_code: 503,
    });
  });

  it("keeps the launch response honest when persistence is unavailable", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: { message: "RPC missing" } });

    await expect(
      persistTakeoffDispatchOutcome({
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        trigger: "create",
        result: {
          triggered: false,
          correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          statusCode: null,
          outcome: "timeout",
        },
      })
    ).resolves.toBe(false);

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

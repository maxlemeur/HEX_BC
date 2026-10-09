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

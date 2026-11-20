import { afterEach, expect, it, vi } from "vitest";

const { client, processAttempt } = vi.hoisted(() => ({ client: { from: vi.fn() }, processAttempt: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ isLocalChatGptEnabled: () => true }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: async () => "fixture-host" }));
vi.mock("@/lib/supabase/service-role", () => ({ createOptionalServiceRoleClient: () => client }));
vi.mock("@/lib/takeoff/async-worker", () => ({ processTakeoffJobAttempt: processAttempt }));

import { startLocalTakeoffRetryRecovery } from "@/lib/takeoff/local-retry-recovery";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("reaches an accepted pending job beyond a page of due retries whose claims all fail", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "0");
  const jobs = ["1", "2", "3", "4", "5", "6"].map((id) => ({ id, status: id === "6" ? "pending" : "failed" }));
  client.from.mockImplementation(() => {
    let after = "";
    let wanted: string | undefined;
    let limit = jobs.length;
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { if (column === "status") wanted = value; return query; },
      is: () => query,
      or: () => query,
      gt: (column: string, value: string) => { if (column === "id") after = value; return query; },
      lt: () => query,
      lte: () => query,
      order: () => query,
      limit: (value: number) => { limit = value; return query; },
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null,
        data: jobs.filter(({ id, status }) => id > after && (!wanted || wanted === status)).slice(0, limit),
      }),
    };
    return query;
  });
  processAttempt.mockResolvedValue({ status: "in_progress" });
  startLocalTakeoffRetryRecovery();
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.waitFor(() => expect(processAttempt.mock.calls.map(([id]) => id)).toContain("6"));
  expect(processAttempt.mock.calls.filter(([id]) => id === "6")).toEqual([["6", expect.objectContaining({ trigger: "create" })]]);
});

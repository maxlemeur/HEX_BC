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
  const jobs = ["1", "2", "3", "4", "5", "6"].map((id) => ({ id, tenant_id: "t", status: id === "6" ? "pending" : "failed" }));
  client.from.mockImplementation((table: string) => {
    if (table === "audit_logs") {
      // Job 6 was admitted: its creation record is written.
      const receipts = { select: () => receipts, eq: () => receipts, in: () => receipts,
        then: (resolve: (value: unknown) => unknown) => resolve({ error: null, data: [{ tenant_id: "t", record_id: "6" }] }) };
      return receipts;
    }
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

it("takes an accepted pending job only once its creation record is written", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "0");
  processAttempt.mockReset();
  const job = { id: "8f400000-0000-4000-8000-000000000031", tenant_id: "8f400000-0000-4000-8000-000000000010", status: "pending" };
  const receipts: Array<{ tenant_id: string; record_id: string; table_name: string; action: string }> = [];
  client.from.mockImplementation((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const rows = () => (table === "audit_logs" ? receipts : [job]) as Array<Record<string, unknown>>;
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        if (table === "audit_logs") filters.push((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query; },
      is: () => query,
      or: () => query,
      gt: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null,
        data: rows().filter((row) => filters.every((filter) => filter(row))) }),
    };
    return query;
  });
  processAttempt.mockResolvedValue({ status: "in_progress" });
  startLocalTakeoffRetryRecovery();
  // The creation committed the row; its mandatory creation audit is still outstanding.
  await vi.advanceTimersByTimeAsync(30_000);
  expect(processAttempt).not.toHaveBeenCalled();
  receipts.push({ tenant_id: job.tenant_id, record_id: job.id, table_name: "takeoff_jobs", action: "takeoff.job.created" });
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(() => expect(processAttempt).toHaveBeenCalledWith(job.id, expect.objectContaining({ trigger: "create" })));
});

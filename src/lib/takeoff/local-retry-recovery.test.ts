import { afterEach, expect, it, vi } from "vitest";

const { client, processAttempt } = vi.hoisted(() => ({
  client: { from: vi.fn(), rpc: vi.fn<(name: string, args?: unknown) => Promise<{ data: null; error: null }>>(
    async () => ({ data: null, error: null })) },
  processAttempt: vi.fn(),
}));
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
  const createdAt = "2026-11-21T00:00:00.000001+00:00";
  const jobs = ["1", "2", "3", "4", "5", "6"].map((id) => ({ id, tenant_id: "t", status: id === "6" ? "pending" : "failed",
    created_at: createdAt }));
  client.from.mockImplementation((table: string) => {
    if (table === "audit_logs") {
      // Job 6 was admitted: its creation record is written.
      const receipts = { select: () => receipts, eq: () => receipts, in: () => receipts, gte: () => receipts,
        then: (resolve: (value: unknown) => unknown) => resolve({ error: null,
          data: [{ tenant_id: "t", record_id: "6", created_at: createdAt }] }) };
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
  const job = { id: "8f400000-0000-4000-8000-000000000031", tenant_id: "8f400000-0000-4000-8000-000000000010", status: "pending",
    created_at: "2026-11-21T00:00:00+00:00" };
  const receipts: Array<{ tenant_id: string; record_id: string; table_name: string; action: string; created_at: string }> = [];
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
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return query; },
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
  receipts.push({ tenant_id: job.tenant_id, record_id: job.id, table_name: "takeoff_jobs", action: "takeoff.job.created",
    created_at: "2026-11-21T00:00:00.4+00:00" });
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(() => expect(processAttempt).toHaveBeenCalledWith(job.id, expect.objectContaining({ trigger: "create" })));
});

it("does not take a job on the creation record of an earlier attempt that reused its identifier", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "0");
  processAttempt.mockReset();
  // A first creation committed its record, lost its answer and withdrew its row; the retry of the same preparation
  // inserted the same identifier again, and its own record is still outstanding.
  const job = { id: "8f400000-0000-4000-8000-000000000032", tenant_id: "8f400000-0000-4000-8000-000000000010",
    status: "pending", created_at: "2026-11-21T00:10:00.000250+00:00" };
  const receipts = [{ tenant_id: job.tenant_id, record_id: job.id, table_name: "takeoff_jobs", action: "takeoff.job.created",
    created_at: "2026-11-21T00:10:00.000120+00:00" }];
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
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return query; },
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
  await vi.advanceTimersByTimeAsync(30_000);
  expect(processAttempt).not.toHaveBeenCalled();
  // This creation's own record: written with or after its row.
  receipts.push({ ...receipts[0], created_at: job.created_at });
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(() => expect(processAttempt).toHaveBeenCalledWith(job.id, expect.objectContaining({ trigger: "create" })));
});

it("records this Mac's sign of life on a timer of its own, also while a long analysis holds the poll", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "0");
  processAttempt.mockReset();
  client.rpc.mockClear();
  const job = { id: "8f400000-0000-4000-8000-000000000033", tenant_id: "8f400000-0000-4000-8000-000000000010",
    status: "failed", created_at: "2026-11-21T00:00:00+00:00" };
  client.from.mockImplementation(() => {
    const query = {
      select: () => query, eq: () => query, in: () => query, gte: () => query, is: () => query, or: () => query,
      gt: () => query, order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null, data: [job] }),
    };
    return query;
  });
  // The analysis this poll starts lasts longer than the test: the poll stays busy with it.
  processAttempt.mockReturnValue(new Promise(() => undefined));
  const signs = () => client.rpc.mock.calls.filter(([name]) => name === "record_local_takeoff_host_activity");
  startLocalTakeoffRetryRecovery();
  await vi.advanceTimersByTimeAsync(0);
  expect(signs()).toEqual([["record_local_takeoff_host_activity", { p_host_id: "fixture-host" }]]);
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(() => expect(processAttempt).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(180_000);
  expect(processAttempt).toHaveBeenCalledTimes(1);
  // One sign at start, then one a minute: the hosted recovery reads this Mac as live while it works.
  expect(signs()).toHaveLength(4);
});

it("records no sign of life for a process whose workers are blocked", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "1");
  client.rpc.mockClear();
  startLocalTakeoffRetryRecovery();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(client.rpc).not.toHaveBeenCalled();
});

// Lot 3: withdrawing one analysis per plan keeps one plan at a time for the plans already admitted: the poller still hands
// them to the dispatcher (their slot), and its own path leaves them alone.
it("still runs the dispatcher for the plans already admitted after a withdrawal, and leaves them to it", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "0");
  processAttempt.mockReset();
  const createdAt = "2026-11-21T00:00:00+00:00";
  const plan = { id: "8f400000-0000-4000-8000-000000000041", tenant_id: "t", status: "pending", created_at: createdAt,
    launch_unit_key: "plan:8f400000-0000-4000-8000-000000000051" };
  const standalone = { id: "8f400000-0000-4000-8000-000000000042", tenant_id: "t", status: "pending", created_at: createdAt,
    launch_unit_key: null };
  let handed = false;
  client.rpc.mockImplementation((async (name: string) => {
    if (name === "takeoff_plan_dispatch_is_active") return { data: false, error: null };
    if (name === "dispatch_next_takeoff_host_job") {
      const next = handed ? [] : [{ job_id: plan.id, trigger_kind: "create", next_due_at: null, closed_jobs: [] }];
      handed = true;
      return { data: next, error: null };
    }
    return { data: null, error: null };
  }) as never);
  client.from.mockImplementation((table: string) => {
    const rows = table === "audit_logs" ? [plan, standalone].map((job) => ({ tenant_id: "t", record_id: job.id, created_at: createdAt }))
      : [plan, standalone];
    const query = {
      select: () => query, eq: () => query, in: () => query, gte: () => query, is: () => query, or: () => query,
      gt: () => query, order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null, data: rows }),
    };
    return query;
  });
  processAttempt.mockResolvedValue({ status: "succeeded" });
  startLocalTakeoffRetryRecovery();
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.waitFor(() => expect(processAttempt.mock.calls.map(([id]) => id)).toContain(standalone.id));
  expect(processAttempt.mock.calls.filter(([id]) => id === plan.id)).toHaveLength(1);
  expect(client.rpc.mock.calls.some(([name]) => name === "dispatch_next_takeoff_host_job")).toBe(true);
});

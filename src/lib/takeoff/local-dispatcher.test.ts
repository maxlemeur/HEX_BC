import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, processAttempt } = vi.hoisted(() => ({ rpc: vi.fn(), processAttempt: vi.fn() }));
vi.mock("@/lib/takeoff/async-worker", () => ({ processTakeoffJobAttempt: processAttempt }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: async () => "urn:uuid:00000000-0000-4000-8000-000000000099" }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ takeoffModuleDefault: () => false }));

import { isTakeoffPlanDispatchActive, runLocalTakeoffDispatcherPass } from "@/lib/takeoff/local-dispatcher";

// The database decides the order and the Mac's slot (takeoff-plan-dispatcher.test.sql); a pass runs one attempt per job
// it is handed, until the Mac is busy or nothing is due, then waits for the next retry due.
type Handed = { job_id: string | null; trigger_kind?: string | null; next_due_at?: string | null; closed_jobs?: string[] };
const hostId = "urn:uuid:00000000-0000-4000-8000-000000000099";
const queue: Handed[] = [];
const keyQueue: Handed[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  queue.length = 0;
  keyQueue.length = 0;
  rpc.mockImplementation(async (name: string, args?: { p_host_id: string }) => {
    if (name === "takeoff_plan_dispatch_is_active") return { data: true, error: null };
    expect(name).toBe(args?.p_host_id === hostId ? "dispatch_next_takeoff_host_job" : "dispatch_next_takeoff_payment_job");
    return { data: [(args?.p_host_id === hostId ? queue : keyQueue).shift() ?? { job_id: null, trigger_kind: null, next_due_at: null, closed_jobs: [] }], error: null };
  });
});
afterEach(() => vi.useRealTimers());

const done = { status: "completed" } as never;

describe("runLocalTakeoffDispatcherPass", () => {
  it("runs one attempt of each job the database hands, in its order, until nothing is handed", async () => {
    queue.push({ job_id: "a", trigger_kind: "create" }, { job_id: "b", trigger_kind: "retry", closed_jobs: ["c"] });
    const attempt = vi.fn(async () => done);
    const pass = await runLocalTakeoffDispatcherPass({ attempt });
    expect(attempt.mock.calls).toEqual([["a", "create"], ["b", "retry"]]);
    expect(pass).toEqual({ ran: ["a", "b"], closed: ["c"], nextDueAt: null });
    expect(rpc).toHaveBeenCalledWith("dispatch_next_takeoff_host_job",
      { p_host_id: "urn:uuid:00000000-0000-4000-8000-000000000099", p_module_default: false });
  });

  it("stops when the job it is handed again could not be claimed (another process holds the Mac)", async () => {
    queue.push({ job_id: "a", trigger_kind: "create" }, { job_id: "a", trigger_kind: "create" }, { job_id: "a", trigger_kind: "create" });
    const attempt = vi.fn(async () => ({ status: "in_progress" }) as never);
    await runLocalTakeoffDispatcherPass({ attempt });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("runs one pass at a time in this process: a pass asked meanwhile makes the running one go round again", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    queue.push({ job_id: "a", trigger_kind: "create" });
    const attempt = vi.fn(async () => { await held; return done; });
    const first = runLocalTakeoffDispatcherPass({ attempt });
    await vi.waitFor(() => expect(attempt).toHaveBeenCalledTimes(1));
    queue.push({ job_id: "b", trigger_kind: "create" });
    const second = runLocalTakeoffDispatcherPass({ attempt });
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one).toBe(two);
    expect(one.ran).toEqual(["a", "b"]);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("wakes itself for the next retry due", async () => {
    vi.useFakeTimers();
    const due = new Date(Date.now() + 45_000).toISOString();
    queue.push({ job_id: null, next_due_at: due });
    const attempt = vi.fn(async () => done);
    await runLocalTakeoffDispatcherPass({ attempt });
    expect(rpc).toHaveBeenCalledTimes(2);
    queue.push({ job_id: "late", trigger_kind: "retry" });
    processAttempt.mockResolvedValue({ status: "completed" });
    await vi.advanceTimersByTimeAsync(46_000);
    // The pass the timer starts runs the worker's own attempt.
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(5));
    expect(processAttempt).toHaveBeenCalledWith("late", expect.objectContaining({ trigger: "retry" }));
  });

  it("drains the API queue on the same Mac", async () => {
    queue.push({ job_id: "subscription" });
    keyQueue.push({ job_id: "personal-key" });
    const attempt = vi.fn(async () => done);
    await expect(runLocalTakeoffDispatcherPass({ attempt })).resolves.toMatchObject({ ran: ["subscription", "personal-key"] });
    expect(attempt.mock.calls).toEqual([["subscription", "create"], ["personal-key", "create"]]);
  });

  it("reads the activation from the database", async () => {
    await expect(isTakeoffPlanDispatchActive()).resolves.toBe(true);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "unreachable" } });
    await expect(isTakeoffPlanDispatchActive()).rejects.toMatchObject({ message: "unreachable" });
  });
});

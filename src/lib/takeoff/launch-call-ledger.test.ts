import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createTakeoffCallLedger, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ takeoffModuleDefault: vi.fn(() => false) }));

// The database decides each reservation (takeoff-plan-dispatcher.test.sql); the ledger names each call of an attempt,
// reads the lease at each call, waits for a call of its attempt in flight before a reservation is refused, and stops the
// job on a refusal: nothing is sent then.
const answers: Array<{ data?: unknown; error?: { code?: string; message: string } | null }> = [];
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(
  async () => answers.shift() ?? { data: [{ outcome: "reserved", reason: null }], error: null });
beforeEach(() => {
  vi.clearAllMocks();
  answers.length = 0;
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);
});
const reserved = { data: [{ outcome: "reserved", reason: null }], error: null };

describe("createTakeoffCallLedger", () => {
  it("reserves each call under the lease the worker holds at that call, then settles it with its key", async () => {
    // The provider is resolved before the claim: its row carries an earlier lease, the ledger reads the current one.
    let lease: string | null = "lease-of-the-claim";
    const ledger = createTakeoffCallLedger({ id: "job", launch_request_id: "request" }, () => lease);
    const first = await ledger.beforePaidCall("pdf");
    await ledger.recordPaidUsage(first, { totalTokens: 42, costCents: 0 });
    lease = "lease-after-a-new-claim";
    const second = await ledger.beforePaidCall("vector_group");
    await ledger.recordUnknownUsage(second);
    expect(rpc.mock.calls).toEqual([
      ["reserve_takeoff_launch_call", { p_job_id: "job", p_lease_token: "lease-of-the-claim", p_call_key: "call:1", p_branch: "pdf",
        p_estimate_tokens: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, p_module_default: false }],
      ["record_takeoff_launch_usage", { p_job_id: "job", p_lease_token: "lease-of-the-claim", p_call_key: "call:1", p_tokens: 42, p_cost_cents: 0 }],
      ["reserve_takeoff_launch_call", { p_job_id: "job", p_lease_token: "lease-after-a-new-claim", p_call_key: "call:2",
        p_branch: "vector_group", p_estimate_tokens: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, p_module_default: false }],
      ["record_takeoff_launch_call_unknown", { p_job_id: "job", p_lease_token: "lease-after-a-new-claim", p_call_key: "call:2" }],
    ]);
  });

  it("lets a job without a request pay without a reservation, and records nothing for it", async () => {
    answers.push({ data: [{ outcome: "unbudgeted", reason: null }], error: null });
    const ledger = createTakeoffCallLedger({ id: "job", launch_request_id: null }, () => "lease");
    const call = await ledger.beforePaidCall("pdf");
    expect(call).toBeNull();
    await ledger.recordPaidUsage(call, { totalTokens: 42, costCents: 0 });
    await ledger.recordUnknownUsage(call);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("waits for a call of its attempt in flight when only that call holds the balance, then reserves", async () => {
    const ledger = createTakeoffCallLedger({ id: "job", launch_request_id: "request" }, () => "lease");
    // The database's answers in turn: the first call reserved, the second waits, the first is settled, the second reserved.
    answers.push(reserved, { data: [{ outcome: "wait", reason: null }], error: null },
      { data: [{ remaining_tokens: 1, remaining_cost_cents: 1 }], error: null }, reserved);
    const first = await ledger.beforePaidCall("vector_group");
    let second: unknown = "pending";
    const waiting = ledger.beforePaidCall("vector_group").then((call) => { second = call; });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(second).toBe("pending");
    await ledger.recordPaidUsage(first, { totalTokens: 10, costCents: 0 });
    await waiting;
    expect(second).toEqual({ key: "call:2" });
    expect(rpc.mock.calls.map(([name, args]) => [name, args.p_call_key])).toEqual([
      ["reserve_takeoff_launch_call", "call:1"], ["reserve_takeoff_launch_call", "call:2"],
      ["record_takeoff_launch_usage", "call:1"], ["reserve_takeoff_launch_call", "call:2"],
    ]);
  });

  it.each([
    ["the unit's share is spent", "BUDGET_EXHAUSTED", "TAKEOFF_REQUEST_BUDGET_EXHAUSTED"],
    ["the payer may no longer launch on the affaire", "PAYER_NOT_ELIGIBLE", "FORBIDDEN"],
    ["the module was turned off", "TAKEOFF_DISABLED", "FORBIDDEN"],
  ])("refuses the call when %s: nothing is sent", async (_case, reason, code) => {
    answers.push({ data: [{ outcome: "refused", reason }], error: null });
    const ledger = createTakeoffCallLedger({ id: "job", launch_request_id: "request" }, () => "lease");
    await expect(ledger.beforePaidCall("pdf")).rejects.toMatchObject({ code, retryable: false });
  });

  it("refuses a wait with no call of its own in flight: an attempt never waits for a call it does not hold", async () => {
    answers.push({ data: [{ outcome: "wait", reason: null }], error: null });
    const ledger = createTakeoffCallLedger({ id: "job", launch_request_id: "request" }, () => "lease");
    await expect(ledger.beforePaidCall("pdf")).rejects.toMatchObject({ code: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED" });
  });

  it("stops a process whose lease was taken over, and the job when a usage cannot be recorded", async () => {
    answers.push({ data: null, error: { code: "42501", message: "TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED" } });
    const ledger = createTakeoffCallLedger({ id: "job", launch_request_id: "request" }, () => "lease");
    await expect(ledger.beforePaidCall("pdf")).rejects.toMatchObject({ code: "CONFLICT", retryable: false });
    const call = await ledger.beforePaidCall("pdf");
    answers.push({ data: null, error: { code: "42501", message: "TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED" } });
    await expect(ledger.recordPaidUsage(call, { totalTokens: 1, costCents: 0 })).rejects.toMatchObject({ code: "TAKEOFF_USAGE_UNRECORDED" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveTakeoffExecutionProvider } from "@/lib/takeoff/execution-scope-server";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ takeoffModuleDefault: vi.fn(() => false) }));

// Before each paid call of every job (a launch on a version included): the database's one answer (module, the payer
// rule, the request's budget). A member demoted after queuing an analysis, an affaire archived, the module turned off
// or a spent budget stops the next call; nothing is paid.
const call = vi.fn();
const provider = { model: "modele", selection: { profileId: "p", model: "modele", reasoningEffort: null }, call,
  assertOwnerActive: vi.fn() };
const job = (estimateVersionId: string | null) => ({ id: "job", tenant_id: "tenant", project_id: "affaire", created_by: "membre",
  estimate_version_id: estimateVersionId }) as unknown as TakeoffJobProcessingRow;
const answers: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  answers.length = 0;
  call.mockResolvedValue({ data: { quantity: 1 } });
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    expect(fn).toBe("takeoff_job_may_pay");
    expect(args).toEqual({ p_job_id: "job", p_module_default: false });
    return { data: [{ reason: answers.shift() ?? null, remaining_tokens: null, remaining_cost_cents: null }], error: null };
  }) } as never);
});

describe("resolveTakeoffExecutionProvider", () => {
  // The check is the provider's `beforePaidCall`: every paid call runs it once its credential is in hand, immediately
  // before the request is sent (chatgpt-local-inference.test.ts).
  const resolveWithHooks = () => {
    const seen: { hooks?: { lease?: () => string | null; beforePaidCall?: () => Promise<void> } } = {};
    const resolve = vi.fn(async (_supabase: unknown, _job: unknown, hooks?: typeof seen.hooks) => {
      seen.hooks = hooks;
      return provider as never;
    });
    return { resolve, seen };
  };

  it.each([
    ["the creator may no longer launch on the affaire", "PAYER_NOT_ELIGIBLE", "FORBIDDEN", "n’est plus autorisé"],
    ["the takeoff module was turned off", "TAKEOFF_DISABLED", "FORBIDDEN", "module Takeoff est désactivé"],
    ["the request's budget is spent", "BUDGET_EXHAUSTED", "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", "budget de cette analyse est épuisé"],
  ])("gives every paid call the check that stops it when %s, for a job on a version too", async (_case, reason, code, message) => {
    const { resolve, seen } = resolveWithHooks();
    await resolveTakeoffExecutionProvider({} as never, job("version"), resolve as never);
    await expect(seen.hooks?.beforePaidCall?.()).resolves.toBeUndefined();
    answers.push(reason);
    await expect(seen.hooks?.beforePaidCall?.()).rejects.toMatchObject({ code, retryable: false, message: expect.stringContaining(message) });
  });

  it("checks once before the provider is resolved: a job that may not pay never reads its creator's subscription", async () => {
    const { resolve } = resolveWithHooks();
    answers.push("PAYER_NOT_ELIGIBLE");
    await expect(resolveTakeoffExecutionProvider({} as never, job(null), resolve as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("hands the provider the lease the processor reads at each paid call", async () => {
    const { resolve, seen } = resolveWithHooks();
    const lease = () => "lease-of-the-claim";
    await resolveTakeoffExecutionProvider({} as never, job(null), resolve as never, lease);
    expect(seen.hooks?.lease).toBe(lease);
  });
});

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
  it.each([
    ["the creator may no longer launch on the affaire", "PAYER_NOT_ELIGIBLE", "FORBIDDEN", "n’est plus autorisé"],
    ["the takeoff module was turned off", "TAKEOFF_DISABLED", "FORBIDDEN", "module Takeoff est désactivé"],
    ["the request's budget is spent", "BUDGET_EXHAUSTED", "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", "budget de cette analyse est épuisé"],
  ])("stops before the next paid call when %s, for a job on a version too", async (_case, reason, code, message) => {
    const scoped = await resolveTakeoffExecutionProvider({} as never, job("version"), async () => provider as never);
    await expect(scoped.call({ prompt: "Lire", schema: {} as never })).resolves.toEqual({ data: { quantity: 1 } });
    answers.push(reason);
    await expect(scoped.call({ prompt: "Lire", schema: {} as never })).rejects.toMatchObject({ code, retryable: false,
      message: expect.stringContaining(message) });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("checks before the vector requests too (their own check runs through assertOwnerActive)", async () => {
    const scoped = await resolveTakeoffExecutionProvider({} as never, job(null), async () => provider as never);
    answers.push("PAYER_NOT_ELIGIBLE");
    await expect(scoped.assertOwnerActive()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(provider.assertOwnerActive).not.toHaveBeenCalled();
  });
});

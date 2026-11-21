import { describe, expect, it, vi } from "vitest";

import { boundTakeoffAttemptByRequest } from "@/lib/takeoff/launch-request-budget";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

// The budget of a launch request (migration 20261121111238_takeoff_launch_requests.sql): sealed at its admission, it
// bounds every paid attempt of its jobs with what their earlier attempts consumed (a retry never starts from zero).
const config = { maxPdfPages: 200, maxTotalTokens: 400_000, maxCostCents: 2_500 };
const JOB = "aaaaaaaa-0000-4000-8000-000000000080";

describe("boundTakeoffAttemptByRequest", () => {
  it("leaves an analysis without a request to its per-job budget", () => {
    expect(boundTakeoffAttemptByRequest(config, null, JOB)).toEqual(config);
  });

  it("gives an attempt only what its request has left", () => {
    expect(boundTakeoffAttemptByRequest(config, { tokenBudget: 400_000, costBudgetCents: 2_500, tokensObserved: 350_000,
      costCentsObserved: 100 }, JOB)).toEqual({ maxPdfPages: 200, maxTotalTokens: 50_000, maxCostCents: 2_400 });
  });

  it.each([
    ["its tokens", { tokensObserved: 400_000, costCentsObserved: 0 }],
    ["its cost", { tokensObserved: 10, costCentsObserved: 2_500 }],
  ])("stops the attempt before any call once the request spent %s", (_case, observed) => {
    expect(() => boundTakeoffAttemptByRequest(config, { tokenBudget: 400_000, costBudgetCents: 2_500, ...observed }, JOB))
      .toThrow(expect.objectContaining({ code: TakeoffErrorCode.TAKEOFF_REQUEST_BUDGET_EXHAUSTED, retryable: false }));
  });
});

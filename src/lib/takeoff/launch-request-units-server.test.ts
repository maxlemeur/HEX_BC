import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readTakeoffLaunchRequestUnits, toTakeoffLaunchRequestUnits } from "@/lib/takeoff/launch-request-units-server";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));

// The database decides each unit's state (takeoff-plan-dispatcher.test.sql, read_takeoff_launch_request_units); the reader
// checks the affaire's access first, words a grouped analysis, and never invents a state it does not know.
const context = { tenantId: "tenant", userId: "membre", supabase: {} } as never;
const unit = (ordinal: number, state: string, extra: Record<string, unknown> = {}) => ({
  key: `plan:${ordinal}`, ordinal, plan_file_id: `plan-${ordinal}`, logical_id: `piece-${ordinal}`, name: `Plan ${ordinal}.pdf`,
  pages: [2, 7], job_id: `job-${ordinal}`, state, reason_code: null, retry_at: null, updated_at: "2026-11-21T10:00:00Z", ...extra,
});
const usage = { tokens_observed: 120000, cost_cents_observed: 0, unknown_calls: 1 };
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);
});

describe("readTakeoffLaunchRequestUnits", () => {
  it("checks the reader's access to the affaire, then reads the request of that affaire only", async () => {
    rpc.mockResolvedValue({ data: { request_id: "request", format: "per_plan", plans: 3,
      units: [unit(1, "succeeded"), unit(2, "running"), unit(3, "queued", { retry_at: "2026-11-21T10:01:00Z" })], usage }, error: null });
    const read = await readTakeoffLaunchRequestUnits(context, "affaire", "request");
    expect(assertPreparationProjectAccess).toHaveBeenCalledWith(context, "affaire");
    expect(rpc).toHaveBeenCalledWith("read_takeoff_launch_request_units", { p_tenant_id: "tenant", p_project_id: "affaire", p_request_id: "request" });
    expect(read.coverage).toEqual({ expected: 3, queued: 1, running: 1, succeeded: 1, failed: 0, canceled: 0, not_started: 0 });
    expect(read.units.map((entry) => [entry.ordinal, entry.state, entry.reviewable, entry.retryAt])).toEqual([
      [1, "succeeded", true, null], [2, "running", false, null], [3, "queued", false, "2026-11-21T10:01:00Z"]]);
    expect(read.usage).toEqual({ tokensObserved: 120000, costCentsObserved: 0, unknownCalls: 1 });
  });

  it("answers « introuvable » for a request of another affaire", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(readTakeoffLaunchRequestUnits(context, "affaire", "request")).rejects.toMatchObject({ status: 404,
      message: "Ce métré est introuvable sur cette affaire." });
  });

  it("refuses before reading anything when the reader may not read the affaire", async () => {
    vi.mocked(assertPreparationProjectAccess).mockRejectedValueOnce(new Error("Accès refusé"));
    await expect(readTakeoffLaunchRequestUnits(context, "affaire", "request")).rejects.toThrow("Accès refusé");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("toTakeoffLaunchRequestUnits", () => {
  it("names a grouped analysis after its plans, and leaves out a state it does not know", () => {
    const read = toTakeoffLaunchRequestUnits({ request_id: "request", format: "grouped", plans: 4, usage,
      units: [{ ...unit(1, "failed", { reason_code: "TAKEOFF_PDF_CORRUPTED" }), key: null, plan_file_id: null, name: null, pages: [] },
        unit(2, "a_state_of_tomorrow")] });
    expect(read.units).toEqual([expect.objectContaining({ key: "grouped", name: "Analyse groupée de 4 plans", state: "failed",
      reasonCode: "TAKEOFF_PDF_CORRUPTED", reviewable: false })]);
    expect(read.coverage.expected).toBe(1);
  });
});

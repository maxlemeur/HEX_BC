import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/item-bulk-server", () => ({ bulkUpdateEstimateItems: vi.fn() }));
vi.mock("@/lib/takeoff/job-read-server", () => ({
  getAuthenticatedTakeoffContext: vi.fn(),
  getTakeoffJobDetailByIdOrThrow: vi.fn(),
  normalizeTakeoffJobSummaryRow: vi.fn((row) => row),
}));
vi.mock("@/lib/takeoff/mapping-preview-server", () => ({ buildTakeoffMappingPreviewForJob: vi.fn() }));
vi.mock("@/lib/takeoff/apply-repository", () => ({
  invokeApplyTakeoffRpc: vi.fn(),
  issueTakeoffDpgfApplyAuthorization: vi.fn(),
  listTakeoffApplyGuardItems: vi.fn(),
  loadTakeoffApplyConcurrencyToken: vi.fn(),
  logTakeoffMappingApplyAuditEvents: vi.fn(),
  revokeTakeoffDpgfApplyAuthorization: vi.fn(),
}));
vi.mock("@/lib/takeoff/dpgf-comparison-repository", () => ({ hasTakeoffDpgfTargetLines: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-context-server", () => ({ loadTakeoffDpgfComparisonContext: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-server", () => ({ fetchDpgfTakeoffComparisonForContext: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ getTakeoffLowConfidenceThresholdForTenant: vi.fn() }));
vi.mock("@/lib/takeoff/audit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/audit")>(),
  logTakeoffAuditEvent: vi.fn(),
}));

import { bulkUpdateEstimateItems } from "@/lib/estimates/item-bulk-server";
import { applyTakeoffJob } from "@/lib/takeoff/apply-server";
import * as repository from "@/lib/takeoff/apply-repository";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow } from "@/lib/takeoff/job-read-server";
import { hasTakeoffDpgfTargetLines } from "@/lib/takeoff/dpgf-comparison-repository";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchDpgfTakeoffComparisonForContext } from "@/lib/takeoff/dpgf-comparison-server";
import { getTakeoffLowConfidenceThresholdForTenant } from "@/lib/takeoff/feature-flags";
import { logTakeoffAuditEvent } from "@/lib/takeoff/audit";
import { buildTakeoffDpgfComparisonSummary } from "@/lib/takeoff/dpgf-compare";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-10-28T10:00:00.000Z";
const auth = { supabase: {}, tenantId: TENANT_ID, userId: USER_ID, tenantRole: "admin" };
const request = { strategy: "merge", target_section_id: SECTION_ID };
const completedJob = { id: JOB_ID, estimate_version_id: VERSION_ID, status: "completed", level: "A" };
const summary = buildTakeoffDpgfComparisonSummary({ rows: [], unusedTakeoffItems: [] });

function calledBefore(first: { mock: { invocationCallOrder: number[] } }, second: { mock: { invocationCallOrder: number[] } }) {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(auth as never);
  vi.mocked(getTakeoffJobDetailByIdOrThrow)
    .mockResolvedValueOnce(completedJob as never)
    .mockResolvedValue({ ...completedJob, status: "applied" } as never);
  vi.mocked(buildTakeoffMappingPreviewForJob).mockResolvedValue({
    job_id: JOB_ID,
    strategy: "merge",
    target_section_id: SECTION_ID,
    summary: { included_count: 1 },
    items: [],
  } as never);
  vi.mocked(hasTakeoffDpgfTargetLines).mockResolvedValue(true);
  vi.mocked(repository.loadTakeoffApplyConcurrencyToken).mockResolvedValue(TOKEN);
  vi.mocked(loadTakeoffDpgfComparisonContext).mockResolvedValue({ jobId: JOB_ID } as never);
  vi.mocked(fetchDpgfTakeoffComparisonForContext).mockResolvedValue({ summary } as never);
  vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mockImplementation(async (input) => input.authorizationToken);
  vi.mocked(repository.invokeApplyTakeoffRpc).mockResolvedValue({ data: { created_count: 1 }, error: null } as never);
});

describe("takeoff apply orchestration", () => {
  it("checks the draft before the global DPGF review, authorizes it, then invokes the atomic write", async () => {
    const response = await applyTakeoffJob(JOB_ID, request);

    expect(bulkUpdateEstimateItems).toHaveBeenCalledWith(VERSION_ID, [], TOKEN);
    expect(fetchDpgfTakeoffComparisonForContext).toHaveBeenCalledWith(
      { jobId: JOB_ID }, { version_id: VERSION_ID, page_size: 1, view: "all" }
    );
    calledBefore(vi.mocked(bulkUpdateEstimateItems), vi.mocked(fetchDpgfTakeoffComparisonForContext));
    calledBefore(vi.mocked(fetchDpgfTakeoffComparisonForContext), vi.mocked(repository.issueTakeoffDpgfApplyAuthorization));
    calledBefore(vi.mocked(repository.issueTakeoffDpgfApplyAuthorization), vi.mocked(repository.invokeApplyTakeoffRpc));
    const authorization = vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mock.calls[0][0];
    expect(authorization).toMatchObject({ tenantId: TENANT_ID, userId: USER_ID, jobId: JOB_ID, estimateVersionId: VERSION_ID, summary, nowMs: expect.any(Number) });
    expect(authorization.authorizationToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalledExactlyOnceWith({
      supabase: auth.supabase,
      args: { job_id: JOB_ID, strategy: "merge", target_section_id: SECTION_ID, mapping_plan: [], dpgf_authorization_token: authorization.authorizationToken },
    });
    expect(response.summary.created_count).toBe(1);
    expect(getTakeoffJobDetailByIdOrThrow).toHaveBeenCalledTimes(2);
    expect(repository.revokeTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
    expect(logTakeoffAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "takeoff.apply.completed" }));
  });

  it("does not review or authorize DPGF when draft authorization, lock or OCC fails", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockRejectedValue(new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, message: "Draft changed", retryable: false }));
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 409 });
    expect(fetchDpgfTakeoffComparisonForContext).not.toHaveBeenCalled();
    expect(repository.issueTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).not.toHaveBeenCalled();
    expect(logTakeoffAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "takeoff.apply.failed" }));
  });

  it("blocks the whole application when the global DPGF summary has unresolved exceptions", async () => {
    vi.mocked(fetchDpgfTakeoffComparisonForContext).mockResolvedValue({ summary: { ...summary, significant_gaps: 1 } } as never);
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 422, details: { guard: "dpgf_comparison" } });
    expect(repository.issueTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).not.toHaveBeenCalled();
  });

  it("revokes the issued authorization when the atomic RPC fails, retaining the named timeout", async () => {
    vi.mocked(repository.invokeApplyTakeoffRpc).mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement" } } as never);
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 503, retryable: true, details: { guard: "statement_timeout" } });
    const authorization = vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mock.calls[0][0];
    expect(repository.revokeTakeoffDpgfApplyAuthorization).toHaveBeenCalledExactlyOnceWith({ jobId: JOB_ID, authorizationToken: authorization.authorizationToken });
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalledTimes(1);
    expect(getTakeoffJobDetailByIdOrThrow).toHaveBeenCalledTimes(1);
  });

  it("fails before the RPC if the DPGF authorization cannot be persisted", async () => {
    vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mockRejectedValue(new Error("Authorization insert failed"));
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 500 });
    expect(repository.invokeApplyTakeoffRpc).not.toHaveBeenCalled();
    expect(repository.revokeTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
  });

  it("applies a job without DPGF without issuing a review authorization", async () => {
    vi.mocked(hasTakeoffDpgfTargetLines).mockResolvedValue(false);
    await applyTakeoffJob(JOB_ID, request);
    expect(fetchDpgfTakeoffComparisonForContext).not.toHaveBeenCalled();
    expect(repository.issueTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ dpgf_authorization_token: null }) }));
  });

  it("requires a reloaded applied status before reporting application completed", async () => {
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockReset().mockResolvedValue(completedJob as never);
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 500, details: { expected_status: "applied", current_status: "completed" } });
    expect(logTakeoffAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: "takeoff.apply.completed" }));
    expect(logTakeoffAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "takeoff.apply.failed" }));
  });

  it("blocks a replace at the root before job lookup or any write", async () => {
    await expect(applyTakeoffJob(JOB_ID, { strategy: "replace" })).rejects.toMatchObject({ status: 422, details: { guard: "root_replace_disabled" } });
    expect(getTakeoffJobDetailByIdOrThrow).not.toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).not.toHaveBeenCalled();
  });

  it("persists an admin override audit before any draft authorization or application", async () => {
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockReset()
      .mockResolvedValueOnce({ ...completedJob, level: "C" } as never)
      .mockResolvedValue({ ...completedJob, level: "C", status: "applied" } as never);
    vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.7);
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([{
      id: SECTION_ID, designation: "Canalisation", confidence: 0.6, evidence: "Plan A", source_page: 1, is_verified: false, is_excluded: false,
    }]);
    await applyTakeoffJob(JOB_ID, { ...request, override: true, override_justification: "  Contrôle manuel  " });
    expect(getTakeoffLowConfidenceThresholdForTenant).toHaveBeenCalledWith(TENANT_ID, { supabase: auth.supabase });
    expect(logTakeoffAuditEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "takeoff.apply.override", mode: "fail-hard",
      metadata: expect.objectContaining({ threshold: 0.7, justification: "Contrôle manuel", blocked_item_ids: [SECTION_ID] }),
    }));
    calledBefore(vi.mocked(logTakeoffAuditEvent), vi.mocked(bulkUpdateEstimateItems));
  });
});

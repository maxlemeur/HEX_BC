import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  invokeApplyTakeoffRpc,
  issueTakeoffDpgfApplyAuthorization,
  loadTakeoffApplyConcurrencyToken,
  revokeTakeoffDpgfApplyAuthorization,
} from "@/lib/takeoff/apply-repository";
import { hashTakeoffApplyAuthorizationToken } from "@/lib/takeoff/apply-preparation";
import { buildTakeoffDpgfComparisonSummary } from "@/lib/takeoff/dpgf-compare";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTHORIZATION = "55555555-5555-4555-8555-555555555555";
const summary = buildTakeoffDpgfComparisonSummary({ rows: [], unusedTakeoffItems: [] });

beforeEach(() => { vi.resetAllMocks(); });

describe("takeoff atomic apply repository", () => {
  it.each([null, AUTHORIZATION])("calls only the atomic RPC and omits absent authorization (%s)", async (token) => {
    const failure = { code: "PGRST202", message: "Missing function" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: failure });
    const result = await invokeApplyTakeoffRpc({
      supabase: { rpc } as never,
      args: { job_id: JOB_ID, strategy: "merge", target_section_id: null, mapping_plan: [], dpgf_authorization_token: token },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_takeoff_job_guarded_atomic", {
      p_job_id: JOB_ID, p_strategy: "merge", p_target_section_id: null, p_mapping_plan: [],
      ...(token ? { p_dpgf_authorization_token: token } : {}),
    });
    expect(result.error).toBe(failure);
  });

  it("persists a hashed, scoped five-minute review authorization before exposing its token", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);
    const token = await issueTakeoffDpgfApplyAuthorization({
      tenantId: TENANT_ID, userId: USER_ID, jobId: JOB_ID, estimateVersionId: VERSION_ID,
      summary, authorizationToken: AUTHORIZATION, nowMs: Date.parse("2026-10-28T10:00:00Z"),
    });
    expect(token).toBe(AUTHORIZATION);
    expect(from).toHaveBeenCalledExactlyOnceWith("takeoff_apply_authorizations");
    expect(insert).toHaveBeenCalledExactlyOnceWith({
      tenant_id: TENANT_ID, user_id: USER_ID, job_id: JOB_ID, estimate_version_id: VERSION_ID,
      authorization_token_hash: hashTakeoffApplyAuthorizationToken(AUTHORIZATION), review_summary: summary,
      expires_at: "2026-10-28T10:05:00.000Z",
    });
  });

  it("does not expose an authorization if its persistence is refused", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: () => ({ insert: async () => ({ error: { code: "42501", message: "permission denied" } }) }) } as never);
    await expect(issueTakeoffDpgfApplyAuthorization({
      tenantId: TENANT_ID, userId: USER_ID, jobId: JOB_ID, estimateVersionId: VERSION_ID,
      summary, authorizationToken: AUTHORIZATION, nowMs: 0,
    })).rejects.toMatchObject({ status: 403, retryable: false, jobId: JOB_ID });
  });

  it.each(["result", "throw"])("scopes cleanup to job and hash, preserving the original failure if cleanup fails (%s)", async (failureMode) => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secondEq = vi.fn().mockImplementation(async () => {
      if (failureMode === "throw") throw new Error("Network unavailable");
      return { error: { code: "42501" } };
    });
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
    const remove = vi.fn().mockReturnValue({ eq: firstEq });
    const from = vi.fn().mockReturnValue({ delete: remove });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);
    try {
      await expect(revokeTakeoffDpgfApplyAuthorization({ jobId: JOB_ID, authorizationToken: AUTHORIZATION })).resolves.toBeUndefined();
      expect(from).toHaveBeenCalledWith("takeoff_apply_authorizations");
      expect(firstEq).toHaveBeenCalledExactlyOnceWith("job_id", JOB_ID);
      expect(secondEq).toHaveBeenCalledExactlyOnceWith("authorization_token_hash", hashTakeoffApplyAuthorizationToken(AUTHORIZATION));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(AUTHORIZATION);
    } finally { warn.mockRestore(); }
  });

  it.each([
    { row: null, status: 404 },
    { row: { id: VERSION_ID, updated_at: null }, status: 500 },
  ])("rejects missing draft concurrency evidence ($status)", async ({ row, status }) => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const from = vi.fn().mockReturnValue(query);
    await expect(loadTakeoffApplyConcurrencyToken({ supabase: { from } as never, tenantId: TENANT_ID, estimateVersionId: VERSION_ID })).rejects.toMatchObject({ status });
    expect(from).toHaveBeenCalledWith("estimate_versions");
    expect(query.eq.mock.calls).toEqual([["tenant_id", TENANT_ID], ["id", VERSION_ID]]);
  });
});

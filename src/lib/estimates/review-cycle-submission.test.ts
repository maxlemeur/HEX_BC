import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";
const CYCLE_ID = "77777777-7777-4777-8777-777777777777";
const RULE_ID = "99999999-9999-4999-8999-999999999999";

function createRpcResult(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-08-12T09:00:00.000Z";
  return {
    created: true,
    cycle: {
      id: CYCLE_ID,
      created_at: timestamp,
      updated_at: timestamp,
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      cycle_number: 2,
      requested_by: ACTOR_ID,
      requested_at: timestamp,
      submission_message: "Verifier les hypotheses.",
      assigned_reviewer_id: REVIEWER_ID,
      decided_by: null,
      decision: null,
      decided_at: null,
      carried_over_from_cycle_id: null,
      requested_content_revision: 7,
      superseded_at: null,
      superseded_by: null,
      superseded_by_cycle_id: null,
    },
    approvals: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        created_at: timestamp,
        updated_at: timestamp,
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        rule_id: RULE_ID,
        requested_by: ACTOR_ID,
        approved_by: null,
        status: "pending",
        decided_at: null,
        approved_content_revision: null,
        review_cycle_id: CYCLE_ID,
        superseded_at: null,
      },
    ],
    ...overrides,
  };
}

const validInput = {
  versionId: VERSION_ID,
  tenantId: TENANT_ID,
  actorUserId: ACTOR_ID,
  assignedReviewerId: REVIEWER_ID,
  ruleIds: [RULE_ID],
  submissionMessage: "  Verifier les hypotheses.  ",
  eventMetadata: { requestedRuleLabels: ["Validation requise"] },
};

describe("openEstimateReviewCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits the whole review workflow through one service-role RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: createRpcResult(), error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(openEstimateReviewCycle(validInput)).resolves.toMatchObject({
      created: true,
      cycle: { id: CYCLE_ID, cycle_number: 2 },
      approvals: [{ rule_id: RULE_ID, review_cycle_id: CYCLE_ID }],
    });

    expect(createServiceRoleClient).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("open_estimate_review_cycle", {
      p_version_id: VERSION_ID,
      p_tenant_id: TENANT_ID,
      p_actor_user_id: ACTOR_ID,
      p_assigned_reviewer_id: REVIEWER_ID,
      p_rule_ids: [RULE_ID],
      p_submission_message: "Verifier les hypotheses.",
      p_event_metadata: { requestedRuleLabels: ["Validation requise"] },
    });
  });

  it("returns an existing atomic result on an idempotent retry", async () => {
    const reused = createRpcResult({ created: false });
    const rpc = vi.fn().mockResolvedValue({ data: reused, error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(openEstimateReviewCycle(validInput)).resolves.toEqual(reused);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("accepts a supersession result returned by the atomic seam", async () => {
    const supersedingCycleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const superseded = createRpcResult({
      cycle: {
        ...createRpcResult().cycle,
        id: supersedingCycleId,
        cycle_number: 3,
        carried_over_from_cycle_id: CYCLE_ID,
      },
      approvals: [
        {
          ...createRpcResult().approvals[0]!,
          review_cycle_id: supersedingCycleId,
        },
      ],
    });
    const rpc = vi.fn().mockResolvedValue({ data: superseded, error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(openEstimateReviewCycle(validInput)).resolves.toMatchObject({
      created: true,
      cycle: {
        id: supersedingCycleId,
        cycle_number: 3,
        carried_over_from_cycle_id: CYCLE_ID,
      },
      approvals: [{ review_cycle_id: supersedingCycleId }],
    });
  });

  it("fails closed before any RPC when the service-role configuration is missing", async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    });

    await expect(openEstimateReviewCycle(validInput)).rejects.toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  });

  it("rejects an explicitly blank submission message before the privileged RPC", async () => {
    await expect(
      openEstimateReviewCycle({ ...validInput, submissionMessage: "   " })
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects a response whose approvals do not belong to the returned cycle", async () => {
    const invalid = createRpcResult();
    invalid.approvals[0]!.review_cycle_id =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rpc = vi.fn().mockResolvedValue({ data: invalid, error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(openEstimateReviewCycle(validInput)).rejects.toMatchObject({
      status: 500,
      code: "ESTIMATE_REVIEW_RPC_INVALID_RESPONSE",
    });
  });

  it("maps a stale v2 snapshot to a version conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        message: "ESTIMATE_V2_SNAPSHOT_STALE",
        details: null,
        hint: null,
      },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(openEstimateReviewCycle(validInput)).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
    });
  });
});

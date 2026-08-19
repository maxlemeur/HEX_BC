import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  buildAffaireRegisterSubmissionSignalMessage: vi.fn(
    (input: { intro: string }) => input.intro
  ),
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

vi.mock("@/lib/email/send-approval-review-request", () => ({
  sendApprovalReviewRequestNotification: vi.fn(),
}));

vi.mock("@/lib/estimates/approval-v2-snapshot", () => ({
  freezeApprovalV2DraftIfRequired: vi.fn(),
}));

vi.mock("@/lib/estimates/review-cycle-submission", () => ({
  openEstimateReviewCycle: vi.fn(),
}));

vi.mock("@/lib/estimates/version-zero-drafts", () => ({
  fetchVersionZeroDraftSummary: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import {
  decideEstimateApprovalAction,
  requestEstimateApprovalAction,
  submitEstimateForReviewAction,
  updateEstimateReviewCorrectionItemStatusAction,
} from "@/app/dashboard/_actions/estimate-approval";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import * as rulesEngine from "@/lib/estimates/rules-engine";
import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CYCLE_ID = "77777777-7777-4777-8777-777777777777";
const RULE_A = "99999999-9999-4999-8999-999999999999";
const RULE_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPROVAL_ID = "88888888-8888-4888-8888-888888888888";
const CORRECTION_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const REQUIRE_APPROVAL_RULE = {
  id: RULE_A,
  created_at: "2026-03-01T08:00:00.000Z",
  updated_at: "2026-03-01T08:00:00.000Z",
  tenant_id: TENANT_ID,
  rule_type: "require_approval",
  scope_type: "global",
  scope_id: null,
  threshold_value: 100000,
  action: "require_approval",
  is_active: true,
};

function createAtomicReviewSubmission(input: {
  versionId: string;
  tenantId: string;
  actorUserId: string;
  assignedReviewerId: string;
  ruleIds: string[];
  submissionMessage?: string | null;
}) {
  const requestedAt = "2026-03-06T09:10:00.000Z";
  return {
    created: true,
    cycle: {
      id: CYCLE_ID,
      created_at: requestedAt,
      updated_at: requestedAt,
      tenant_id: input.tenantId,
      version_id: input.versionId,
      cycle_number: 1,
      requested_by: input.actorUserId,
      requested_at: requestedAt,
      submission_message: input.submissionMessage?.trim() || null,
      assigned_reviewer_id: input.assignedReviewerId,
      decided_by: null,
      decision: null,
      decided_at: null,
      carried_over_from_cycle_id: null,
      requested_content_revision: 1,
      superseded_at: null,
      superseded_by: null,
      superseded_by_cycle_id: null,
    },
    approvals: input.ruleIds.map((ruleId, index) => ({
      id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`,
      created_at: requestedAt,
      updated_at: requestedAt,
      tenant_id: input.tenantId,
      version_id: input.versionId,
      rule_id: ruleId,
      requested_by: input.actorUserId,
      approved_by: null,
      status: "pending" as const,
      decided_at: null,
      approved_content_revision: null,
      review_cycle_id: CYCLE_ID,
      superseded_at: null,
    })),
  };
}

function createTenantMembershipBuilder(
  rows: Array<{
    tenant_id: string;
    user_id: string;
    role: "admin" | "director" | "engineer";
    is_default: boolean;
    created_at: string;
  }>
) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: rows,
    error: null,
  });
  builder.then.mockImplementation((onFulfilled) =>
    Promise.resolve({
      data: rows,
      error: null,
    }).then(onFulfilled)
  );

  return builder;
}

function createMembershipBuilder(role: "admin" | "director" | "engineer") {
  return createTenantMembershipBuilder([
    {
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role,
      is_default: true,
      created_at: "2026-03-01T10:00:00.000Z",
    },
  ]);
}

function createProfilesBuilder(
  rows = [
    {
      id: USER_ID,
      full_name: "Nadia Martin",
      work_email: "nadia@example.com",
    },
  ]
) {
  const builder = {
    in: vi.fn(),
    then: vi.fn(),
  };

  builder.in.mockReturnValue(builder);
  builder.then.mockImplementation((onFulfilled) =>
    Promise.resolve({
      data: rows,
      error: null,
    }).then(onFulfilled)
  );

  return builder;
}

function createVersionAccessBuilder(
  overrides: Record<string, unknown> = {},
  projectOverrides: Record<string, unknown> = {}
) {
  const builder = {
    eq: vi.fn(),
    single: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({
    data: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      status: "draft",
      updated_at: "2026-03-01T09:00:00.000Z",
      content_revision: 1,
      calc_engine_version: 1,
      project_id: PROJECT_ID,
      version_number: 1,
      total_ht_cents: 250000,
      margin_bp: 1200,
      margin_multiplier: 1,
      discount_bp: 0,
      approval_status: "not_required",
      approval_summary: null,
      approval_evaluated_at: null,
      ...overrides,
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Affaire test",
        client_name: "Client A",
        ...projectOverrides,
      },
    },
    error: null,
  });

  return builder;
}

function createListBuilder<T>(data: T[]) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    then: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.lte.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.single.mockResolvedValue({
    data: data[0] ?? null,
    error: data[0] ? null : { code: "PGRST116", message: "not found" },
  });
  builder.then.mockImplementation((onFulfilled) =>
    Promise.resolve({
      data,
      error: null,
    }).then(onFulfilled)
  );

  return builder;
}

function mockAuthenticatedSupabase(input: {
  from: (table: string) => unknown;
  rpc?: ReturnType<typeof vi.fn>;
  userId?: string;
}) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: input.userId ?? USER_ID,
          },
        },
        error: null,
      }),
    },
    from: ((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => createProfilesBuilder()),
        };
      }

      try {
        return input.from(table);
      } catch (error) {
        if (
          table === "estimate_risk_alerts" ||
          table === "affaire_register_entries" ||
          table === "estimate_review_correction_items" ||
          table === "estimate_review_correction_events"
        ) {
          return {
            select: vi.fn(() => createListBuilder([])),
          };
        }

        throw error;
      }
    }) as typeof input.from,
    rpc: input.rpc ?? vi.fn(),
  } as never);
}

function createApprovalFromHandler(role: "admin" | "director" | "engineer") {
  const membershipBuilder = createMembershipBuilder(role);
  const versionBuilder = createVersionAccessBuilder();
  const itemsBuilder = createListBuilder([]);
  const rulesBuilder = createListBuilder([REQUIRE_APPROVAL_RULE]);
  const approvalsBuilder = createListBuilder([]);
  const reviewCyclesBuilder = createListBuilder([]);
  const reviewCommentsBuilder = createListBuilder([]);

  const from = vi.fn((table: string) => {
    if (table === "tenant_memberships") {
      return { select: vi.fn(() => membershipBuilder) };
    }
    if (table === "estimate_versions") {
      return { select: vi.fn(() => versionBuilder) };
    }
    if (table === "estimate_items") {
      return { select: vi.fn(() => itemsBuilder) };
    }
    if (table === "estimate_rules") {
      return { select: vi.fn(() => rulesBuilder) };
    }
    if (table === "estimate_approvals") {
      return { select: vi.fn(() => approvalsBuilder) };
    }
    if (table === "estimate_review_cycles") {
      return { select: vi.fn(() => reviewCyclesBuilder) };
    }
    if (table === "estimate_review_comments") {
      return { select: vi.fn(() => reviewCommentsBuilder) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  mockAuthenticatedSupabase({ from });
  return from;
}

function expectApprovalPathsRevalidated() {
  expect(revalidatePath).toHaveBeenCalledWith(
    `/dashboard/estimates/${VERSION_ID}`
  );
  expect(revalidatePath).toHaveBeenCalledWith(
    `/dashboard/affaires/${PROJECT_ID}`
  );
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/approvals");
}

describe("estimate approval server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null as never);
    vi.mocked(freezeApprovalV2DraftIfRequired).mockResolvedValue(false);
    vi.mocked(openEstimateReviewCycle).mockImplementation(async (input) =>
      createAtomicReviewSubmission(input)
    );
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
    });
    vi.mocked(fetchVersionZeroDraftSummary).mockResolvedValue(null as never);
  });

  it("requestEstimateApprovalAction loops ruleIds through submitEstimateApproval({ action: request })", async () => {
    createApprovalFromHandler("admin");
    const submitSpy = vi.spyOn(rulesEngine, "submitEstimateApproval");

    const result = await requestEstimateApprovalAction({
      versionId: VERSION_ID,
      projectId: PROJECT_ID,
      ruleIds: [RULE_A, RULE_B],
    });

    expect(submitSpy).toHaveBeenCalledTimes(2);
    expect(submitSpy).toHaveBeenNthCalledWith(1, {
      versionId: VERSION_ID,
      action: "request",
      ruleId: RULE_A,
    });
    expect(submitSpy).toHaveBeenNthCalledWith(2, {
      versionId: VERSION_ID,
      action: "request",
      ruleId: RULE_B,
    });
    expect(openEstimateReviewCycle).toHaveBeenCalledTimes(2);
    expect(openEstimateReviewCycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        versionId: VERSION_ID,
        ruleIds: [RULE_A],
      })
    );
    expect(openEstimateReviewCycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        versionId: VERSION_ID,
        ruleIds: [RULE_B],
      })
    );
    expect(result?.approval).toMatchObject({
      rule_id: RULE_B,
      status: "pending",
    });
    expectApprovalPathsRevalidated();
    submitSpy.mockRestore();
  });

  it("submitEstimateForReviewAction submits through the real rules engine", async () => {
    createApprovalFromHandler("admin");
    const submitSpy = vi.spyOn(rulesEngine, "submitEstimateApproval");

    const result = await submitEstimateForReviewAction({
      versionId: VERSION_ID,
      projectId: PROJECT_ID,
      ruleIds: [RULE_A],
      submissionMessage: "Verifier la couverture metre.",
    });

    expect(submitSpy).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [RULE_A],
      submissionMessage: "Verifier la couverture metre.",
      assignedReviewerUserId: null,
    });
    expect(openEstimateReviewCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: VERSION_ID,
        ruleIds: [RULE_A],
        submissionMessage: "Verifier la couverture metre.",
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        cycle: expect.objectContaining({ id: CYCLE_ID }),
        requestedApprovalCount: 1,
        requestedRuleIds: [RULE_A],
      })
    );
    expectApprovalPathsRevalidated();
    submitSpy.mockRestore();
  });

  it("submitEstimateForReviewAction throws when the review payload is incomplete", async () => {
    createApprovalFromHandler("admin");
    const originalSubmit = rulesEngine.submitEstimateApproval;
    const submitSpy = vi
      .spyOn(rulesEngine, "submitEstimateApproval")
      .mockImplementation(async (input) => {
        const result = await originalSubmit(input);
        return {
          approval: result.approval,
        };
      });

    await expect(
      submitEstimateForReviewAction({
        versionId: VERSION_ID,
        projectId: PROJECT_ID,
        ruleIds: [RULE_A],
      })
    ).rejects.toThrow("Soumission de revue incomplete.");

    expect(submitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: VERSION_ID,
        action: "submit_for_review",
        ruleIds: [RULE_A],
      })
    );
    expect(openEstimateReviewCycle).toHaveBeenCalledOnce();
    expectApprovalPathsRevalidated();
    submitSpy.mockRestore();
  });

  it("decideEstimateApprovalAction decides through the real rules engine", async () => {
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder();
    const reviewCycleBuilder = createListBuilder([
      {
        id: CYCLE_ID,
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 1,
        requested_by: USER_ID,
        requested_at: "2026-03-01T10:00:00.000Z",
        submission_message: null,
        assigned_reviewer_id: USER_ID,
        decided_by: null,
        decision: null,
        decided_at: null,
        carried_over_from_cycle_id: null,
      },
    ]);
    const approvalsBuilder = createListBuilder([
      {
        id: APPROVAL_ID,
        created_at: "2026-03-01T10:05:00.000Z",
        updated_at: "2026-03-01T10:05:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        rule_id: RULE_A,
        requested_by: USER_ID,
        approved_by: null,
        status: "pending",
        decided_at: null,
      },
    ]);
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          cycle_id: CYCLE_ID,
          cycle_number: 1,
          approval_ids: [APPROVAL_ID],
          rule_ids: [RULE_A],
          comment_count: 0,
        },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return { select: vi.fn(() => membershipBuilder) };
      }
      if (table === "estimate_versions") {
        return { select: vi.fn(() => versionBuilder) };
      }
      if (table === "estimate_review_cycles") {
        return { select: vi.fn(() => reviewCycleBuilder) };
      }
      if (table === "estimate_approvals") {
        return { select: vi.fn(() => approvalsBuilder) };
      }
      if (table === "estimate_review_comments") {
        return { select: vi.fn(() => createListBuilder([])) };
      }
      if (table === "estimate_items") {
        return { select: vi.fn(() => createListBuilder([])) };
      }
      if (table === "estimate_rules") {
        return { select: vi.fn(() => createListBuilder([REQUIRE_APPROVAL_RULE])) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mockAuthenticatedSupabase({ from, rpc });
    const submitSpy = vi.spyOn(rulesEngine, "submitEstimateApproval");

    const result = await decideEstimateApprovalAction({
      versionId: VERSION_ID,
      projectId: PROJECT_ID,
      decision: "approved",
      comments: [],
    });

    expect(submitSpy).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      action: "decide",
      decision: "approved",
      comments: [],
    });
    expect(rpc).toHaveBeenCalledWith("decide_estimate_review_cycle", {
      p_cycle_id: CYCLE_ID,
      p_decision: "approved",
      p_comments: [],
    });
    expect(result.approval).toMatchObject({
      id: APPROVAL_ID,
      status: "approved",
      approved_by: USER_ID,
    });
    expectApprovalPathsRevalidated();
    submitSpy.mockRestore();
  });

  it("updateEstimateReviewCorrectionItemStatusAction calls the real update function", async () => {
    const membershipBuilder = createMembershipBuilder("engineer");
    const versionBuilder = createVersionAccessBuilder();
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          item_id: CORRECTION_ITEM_ID,
          cycle_id: CYCLE_ID,
          version_id: VERSION_ID,
          status: "corrected",
          treated_at: "2026-03-06T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return { select: vi.fn(() => membershipBuilder) };
      }
      if (table === "estimate_versions") {
        return { select: vi.fn(() => versionBuilder) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mockAuthenticatedSupabase({ from, rpc });
    const updateSpy = vi.spyOn(
      rulesEngine,
      "updateEstimateReviewCorrectionItemStatus"
    );

    const result = await updateEstimateReviewCorrectionItemStatusAction({
      versionId: VERSION_ID,
      projectId: PROJECT_ID,
      itemId: CORRECTION_ITEM_ID,
      status: "corrected",
      note: "Quantitatif mis a jour.",
    });

    expect(updateSpy).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      itemId: CORRECTION_ITEM_ID,
      status: "corrected",
      note: "Quantitatif mis a jour.",
    });
    expect(rpc).toHaveBeenCalledWith("record_estimate_review_correction_action", {
      p_item_id: CORRECTION_ITEM_ID,
      p_status: "corrected",
      p_note: "Quantitatif mis a jour.",
    });
    expect(result).toEqual({
      itemId: CORRECTION_ITEM_ID,
      cycleId: CYCLE_ID,
      versionId: VERSION_ID,
      status: "corrected",
      treatedAt: "2026-03-06T10:00:00.000Z",
    });
    expectApprovalPathsRevalidated();
    updateSpy.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

import {
  getEstimateApprovalSummary,
  submitEstimateApproval,
} from "@/lib/estimates/rules-engine";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";

function createMembershipBuilder(role: "admin" | "director" | "engineer") {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role,
        is_default: true,
        created_at: "2026-03-01T10:00:00.000Z",
      },
    ],
    error: null,
  });

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
      project_id: PROJECT_ID,
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
        user_id: OWNER_ID,
        name: "Affaire test",
        client_name: "Client A",
        ...projectOverrides,
      },
    },
    error: null,
  });

  return builder;
}

function createListBuilder<T>(dataOrFactory: T[] | (() => T[])) {
  const resolveData = () =>
    typeof dataOrFactory === "function" ? dataOrFactory() : dataOrFactory;
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.then.mockImplementation((onFulfilled) =>
    Promise.resolve({
      data: resolveData(),
      error: null,
    }).then(onFulfilled)
  );

  return builder;
}

function createSingleUpdateBuilder<T>(data: T) {
  const builder = {
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  builder.single.mockResolvedValue({
    data,
    error: null,
  });

  return builder;
}

function mockAuthenticatedSupabase(input: {
  from: (table: string) => unknown;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
          },
        },
        error: null,
      }),
    },
    from: input.from,
    rpc: input.rpc ?? vi.fn(),
  } as never);
}

describe("submitEstimateApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null as never);
  });

  it("rejects approval requests from directors on non-owned estimates", async () => {
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder();
    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "request",
        ruleId: "66666666-6666-4666-8666-666666666666",
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("requires at least one scoped comment for approval with reservations", async () => {
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder();
    const reviewCycleBuilder = createListBuilder([
      {
        id: "77777777-7777-4777-8777-777777777777",
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 1,
        requested_by: OWNER_ID,
        requested_at: "2026-03-01T10:00:00.000Z",
        decided_by: null,
        decision: null,
        decided_at: null,
        carried_over_from_cycle_id: null,
      },
    ]);
    const approvalsBuilder = createListBuilder([
      {
        id: "88888888-8888-4888-8888-888888888888",
        created_at: "2026-03-01T10:05:00.000Z",
        updated_at: "2026-03-01T10:05:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        rule_id: "99999999-9999-4999-8999-999999999999",
        requested_by: OWNER_ID,
        approved_by: null,
        status: "pending",
        decided_at: null,
      },
    ]);
    const itemsBuilder = createListBuilder([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        category_id: null,
        item_type: "section",
        title: "Lot CFO",
        parent_id: null,
        position: 1,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        category_id: null,
        item_type: "line",
        title: "Alimentation TGBT",
        parent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        position: 1,
      },
    ]);
    const rulesBuilder = createListBuilder([
      {
        id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-03-01T09:00:00.000Z",
        updated_at: "2026-03-01T09:00:00.000Z",
        tenant_id: TENANT_ID,
        rule_type: "require_approval",
        scope_type: "global",
        scope_id: null,
        threshold_value: 100000,
        action: "require_approval",
        is_active: true,
      },
    ]);

    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => reviewCycleBuilder),
        };
      }

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => approvalsBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => itemsBuilder),
        };
      }

      if (table === "estimate_rules") {
        return {
          select: vi.fn(() => rulesBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "decide",
        decision: "approved_with_reservations",
        comments: [],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("keeps active review cycles actionable when pending approvals outlive current rule violations", async () => {
    const ruleId = "99999999-9999-4999-8999-999999999999";
    const pendingApproval = {
      id: "88888888-8888-4888-8888-888888888888",
      created_at: "2026-03-01T10:05:00.000Z",
      updated_at: "2026-03-01T10:05:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: ruleId,
      requested_by: OWNER_ID,
      approved_by: null,
      status: "pending",
      decided_at: null,
    };
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder({
      total_ht_cents: 150000,
    });
    const reviewCyclesBuilder = createListBuilder([
      {
        id: "77777777-7777-4777-8777-777777777777",
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 2,
        requested_by: OWNER_ID,
        requested_at: "2026-03-01T10:00:00.000Z",
        decided_by: null,
        decision: null,
        decided_at: null,
        carried_over_from_cycle_id: "66666666-6666-4666-8666-666666666666",
        requested_by_profile: {
          full_name: "Owner",
        },
        decided_by_profile: null,
      },
    ]);
    const reviewCommentsBuilder = createListBuilder([]);
    const approvalsBuilder = createListBuilder([pendingApproval]);
    const rulesBuilder = createListBuilder([
      {
        id: ruleId,
        created_at: "2026-03-01T09:00:00.000Z",
        updated_at: "2026-03-01T09:00:00.000Z",
        tenant_id: TENANT_ID,
        rule_type: "require_approval",
        scope_type: "global",
        scope_id: null,
        threshold_value: 200000,
        action: "require_approval",
        is_active: true,
      },
    ]);
    const itemsBuilder = createListBuilder([]);

    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => reviewCyclesBuilder),
        };
      }

      if (table === "estimate_review_comments") {
        return {
          select: vi.fn(() => reviewCommentsBuilder),
        };
      }

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => approvalsBuilder),
        };
      }

      if (table === "estimate_rules") {
        return {
          select: vi.fn(() => rulesBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => itemsBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary.reasons).toEqual([]);
    expect(summary.permissions.canDecide).toBe(true);
    expect(summary.activeCycle).toMatchObject({
      cycleNumber: 2,
      pendingApprovalCount: 1,
    });
    expect(summary.latestDecision).toMatchObject({
      status: "pending",
      cycleId: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("decides version-level reviews through the atomic RPC", async () => {
    const cycleId = "77777777-7777-4777-8777-777777777777";
    const approvalId = "88888888-8888-4888-8888-888888888888";
    const ruleId = "99999999-9999-4999-8999-999999999999";
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder();
    const reviewCycleBuilder = createListBuilder([
      {
        id: cycleId,
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 1,
        requested_by: OWNER_ID,
        requested_at: "2026-03-01T10:00:00.000Z",
        decided_by: null,
        decision: null,
        decided_at: null,
        carried_over_from_cycle_id: null,
      },
    ]);
    const approvalsBuilder = createListBuilder([
      {
        id: approvalId,
        created_at: "2026-03-01T10:05:00.000Z",
        updated_at: "2026-03-01T10:05:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        rule_id: ruleId,
        requested_by: OWNER_ID,
        approved_by: null,
        status: "pending",
        decided_at: null,
      },
    ]);
    const itemsBuilder = createListBuilder([]);
    const rulesBuilder = createListBuilder([]);
    const reviewCommentsBuilder = createListBuilder([]);
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          cycle_id: cycleId,
          cycle_number: 1,
          approval_ids: [approvalId],
          rule_ids: [ruleId],
          comment_count: 0,
        },
      ],
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => reviewCycleBuilder),
        };
      }

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => approvalsBuilder),
        };
      }

      if (table === "estimate_review_comments") {
        return {
          select: vi.fn(() => reviewCommentsBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => itemsBuilder),
        };
      }

      if (table === "estimate_rules") {
        return {
          select: vi.fn(() => rulesBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from, rpc });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "decide",
      decision: "approved",
      comments: [],
    });

    expect(rpc).toHaveBeenCalledWith("decide_estimate_review_cycle", {
      p_cycle_id: cycleId,
      p_decision: "approved",
      p_comments: [],
    });
    expect(result.approval).toMatchObject({
      id: approvalId,
      rule_id: ruleId,
      status: "approved",
      approved_by: USER_ID,
    });
  });

  it("closes legacy review cycles from approvals in the current cycle only", async () => {
    const targetRuleId = "99999999-9999-4999-8999-999999999999";
    const targetApprovalId = "88888888-8888-4888-8888-888888888888";
    const cycleId = "77777777-7777-4777-8777-777777777777";
    const targetPending = {
      id: targetApprovalId,
      created_at: "2026-03-02T10:05:00.000Z",
      updated_at: "2026-03-02T10:05:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: targetRuleId,
      requested_by: OWNER_ID,
      approved_by: null,
      status: "pending",
      decided_at: null,
    };
    const currentApproved = {
      id: targetApprovalId,
      created_at: "2026-03-02T10:05:00.000Z",
      updated_at: "2026-03-02T10:10:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: targetRuleId,
      requested_by: OWNER_ID,
      approved_by: USER_ID,
      status: "approved",
      decided_at: "2026-03-02T10:10:00.000Z",
    };
    const oldRejected = {
      id: "66666666-6666-4666-8666-666666666666",
      created_at: "2026-02-20T09:00:00.000Z",
      updated_at: "2026-02-20T09:05:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requested_by: OWNER_ID,
      approved_by: USER_ID,
      status: "rejected",
      decided_at: "2026-02-20T09:05:00.000Z",
    };
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder();
    const targetApprovalBuilder = createListBuilder([targetPending]);
    const pendingApprovalsBuilder = createListBuilder([]);
    const cycleApprovalsBuilder = createListBuilder(() => [currentApproved, oldRejected]);
    const finalPendingApprovalsBuilder = createListBuilder([]);
    const approvalUpdateBuilder = createSingleUpdateBuilder(currentApproved);
    const openCycleBuilder = createListBuilder([
      {
        id: cycleId,
        created_at: "2026-03-02T10:00:00.000Z",
        updated_at: "2026-03-02T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 3,
        requested_by: OWNER_ID,
        requested_at: "2026-03-02T10:00:00.000Z",
        decided_by: null,
        decision: null,
        decided_at: null,
        carried_over_from_cycle_id: "55555555-5555-4555-8555-555555555555",
        requested_by_profile: {
          full_name: "Owner",
        },
        decided_by_profile: null,
      },
    ]);
    const closeCycleBuilder = createSingleUpdateBuilder({
      id: cycleId,
      created_at: "2026-03-02T10:00:00.000Z",
      updated_at: "2026-03-02T10:10:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      cycle_number: 3,
      requested_by: OWNER_ID,
      requested_at: "2026-03-02T10:00:00.000Z",
      decided_by: USER_ID,
      decision: "approved",
      decided_at: "2026-03-02T10:10:00.000Z",
      carried_over_from_cycle_id: "55555555-5555-4555-8555-555555555555",
    });
    const reviewCommentsBuilder = createListBuilder([]);
    const itemsBuilder = createListBuilder([]);
    const rulesBuilder = createListBuilder([]);
    const approvalSelectBuilders = [
      targetApprovalBuilder,
      pendingApprovalsBuilder,
      cycleApprovalsBuilder,
      finalPendingApprovalsBuilder,
    ];
    cycleApprovalsBuilder.gte.mockImplementation(() => {
      cycleApprovalsBuilder.order.mockImplementation(() =>
        Promise.resolve({
          data: [currentApproved],
          error: null,
        })
      );
      return cycleApprovalsBuilder;
    });
    const reviewCycleSelectBuilders = [openCycleBuilder, openCycleBuilder];
    const reviewCycleUpdate = vi.fn(() => closeCycleBuilder);
    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
        };
      }

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => approvalSelectBuilders.shift()),
          update: vi.fn(() => approvalUpdateBuilder),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => reviewCycleSelectBuilders.shift()),
          update: reviewCycleUpdate,
        };
      }

      if (table === "estimate_review_comments") {
        return {
          select: vi.fn(() => reviewCommentsBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => itemsBuilder),
        };
      }

      if (table === "estimate_rules") {
        return {
          select: vi.fn(() => rulesBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "approve",
      ruleId: targetRuleId,
    });

    expect(cycleApprovalsBuilder.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-03-02T10:00:00.000Z"
    );
    expect(reviewCycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approved",
      })
    );
    expect(result.approval).toMatchObject({
      id: targetApprovalId,
      status: "approved",
    });
  });
});

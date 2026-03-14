import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  buildAffaireRegisterSubmissionSignalMessage: vi.fn((input: { intro: string }) => input.intro),
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

vi.mock("@/lib/email/send-approval-review-request", () => ({
  sendApprovalReviewRequestNotification: vi.fn(),
}));

import {
  getEstimateApprovalSummary,
  submitEstimateApproval,
} from "@/lib/estimates/rules-engine";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import { sendApprovalReviewRequestNotification } from "@/lib/email/send-approval-review-request";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";

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
    {
      id: OWNER_ID,
      full_name: "Owner",
      work_email: "owner@example.com",
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
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.lte.mockReturnValue(builder);
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

function createSingleInsertBuilder<T>(data: T) {
  const builder = {
    select: vi.fn(),
    single: vi.fn(),
  };

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
  profilesBuilder?: ReturnType<typeof createProfilesBuilder>;
}) {
  const profilesBuilder = input.profilesBuilder ?? createProfilesBuilder();
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
    from: ((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => profilesBuilder),
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

describe("submitEstimateApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOptionalServiceRoleClient).mockReset();
    vi.mocked(fetchAffaireRegisterGateSummary).mockReset();
    vi.mocked(sendApprovalReviewRequestNotification).mockReset();
    vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null as never);
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
    });
    vi.mocked(sendApprovalReviewRequestNotification).mockResolvedValue({
      message_id: "email-review-1",
      subject: "Validation requise - Affaire test V1",
    });
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

  it("lets engineer requesters resolve reviewers through the service-role client", async () => {
    const membershipBuilder = createMembershipBuilder("admin");
    const versionBuilder = createVersionAccessBuilder(
      {
        total_ht_cents: 250000,
      },
      {
        user_id: USER_ID,
      }
    );
    const itemsBuilder = createListBuilder([]);
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
    const reviewCycleSelectBuilders = [
      createListBuilder([]),
      createListBuilder([]),
      createListBuilder([
        {
          id: "77777777-7777-4777-8777-777777777777",
          created_at: "2026-03-01T10:00:00.000Z",
          updated_at: "2026-03-01T10:00:00.000Z",
          tenant_id: TENANT_ID,
          version_id: VERSION_ID,
          cycle_number: 1,
          requested_by: USER_ID,
          requested_at: "2026-03-01T10:00:00.000Z",
          submission_message: "Prioriser les exceptions CFO.",
          assigned_reviewer_id: REVIEWER_ID,
          decided_by: null,
          decision: null,
          decided_at: null,
          carried_over_from_cycle_id: null,
          requested_by_profile: {
            full_name: "Nadia Martin",
          },
          decided_by_profile: null,
          assigned_reviewer_profile: {
            id: REVIEWER_ID,
            full_name: "Camille Reviewer",
            work_email: "reviewer@example.com",
          },
        },
      ]),
    ];
    const reviewCycleInsertBuilder = createSingleInsertBuilder({
      id: "77777777-7777-4777-8777-777777777777",
      created_at: "2026-03-01T10:00:00.000Z",
      updated_at: "2026-03-01T10:00:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      cycle_number: 1,
      requested_by: USER_ID,
      requested_at: "2026-03-01T10:00:00.000Z",
      submission_message: "Prioriser les exceptions CFO.",
      assigned_reviewer_id: REVIEWER_ID,
      decided_by: null,
      decision: null,
      decided_at: null,
      carried_over_from_cycle_id: null,
    });
    const approvalInsertBuilder = createSingleInsertBuilder({
      id: "88888888-8888-4888-8888-888888888888",
      created_at: "2026-03-01T10:05:00.000Z",
      updated_at: "2026-03-01T10:05:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: "99999999-9999-4999-8999-999999999999",
      requested_by: USER_ID,
      approved_by: null,
      status: "pending",
      decided_at: null,
    });
    const reviewCommentsBuilder = createListBuilder([]);

    const serviceRoleMembershipBuilder = createTenantMembershipBuilder([
      {
        tenant_id: TENANT_ID,
        user_id: REVIEWER_ID,
        role: "director",
        is_default: true,
        created_at: "2026-03-01T08:00:00.000Z",
      },
    ]);
    const serviceRoleProfilesBuilder = createProfilesBuilder([
      {
        id: REVIEWER_ID,
        full_name: "Camille Reviewer",
        work_email: "reviewer@example.com",
      },
    ]);

    vi.mocked(createOptionalServiceRoleClient)
      .mockReturnValueOnce({
        from: ((table: string) => {
          if (table === "tenant_memberships") {
            return {
              select: vi.fn(() => serviceRoleMembershipBuilder),
            };
          }

          if (table === "profiles") {
            return {
              select: vi.fn(() => serviceRoleProfilesBuilder),
            };
          }

          throw new Error(`Unexpected service-role table: ${table}`);
        }) as never,
      } as never)
      .mockReturnValueOnce(null as never);

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

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => createListBuilder([])),
          insert: vi.fn(() => approvalInsertBuilder),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => reviewCycleSelectBuilders.shift() ?? createListBuilder([])),
          insert: vi.fn(() => reviewCycleInsertBuilder),
        };
      }

      if (table === "estimate_review_comments") {
        return {
          select: vi.fn(() => reviewCommentsBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [],
      submissionMessage: "Prioriser les exceptions CFO.",
    });

    expect(result.cycle).toMatchObject({
      submissionMessage: "Prioriser les exceptions CFO.",
      assignedReviewer: {
        userId: REVIEWER_ID,
        fullName: "Camille Reviewer",
      },
    });
    expect(result.requestedRuleIds).toEqual(["99999999-9999-4999-8999-999999999999"]);
  });

  it("treats unavailable block signals as submission blockers", async () => {
    const membershipBuilder = createMembershipBuilder("admin");
    const versionBuilder = createVersionAccessBuilder();
    const itemsBuilder = createListBuilder([]);
    const rulesBuilder = createListBuilder([
      {
        id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-03-01T09:00:00.000Z",
        updated_at: "2026-03-01T09:00:00.000Z",
        tenant_id: TENANT_ID,
        rule_type: "critical_exceptions_max",
        scope_type: "global",
        scope_id: null,
        threshold_value: 0,
        action: "block",
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

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => createListBuilder([])),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "submit_for_review",
        ruleIds: [],
        submissionMessage: "Verifier la couverture avant la revue.",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("refuses to reuse an open cycle when reviewer context would be lost", async () => {
    const membershipBuilder = createMembershipBuilder("admin");
    const versionBuilder = createVersionAccessBuilder({
      total_ht_cents: 250000,
    });
    const itemsBuilder = createListBuilder([]);
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
    const openCycleBuilder = createListBuilder([
      {
        id: "77777777-7777-4777-8777-777777777777",
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 1,
        requested_by: OWNER_ID,
        requested_at: "2026-03-01T10:00:00.000Z",
        submission_message: null,
        assigned_reviewer_id: null,
        decided_by: null,
        decision: null,
        decided_at: null,
        carried_over_from_cycle_id: null,
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

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => createListBuilder([])),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => openCycleBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "submit_for_review",
        ruleIds: [],
        submissionMessage: "Verifier la couverture DPGF.",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("logs an approval_submitted event and sends the internal review email", async () => {
    const membershipBuilder = createTenantMembershipBuilder([
      {
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role: "admin",
        is_default: true,
        created_at: "2026-03-01T10:00:00.000Z",
      },
      {
        tenant_id: TENANT_ID,
        user_id: REVIEWER_ID,
        role: "director",
        is_default: false,
        created_at: "2026-03-01T11:00:00.000Z",
      },
    ]);
    const versionBuilder = createVersionAccessBuilder({
      version_number: 1,
    });
    const itemsBuilder = createListBuilder([]);
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
    const reviewCycleSelectBuilders = [
      createListBuilder([]),
      createListBuilder([]),
      createListBuilder([
        {
          id: "77777777-7777-4777-8777-777777777777",
          created_at: "2026-03-06T09:10:00.000Z",
          updated_at: "2026-03-06T09:10:00.000Z",
          tenant_id: TENANT_ID,
          version_id: VERSION_ID,
          cycle_number: 1,
          requested_by: USER_ID,
          requested_at: "2026-03-06T09:10:00.000Z",
          submission_message: "Verifier la couverture CFO.",
          assigned_reviewer_id: REVIEWER_ID,
          decided_by: null,
          decision: null,
          decided_at: null,
          carried_over_from_cycle_id: null,
          requested_by_profile: {
            full_name: "Nadia Martin",
          },
          decided_by_profile: null,
          assigned_reviewer_profile: {
            id: REVIEWER_ID,
            full_name: "Camille Reviewer",
            work_email: "reviewer@example.com",
          },
        },
      ]),
    ];
    const reviewCycleInsertBuilder = createSingleInsertBuilder({
      id: "77777777-7777-4777-8777-777777777777",
      created_at: "2026-03-06T09:10:00.000Z",
      updated_at: "2026-03-06T09:10:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      cycle_number: 1,
      requested_by: USER_ID,
      requested_at: "2026-03-06T09:10:00.000Z",
      submission_message: "Verifier la couverture CFO.",
      assigned_reviewer_id: REVIEWER_ID,
      decided_by: null,
      decision: null,
      decided_at: null,
      carried_over_from_cycle_id: null,
    });
    const approvalInsertBuilder = createSingleInsertBuilder({
      id: "88888888-8888-4888-8888-888888888888",
      created_at: "2026-03-06T09:11:00.000Z",
      updated_at: "2026-03-06T09:11:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: "99999999-9999-4999-8999-999999999999",
      requested_by: USER_ID,
      approved_by: null,
      status: "pending",
      decided_at: null,
    });
    const reviewCommentsBuilder = createListBuilder([]);
    const versionUpdateBuilder = createSingleUpdateBuilder({
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      status: "draft",
      version_number: 1,
      project_id: PROJECT_ID,
      total_ht_cents: 250000,
      margin_bp: 1200,
      margin_multiplier: 1,
      discount_bp: 0,
      approval_status: "required",
      approval_summary: {},
      approval_evaluated_at: "2026-03-06T09:10:00.000Z",
    });
    const eventRpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    vi.mocked(createOptionalServiceRoleClient)
      .mockReturnValueOnce(null as never)
      .mockReturnValueOnce(null as never)
      .mockReturnValueOnce(null as never)
      .mockReturnValueOnce({
        rpc: eventRpc,
      } as never);

    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
          update: vi.fn(() => versionUpdateBuilder),
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

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => createListBuilder([])),
          insert: vi.fn(() => approvalInsertBuilder),
        };
      }

      if (table === "estimate_review_cycles") {
        return {
          select: vi.fn(() => reviewCycleSelectBuilders.shift() ?? createListBuilder([])),
          insert: vi.fn(() => reviewCycleInsertBuilder),
        };
      }

      if (table === "estimate_review_comments") {
        return {
          select: vi.fn(() => reviewCommentsBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({
      from,
      profilesBuilder: createProfilesBuilder([
        {
          id: USER_ID,
          full_name: "Nadia Martin",
          work_email: "nadia@example.com",
        },
        {
          id: REVIEWER_ID,
          full_name: "Camille Reviewer",
          work_email: "reviewer@example.com",
        },
      ]),
      rpc: vi.fn(),
    });

    await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: ["99999999-9999-4999-8999-999999999999"],
      submissionMessage: "Verifier la couverture CFO.",
      assignedReviewerUserId: REVIEWER_ID,
    });

    expect(eventRpc).toHaveBeenCalledWith("log_estimate_version_event", {
      p_estimate_version_id: VERSION_ID,
      p_event_type: "approval_submitted",
      p_created_by: USER_ID,
      p_occurred_at: "2026-03-06T09:10:00.000Z",
      p_metadata: expect.objectContaining({
        cycleId: "77777777-7777-4777-8777-777777777777",
        cycleNumber: 1,
        assignedReviewerUserId: REVIEWER_ID,
        requestedApprovalCount: 1,
      }),
    });
    expect(sendApprovalReviewRequestNotification).toHaveBeenCalledWith({
      recipientEmail: "reviewer@example.com",
      reviewerName: "Camille Reviewer",
      requesterName: "Nadia Martin",
      projectName: "Affaire test",
      versionNumber: 1,
      submissionMessage: "Verifier la couverture CFO.",
      ruleLabels: ["Seuil montant HT"],
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

  it("adds affaire register blockers and alerts to approval submission readiness", async () => {
    const membershipBuilder = createMembershipBuilder("admin");
    const versionBuilder = createVersionAccessBuilder();
    const reviewCyclesBuilder = createListBuilder([]);
    const reviewCommentsBuilder = createListBuilder([]);
    const approvalsBuilder = createListBuilder([]);
    const rulesBuilder = createListBuilder([]);
    const itemsBuilder = createListBuilder([
      {
        id: "line-1",
        category_id: null,
        item_type: "line",
        title: "Ligne test",
        parent_id: null,
        position: 1,
      },
    ]);

    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 3,
      criticalOpenEntries: [
        {
          id: "reg-1",
          kind: "missing_piece",
          severity: "critical",
          status: "open",
          text: "CCTP complet manquant",
          scopeLabel: "Affaire test",
        },
      ],
      nonCriticalOpenEntries: [
        {
          id: "reg-2",
          kind: "assumption",
          severity: "warning",
          status: "open",
          text: "Le phasage reste a confirmer",
          scopeLabel: "Affaire test",
        },
      ],
      clarifyWithClientEntries: [
        {
          id: "reg-3",
          kind: "assumption",
          severity: "warning",
          status: "clarify_with_client",
          text: "Valider la variante avec le client",
          scopeLabel: "Affaire test",
        },
      ],
      openAssumptionEntries: [
        {
          id: "reg-2",
          kind: "assumption",
          severity: "warning",
          status: "open",
          text: "Le phasage reste a confirmer",
          scopeLabel: "Affaire test",
        },
      ],
      openMissingPieceEntries: [
        {
          id: "reg-1",
          kind: "missing_piece",
          severity: "critical",
          status: "open",
          text: "CCTP complet manquant",
          scopeLabel: "Affaire test",
        },
      ],
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

    expect(summary.submissionReadiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "register:critical_missing_pieces",
          category: "documents",
        }),
      ])
    );
    expect(summary.submissionReadiness.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "register:open_questions_pending",
          category: "register",
        }),
        expect.objectContaining({
          id: "register:client_clarification_required",
          category: "register",
        }),
      ])
    );
  });

  it("enables resubmission from a treated correction checklist even when no rule stays active", async () => {
    const ruleId = "99999999-9999-4999-8999-999999999999";
    const cycleId = "77777777-7777-4777-8777-777777777777";
    const commentId = "88888888-8888-4888-8888-888888888888";
    const checklistItemId = "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const hypothesisId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const membershipBuilder = createMembershipBuilder("admin");
    const versionBuilder = createVersionAccessBuilder(
      {
        total_ht_cents: 150000,
      },
      {
        user_id: USER_ID,
      }
    );
    const reviewCyclesBuilder = createListBuilder([
      {
        id: cycleId,
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_number: 1,
        requested_by: USER_ID,
        requested_at: "2026-03-01T10:00:00.000Z",
        submission_message: "Verifier les hypotheses CFO.",
        assigned_reviewer_id: REVIEWER_ID,
        decided_by: REVIEWER_ID,
        decision: "changes_requested",
        decided_at: "2026-03-01T10:15:00.000Z",
        carried_over_from_cycle_id: null,
        requested_by_profile: {
          full_name: "Nadia Martin",
        },
        decided_by_profile: {
          full_name: "Camille Reviewer",
        },
        assigned_reviewer_profile: {
          id: REVIEWER_ID,
          full_name: "Camille Reviewer",
          work_email: "reviewer@example.com",
        },
      },
    ]);
    const reviewCommentsBuilder = createListBuilder([
      {
        id: commentId,
        created_at: "2026-03-01T10:15:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_id: cycleId,
        scope_type: "hypothesis",
        scope_id: hypothesisId,
        scope_label: "Hypothese CFO",
        comment: "Documenter l'hypothese avant resoumission.",
        created_by: REVIEWER_ID,
        created_by_profile: {
          full_name: "Camille Reviewer",
        },
      },
    ]);
    const correctionItemsBuilder = createListBuilder([
      {
        id: checklistItemId,
        created_at: "2026-03-01T10:15:00.000Z",
        updated_at: "2026-03-01T11:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_id: cycleId,
        source_comment_id: commentId,
        scope_type: "hypothesis",
        scope_id: hypothesisId,
        scope_label: "Hypothese CFO",
        comment: "Documenter l'hypothese avant resoumission.",
        status: "corrected",
        last_treated_at: "2026-03-01T11:00:00.000Z",
        last_treated_by: USER_ID,
        last_treatment_note: null,
        last_treated_by_profile: {
          full_name: "Nadia Martin",
        },
      },
    ]);
    const correctionEventsBuilder = createListBuilder([
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        created_at: "2026-03-01T11:00:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        cycle_id: cycleId,
        item_id: checklistItemId,
        actor_user_id: USER_ID,
        previous_status: "pending",
        next_status: "corrected",
        note: null,
        actor_profile: {
          full_name: "Nadia Martin",
        },
      },
    ]);
    const approvalsBuilder = createListBuilder([
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        created_at: "2026-03-01T10:05:00.000Z",
        updated_at: "2026-03-01T10:15:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        rule_id: ruleId,
        requested_by: USER_ID,
        approved_by: REVIEWER_ID,
        status: "rejected",
        decided_at: "2026-03-01T10:15:00.000Z",
      },
    ]);
    const hypothesisTargetsBuilder = createListBuilder([
      {
        id: hypothesisId,
        project_id: PROJECT_ID,
        version_id: null,
        kind: "assumption",
        text: "Hypothese CFO",
        scope_type: "project",
        scope_id: null,
        scope_label: "Affaire test",
        severity: "warning",
        status: "open",
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
          select: vi.fn(() => reviewCyclesBuilder),
        };
      }

      if (table === "estimate_review_comments") {
        return {
          select: vi.fn(() => reviewCommentsBuilder),
        };
      }

      if (table === "estimate_review_correction_items") {
        return {
          select: vi.fn(() => correctionItemsBuilder),
        };
      }

      if (table === "estimate_review_correction_events") {
        return {
          select: vi.fn(() => correctionEventsBuilder),
        };
      }

      if (table === "estimate_approvals") {
        return {
          select: vi.fn(() => approvalsBuilder),
        };
      }

      if (table === "estimate_rules") {
        return {
          select: vi.fn(() => createListBuilder([])),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => createListBuilder([])),
        };
      }

      if (table === "affaire_register_entries") {
        return {
          select: vi.fn(() => hypothesisTargetsBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockAuthenticatedSupabase({ from });

    const summary = await getEstimateApprovalSummary(VERSION_ID);

    expect(summary.reasons).toEqual([]);
    expect(summary.correctionChecklist).toMatchObject({
      sourceCycleId: cycleId,
      totalCount: 1,
      pendingCount: 0,
      correctedCount: 1,
      canResubmit: true,
    });
    expect(summary.correctionChecklist?.items[0]?.href).toBe(
      `/dashboard/affaires/${PROJECT_ID}?registerStatus=open&registerKind=assumption&registerFocus=${hypothesisId}`
    );
    expect(summary.permissions.canRequest).toBe(true);
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

  it("journals only the decided rule snapshot for legacy approval decisions", async () => {
    const targetRuleId = "99999999-9999-4999-8999-999999999999";
    const otherRuleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const targetApprovalId = "88888888-8888-4888-8888-888888888888";
    const membershipBuilder = createMembershipBuilder("director");
    const versionBuilder = createVersionAccessBuilder();
    const pendingApprovalBuilder = createListBuilder([
      {
        id: targetApprovalId,
        created_at: "2026-03-03T10:05:00.000Z",
        updated_at: "2026-03-03T10:05:00.000Z",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        rule_id: targetRuleId,
        requested_by: OWNER_ID,
        approved_by: null,
        status: "pending",
        decided_at: null,
      },
    ]);
    const approvalUpdateBuilder = createSingleUpdateBuilder({
      id: targetApprovalId,
      created_at: "2026-03-03T10:05:00.000Z",
      updated_at: "2026-03-03T10:10:00.000Z",
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      rule_id: targetRuleId,
      requested_by: OWNER_ID,
      approved_by: USER_ID,
      status: "approved",
      decided_at: "2026-03-03T10:10:00.000Z",
    });
    const reviewCyclesBuilder = createListBuilder([]);
    const reviewCommentsBuilder = createListBuilder([]);
    const itemsBuilder = createListBuilder([]);
    const rulesBuilder = createListBuilder([
      {
        id: targetRuleId,
        created_at: "2026-03-03T09:00:00.000Z",
        updated_at: "2026-03-03T09:00:00.000Z",
        tenant_id: TENANT_ID,
        rule_type: "require_approval",
        scope_type: "global",
        scope_id: null,
        threshold_value: 100000,
        action: "require_approval",
        is_active: true,
      },
      {
        id: otherRuleId,
        created_at: "2026-03-03T09:00:00.000Z",
        updated_at: "2026-03-03T09:00:00.000Z",
        tenant_id: TENANT_ID,
        rule_type: "require_approval",
        scope_type: "global",
        scope_id: null,
        threshold_value: 200000,
        action: "require_approval",
        is_active: true,
      },
    ]);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    vi.mocked(createOptionalServiceRoleClient)
      .mockReturnValueOnce({
        rpc,
      } as never)
      .mockReturnValueOnce(null as never);

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
          select: vi.fn(() => pendingApprovalBuilder),
          update: vi.fn(() => approvalUpdateBuilder),
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

    await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "approve",
      ruleId: targetRuleId,
    });

    expect(rpc).toHaveBeenCalledWith("log_estimate_version_event", {
      p_estimate_version_id: VERSION_ID,
      p_event_type: "approval_decided",
      p_created_by: USER_ID,
      p_occurred_at: "2026-03-03T10:10:00.000Z",
      p_metadata: expect.objectContaining({
        ruleIds: [targetRuleId],
        rulesTriggered: [
          expect.objectContaining({
            ruleId: targetRuleId,
          }),
        ],
      }),
    });
    expect(
      rpc.mock.calls[0]?.[1]?.p_metadata?.rulesTriggered
    ).toHaveLength(1);
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
          select: vi.fn(() => reviewCycleSelectBuilders.shift() ?? createListBuilder([])),
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

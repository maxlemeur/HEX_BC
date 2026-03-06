import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { submitEstimateApproval } from "@/lib/estimates/rules-engine";
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

function createVersionAccessBuilder() {
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
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: OWNER_ID,
        name: "Affaire test",
        client_name: "Client A",
      },
    },
    error: null,
  });

  return builder;
}

function createListBuilder<T>(data: T[]) {
  const builder = {
    data,
    error: null,
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data,
    error: null,
  });

  return builder;
}

describe("submitEstimateApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      from,
    } as never);

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
      from,
    } as never);

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
});

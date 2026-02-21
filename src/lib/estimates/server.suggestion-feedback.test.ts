import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { saveSuggestionRuleFeedback } from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = USER_ID;
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";

type SupabaseMockConfig = {
  existingUsageCount?: number;
  updatedUsageCount?: number;
};

function createSupabaseMock(config: SupabaseMockConfig = {}) {
  const existingUsageCount = config.existingUsageCount ?? 3;
  const updatedUsageCount = config.updatedUsageCount ?? existingUsageCount + 1;

  const tenantMembershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  tenantMembershipBuilder.eq.mockReturnValue(tenantMembershipBuilder);
  tenantMembershipBuilder.order.mockReturnValue(tenantMembershipBuilder);
  tenantMembershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: "engineer",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const estimateVersionBuilder = {
    eq: vi.fn(),
    single: vi.fn(),
  };
  estimateVersionBuilder.eq.mockReturnValue(estimateVersionBuilder);
  estimateVersionBuilder.single.mockResolvedValue({
    data: {
      id: VERSION_ID,
      project_id: PROJECT_ID,
      status: "draft",
      margin_multiplier: 1,
      tax_rate_bp: 2000,
      updated_at: "2026-02-21T10:00:00.000Z",
      total_ht_cents: 0,
      total_tax_cents: 0,
      total_ttc_cents: 0,
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: OWNER_USER_ID,
        name: "Projet test",
        reference: null,
        client_name: null,
        notes: null,
        is_archived: false,
      },
    },
    error: null,
  });

  const draftLockBuilder = {
    eq: vi.fn(),
    gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "lock-1",
        version_id: VERSION_ID,
        user_id: USER_ID,
        locked_at: "2026-02-21T10:00:00.000Z",
        expires_at: "2099-02-21T10:00:00.000Z",
      },
      error: null,
    }),
  };
  draftLockBuilder.eq.mockReturnValue(draftLockBuilder);
  draftLockBuilder.gt.mockReturnValue(draftLockBuilder);

  const existingRule = {
    id: RULE_ID,
    tenant_id: TENANT_ID,
    user_id: OWNER_USER_ID,
    usage_count: existingUsageCount,
    last_used_at: null,
    name: "Regle test",
  };

  const suggestionRuleSelectBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: existingRule,
      error: null,
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        usage_count: existingUsageCount,
      },
      error: null,
    }),
  };
  suggestionRuleSelectBuilder.eq.mockReturnValue(suggestionRuleSelectBuilder);

  const suggestionRuleUpdateMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      ...existingRule,
      usage_count: updatedUsageCount,
      last_used_at: "2026-02-21T10:01:00.000Z",
    },
    error: null,
  });

  const suggestionRuleUpdateSelect = {
    maybeSingle: suggestionRuleUpdateMaybeSingle,
  };

  const suggestionRuleUpdateBuilder = {
    eq: vi.fn(),
    select: vi.fn(() => suggestionRuleUpdateSelect),
  };
  suggestionRuleUpdateBuilder.eq.mockReturnValue(suggestionRuleUpdateBuilder);

  const suggestionRuleUpdate = vi.fn(() => suggestionRuleUpdateBuilder);

  const supabase = {
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
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => tenantMembershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => estimateVersionBuilder),
        };
      }

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLockBuilder),
        };
      }

      if (table === "estimate_suggestion_rules") {
        return {
          select: vi.fn(() => suggestionRuleSelectBuilder),
          update: suggestionRuleUpdate,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      suggestionRuleUpdate,
      suggestionRuleUpdateBuilderEq: suggestionRuleUpdateBuilder.eq,
    },
  };

  return supabase;
}

describe("saveSuggestionRuleFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments usage_count by 1 when count is omitted", async () => {
    const supabase = createSupabaseMock({
      existingUsageCount: 4,
      updatedUsageCount: 5,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await saveSuggestionRuleFeedback(VERSION_ID, RULE_ID, {
      feedback: "accept",
    });

    expect(result).toMatchObject({
      feedback: "accept",
      suggestion_rule: {
        id: RULE_ID,
        usage_count: 5,
      },
    });

    expect(supabase.__mocks.suggestionRuleUpdate).toHaveBeenCalledTimes(1);
    expect(supabase.__mocks.suggestionRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        usage_count: 5,
      })
    );
    expect(supabase.__mocks.suggestionRuleUpdateBuilderEq).toHaveBeenCalledWith(
      "usage_count",
      4
    );
  });

  it("increments usage_count by count when provided", async () => {
    const supabase = createSupabaseMock({
      existingUsageCount: 2,
      updatedUsageCount: 9,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await saveSuggestionRuleFeedback(VERSION_ID, RULE_ID, {
      feedback: "accept",
      count: 7,
    });

    expect(result).toMatchObject({
      feedback: "accept",
      suggestion_rule: {
        id: RULE_ID,
        usage_count: 9,
      },
    });

    expect(supabase.__mocks.suggestionRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        usage_count: 9,
      })
    );
    expect(supabase.__mocks.suggestionRuleUpdateBuilderEq).toHaveBeenCalledWith(
      "usage_count",
      2
    );
  });

  it("does not increment usage_count when feedback is reject", async () => {
    const supabase = createSupabaseMock({
      existingUsageCount: 6,
      updatedUsageCount: 99,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await saveSuggestionRuleFeedback(VERSION_ID, RULE_ID, {
      feedback: "reject",
      count: 20,
    });

    expect(result).toMatchObject({
      feedback: "reject",
      suggestion_rule: {
        id: RULE_ID,
        usage_count: 6,
      },
    });
    expect(supabase.__mocks.suggestionRuleUpdate).not.toHaveBeenCalled();
  });
});

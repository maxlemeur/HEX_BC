import { describe, expect, it } from "vitest";

import {
  evaluateApprovalSummary,
  evaluateRules,
} from "@/lib/estimates/rules-engine";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

function createRulesEngineSupabaseMock(input: {
  rules: unknown[];
  approvals?: unknown[];
}) {
  const rulesBuilder = {
    eq: () => rulesBuilder,
    order: () =>
      Promise.resolve({
        data: input.rules,
        error: null,
      } satisfies QueryResult),
  };

  const approvalsBuilder = {
    eq: () => approvalsBuilder,
    in: () => approvalsBuilder,
    order: () =>
      Promise.resolve({
        data: input.approvals ?? [],
        error: null,
      } satisfies QueryResult),
  };

  return {
    from: (table: string) => {
      if (table === "estimate_rules") {
        return {
          select: () => rulesBuilder,
        };
      }

      if (table === "estimate_approvals") {
        return {
          select: () => approvalsBuilder,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("rules engine", () => {
  it("raises a blocking violation when min_margin is not met", async () => {
    const supabase = createRulesEngineSupabaseMock({
      rules: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "min_margin",
          scope_type: "global",
          scope_id: null,
          threshold_value: 1500,
          action: "block",
          is_active: true,
        },
      ],
    });

    const result = await evaluateRules({
      supabase: supabase as never,
      tenantId: "22222222-2222-4222-8222-222222222222",
      version: {
        id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        margin_bp: 900,
        margin_multiplier: 1,
        discount_bp: 0,
        total_ht_cents: 100000,
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
        client_name: "Client A",
      },
      items: [],
    });

    expect(result.blockingViolations).toHaveLength(1);
    expect(result.warningViolations).toHaveLength(0);
    expect(result.blockingViolations[0]).toEqual(
      expect.objectContaining({
        rule_type: "min_margin",
        severity: "blocking",
        metric_key: "margin_bp",
        comparator: ">=",
      })
    );
  });

  it("raises a warning violation for max_discount with warn action", async () => {
    const supabase = createRulesEngineSupabaseMock({
      rules: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "max_discount",
          scope_type: "global",
          scope_id: null,
          threshold_value: 500,
          action: "warn",
          is_active: true,
        },
      ],
    });

    const result = await evaluateRules({
      supabase: supabase as never,
      tenantId: "22222222-2222-4222-8222-222222222222",
      version: {
        id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        margin_bp: 1200,
        margin_multiplier: 1,
        discount_bp: 1200,
        total_ht_cents: 100000,
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
        client_name: "Client A",
      },
      items: [],
    });

    expect(result.blockingViolations).toHaveLength(0);
    expect(result.warningViolations).toHaveLength(1);
    expect(result.warningViolations[0]).toEqual(
      expect.objectContaining({
        rule_type: "max_discount",
        severity: "warning",
        metric_key: "discount_bp",
        comparator: "<=",
      })
    );
  });

  it("does not raise violation when require_approval rule is already approved", async () => {
    const ruleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const supabase = createRulesEngineSupabaseMock({
      rules: [
        {
          id: ruleId,
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "require_approval",
          scope_type: "global",
          scope_id: null,
          threshold_value: 100000,
          action: "require_approval",
          is_active: true,
        },
      ],
      approvals: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          created_at: "2026-02-23T10:00:00.000Z",
          updated_at: "2026-02-23T10:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          version_id: "33333333-3333-4333-8333-333333333333",
          rule_id: ruleId,
          requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          approved_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "approved",
          decided_at: "2026-02-23T10:30:00.000Z",
        },
      ],
    });

    const result = await evaluateRules({
      supabase: supabase as never,
      tenantId: "22222222-2222-4222-8222-222222222222",
      version: {
        id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        margin_bp: 1200,
        margin_multiplier: 1,
        discount_bp: 200,
        total_ht_cents: 150000,
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
        client_name: "Client A",
      },
      items: [],
    });

    expect(result.violations).toHaveLength(0);
  });

  it("keeps approved approval violations when explicitly requested for summary projection", async () => {
    const ruleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const supabase = createRulesEngineSupabaseMock({
      rules: [
        {
          id: ruleId,
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "require_approval",
          scope_type: "global",
          scope_id: null,
          threshold_value: 100000,
          action: "require_approval",
          is_active: true,
        },
      ],
      approvals: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          created_at: "2026-02-23T10:00:00.000Z",
          updated_at: "2026-02-23T10:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          version_id: "33333333-3333-4333-8333-333333333333",
          rule_id: ruleId,
          requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          approved_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "approved",
          decided_at: "2026-02-23T10:30:00.000Z",
        },
      ],
    });

    const result = await evaluateRules({
      supabase: supabase as never,
      tenantId: "22222222-2222-4222-8222-222222222222",
      version: {
        id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        margin_bp: 1200,
        margin_multiplier: 1,
        discount_bp: 200,
        total_ht_cents: 150000,
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
        client_name: "Client A",
      },
      items: [],
      preserveApprovedRequiresApproval: true,
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toEqual(
      expect.objectContaining({
        approval_status: "approved",
        rule_type: "require_approval",
      })
    );
  });

  it("surfaces unavailable approval signals when canonical data is missing", async () => {
    const supabase = createRulesEngineSupabaseMock({
      rules: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "critical_exceptions_max",
          scope_type: "global",
          scope_id: null,
          threshold_value: 0,
          action: "require_approval",
          is_active: true,
        },
      ],
    });

    const result = await evaluateRules({
      supabase: supabase as never,
      tenantId: "22222222-2222-4222-8222-222222222222",
      version: {
        id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        margin_bp: 1500,
        margin_multiplier: 1,
        discount_bp: 100,
        total_ht_cents: 90000,
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
        client_name: "Client A",
      },
      items: [],
    });

    expect(result.violations).toHaveLength(0);
    expect(result.unavailableSignals).toEqual([
      expect.objectContaining({
        metric_key: "critical_exceptions_count",
        source_state: "unavailable",
      }),
    ]);
  });

  it("derives approval workflow states from the latest decisions", async () => {
    const baseRule = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      created_at: "2026-02-23T09:00:00.000Z",
      updated_at: "2026-02-23T09:00:00.000Z",
      tenant_id: "22222222-2222-4222-8222-222222222222",
      rule_type: "require_approval",
      scope_type: "global",
      scope_id: null,
      threshold_value: 100000,
      action: "require_approval",
      is_active: true,
    };

    const baseInput = {
      tenantId: "22222222-2222-4222-8222-222222222222",
      version: {
        id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        margin_bp: 1200,
        margin_multiplier: 1,
        discount_bp: 200,
        total_ht_cents: 150000,
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
        client_name: "Client A",
      },
      items: [],
      evaluatedAt: "2026-02-24T08:00:00.000Z",
    };

    const requiredSummary = await evaluateApprovalSummary({
      supabase: createRulesEngineSupabaseMock({
        rules: [baseRule],
      }) as never,
      ...baseInput,
    });
    expect(requiredSummary.approvalStatus).toBe("required");

    const inReviewSummary = await evaluateApprovalSummary({
      supabase: createRulesEngineSupabaseMock({
        rules: [baseRule],
        approvals: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            created_at: "2026-02-23T10:00:00.000Z",
            updated_at: "2026-02-23T10:00:00.000Z",
            tenant_id: "22222222-2222-4222-8222-222222222222",
            version_id: "33333333-3333-4333-8333-333333333333",
            rule_id: baseRule.id,
            requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            approved_by: null,
            status: "pending",
            decided_at: null,
          },
        ],
      }) as never,
      ...baseInput,
    });
    expect(inReviewSummary.approvalStatus).toBe("in_review");

    const approvedSummary = await evaluateApprovalSummary({
      supabase: createRulesEngineSupabaseMock({
        rules: [baseRule],
        approvals: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            created_at: "2026-02-23T10:00:00.000Z",
            updated_at: "2026-02-23T10:00:00.000Z",
            tenant_id: "22222222-2222-4222-8222-222222222222",
            version_id: "33333333-3333-4333-8333-333333333333",
            rule_id: baseRule.id,
            requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            approved_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            status: "approved",
            decided_at: "2026-02-23T10:30:00.000Z",
          },
        ],
      }) as never,
      ...baseInput,
    });
    expect(approvedSummary.approvalStatus).toBe("approved");

    const rejectedSummary = await evaluateApprovalSummary({
      supabase: createRulesEngineSupabaseMock({
        rules: [baseRule],
        approvals: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            created_at: "2026-02-23T10:00:00.000Z",
            updated_at: "2026-02-23T10:00:00.000Z",
            tenant_id: "22222222-2222-4222-8222-222222222222",
            version_id: "33333333-3333-4333-8333-333333333333",
            rule_id: baseRule.id,
            requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            approved_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            status: "rejected",
            decided_at: "2026-02-23T10:30:00.000Z",
          },
        ],
      }) as never,
      ...baseInput,
    });
    expect(rejectedSummary.approvalStatus).toBe("changes_requested");
  });
});

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
  contentRevision?: number;
  takeoffJobs?: unknown[];
  takeoffVersionLinks?: unknown[];
  takeoffDpgfLinks?: unknown[];
  takeoffItems?: unknown[];
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

  const takeoffJobsBuilder = {
    data: input.takeoffJobs ?? [],
    error: null,
    eq: () => takeoffJobsBuilder,
  };

  const takeoffVersionLinksBuilder = {
    data: input.takeoffVersionLinks ?? [],
    error: null,
    eq: () => takeoffVersionLinksBuilder,
  };

  const takeoffDpgfLinksBuilder = {
    data: input.takeoffDpgfLinks ?? [],
    error: null,
    eq: () => takeoffDpgfLinksBuilder,
    in: () => takeoffDpgfLinksBuilder,
  };

  const takeoffItemsBuilder = {
    data: input.takeoffItems ?? [],
    error: null,
    eq: () => takeoffItemsBuilder,
    in: () => takeoffItemsBuilder,
  };

  return {
    rpc: (functionName: string) => {
      if (functionName !== "get_estimate_content_revision") {
        throw new Error(`Unexpected RPC: ${functionName}`);
      }

      return Promise.resolve({
        data: input.contentRevision ?? 1,
        error: null,
      });
    },
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

      if (table === "takeoff_jobs") {
        return {
          select: () => takeoffJobsBuilder,
        };
      }

      if (table === "takeoff_version_links") {
        return {
          select: () => takeoffVersionLinksBuilder,
        };
      }

      if (table === "takeoff_dpgf_links") {
        return {
          select: () => takeoffDpgfLinksBuilder,
        };
      }

      if (table === "takeoff_items") {
        return {
          select: () => takeoffItemsBuilder,
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

  it("does not raise a violation for an approval bound to the current revision", async () => {
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
          approved_content_revision: 1,
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

  it("fails closed when an approval belongs to an older content revision", async () => {
    const ruleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const supabase = createRulesEngineSupabaseMock({
      contentRevision: 2,
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
          approved_content_revision: 1,
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

    expect(result.blockingViolations).toEqual([
      expect.objectContaining({
        rule_id: ruleId,
        approval_status: "missing",
      }),
    ]);
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

  it("accepts a fresh director approval for an unavailable require-approval signal", async () => {
    const ruleId = "99999999-9999-4999-8999-999999999999";
    const supabase = createRulesEngineSupabaseMock({
      contentRevision: 7,
      rules: [
        {
          id: ruleId,
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
      approvals: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          created_at: "2026-02-23T10:00:00.000Z",
          updated_at: "2026-02-23T10:30:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          version_id: "33333333-3333-4333-8333-333333333333",
          rule_id: ruleId,
          requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          approved_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "approved",
          decided_at: "2026-02-23T10:30:00.000Z",
          approved_content_revision: 7,
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
    expect(result.unavailableSignals).toHaveLength(0);
  });

  it.each([
    ["stale", "approved", 6],
    ["unversioned", "approved", null],
    ["rejected", "rejected", 7],
  ] as const)(
    "keeps an unavailable require-approval signal blocking for a %s approval",
    async (_case, status, approvedContentRevision) => {
      const ruleId = "99999999-9999-4999-8999-999999999999";
      const supabase = createRulesEngineSupabaseMock({
        contentRevision: 7,
        rules: [
          {
            id: ruleId,
            created_at: "2026-02-23T09:00:00.000Z",
            updated_at: "2026-02-23T09:00:00.000Z",
            tenant_id: "22222222-2222-4222-8222-222222222222",
            rule_type: "missing_line_evidence_max",
            scope_type: "global",
            scope_id: null,
            threshold_value: 0,
            action: "require_approval",
            is_active: true,
          },
        ],
        approvals: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            created_at: "2026-02-23T10:00:00.000Z",
            updated_at: "2026-02-23T10:30:00.000Z",
            tenant_id: "22222222-2222-4222-8222-222222222222",
            version_id: "33333333-3333-4333-8333-333333333333",
            rule_id: ruleId,
            requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            approved_by:
              status === "approved"
                ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
                : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            status,
            decided_at: "2026-02-23T10:30:00.000Z",
            approved_content_revision: approvedContentRevision,
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
          rule_id: ruleId,
          action: "require_approval",
          source_state: "unavailable",
        }),
      ]);
    }
  );

  it("keeps an unavailable block action fail-closed despite a fresh approval row", async () => {
    const ruleId = "99999999-9999-4999-8999-999999999999";
    const supabase = createRulesEngineSupabaseMock({
      contentRevision: 7,
      rules: [
        {
          id: ruleId,
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "critical_exceptions_max",
          scope_type: "global",
          scope_id: null,
          threshold_value: 0,
          action: "block",
          is_active: true,
        },
      ],
      approvals: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          created_at: "2026-02-23T10:00:00.000Z",
          updated_at: "2026-02-23T10:30:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          version_id: "33333333-3333-4333-8333-333333333333",
          rule_id: ruleId,
          requested_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          approved_by: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "approved",
          decided_at: "2026-02-23T10:30:00.000Z",
          approved_content_revision: 7,
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

    expect(result.unavailableSignals).toEqual([
      expect.objectContaining({
        rule_id: ruleId,
        action: "block",
        source_state: "unavailable",
      }),
    ]);
  });

  it("treats missing DPGF links as zero coverage when takeoff jobs exist", async () => {
    const ruleId = "d0d0d0d0-1111-4111-8111-111111111111";
    const supabase = createRulesEngineSupabaseMock({
      rules: [
        {
          id: ruleId,
          created_at: "2026-02-23T09:00:00.000Z",
          updated_at: "2026-02-23T09:00:00.000Z",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          rule_type: "dpgf_coverage_min",
          scope_type: "global",
          scope_id: null,
          threshold_value: 7500,
          action: "require_approval",
          is_active: true,
        },
      ],
      takeoffJobs: [{ id: "job-1" }],
      takeoffVersionLinks: [],
      takeoffDpgfLinks: [],
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
      items: [
        {
          id: "line-1",
          category_id: null,
          item_type: "line",
        },
        {
          id: "line-2",
          category_id: null,
          item_type: "line",
        },
      ],
    });

    expect(result.unavailableSignals).toHaveLength(0);
    expect(result.violations).toEqual([
      expect.objectContaining({
        rule_id: ruleId,
        metric_key: "dpgf_coverage_bp",
        actual_value: 0,
        approval_status: "missing",
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

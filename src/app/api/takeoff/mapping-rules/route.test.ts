import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, POST } from "@/app/api/takeoff/mapping-rules/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "33333333-3333-4333-8333-333333333333";
const RULE_ID_2 = "44444444-4444-4444-8444-444444444444";

type MappingRuleStoredRow = {
  id: string;
  tenant_id: string;
  name: string;
  match_pattern: string;
  match_type: "exact" | "contains" | "regex";
  action: "rename" | "set_price" | "set_category" | "apply_assembly" | "skip";
  action_params: Record<string, unknown>;
  priority: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseMockOptions = {
  rules?: MappingRuleStoredRow[];
  tenantRole?: string;
};

function baseRule(input?: Partial<MappingRuleStoredRow>): MappingRuleStoredRow {
  return {
    id: input?.id ?? RULE_ID,
    tenant_id: input?.tenant_id ?? TENANT_ID,
    name: input?.name ?? "Renommer tube cuivre",
    match_pattern: input?.match_pattern ?? "tube cuivre",
    match_type: input?.match_type ?? "contains",
    action: input?.action ?? "rename",
    action_params: input?.action_params ?? {
      designation: "Tube cuivre recuit",
    },
    priority: input?.priority ?? 10,
    is_active: input?.is_active ?? true,
    created_by: input?.created_by ?? USER_ID,
    created_at: input?.created_at ?? "2026-02-24T10:00:00.000Z",
    updated_at: input?.updated_at ?? "2026-02-24T10:00:00.000Z",
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const initialRules = options.rules ?? [baseRule(), baseRule({ id: RULE_ID_2, priority: 20 })];
  const tenantRole = options.tenantRole ?? "admin";

  const state = {
    rulesById: new Map<string, MappingRuleStoredRow>(
      initialRules.map((rule) => [rule.id, rule])
    ),
  };

  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: tenantRole,
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  function filterRules(filters: { tenant_id?: string; id?: string }) {
    return [...state.rulesById.values()]
      .filter((rule) => !filters.tenant_id || rule.tenant_id === filters.tenant_id)
      .filter((rule) => !filters.id || rule.id === filters.id)
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }

        return left.created_at.localeCompare(right.created_at);
      });
  }

  function createSelectBuilder() {
    const filters: { tenant_id?: string; id?: string } = {};
    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id") {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const [row] = filterRules(filters);
        return { data: row ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const [row] = filterRules(filters);
        if (!row) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: row, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: MappingRuleStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve({ data: filterRules(filters), error: null }).then(onFulfilled, onRejected),
    };

    return builder;
  }

  const supabase = {
    __state: state,
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
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "takeoff_mapping_rules") {
        return {
          select: vi.fn(() => createSelectBuilder()),
          insert: vi.fn((payload: unknown) => {
            const raw = (Array.isArray(payload) ? payload[0] : payload) as
              | Partial<MappingRuleStoredRow>
              | undefined;
            const row = baseRule({
              id: raw?.id ?? "55555555-5555-4555-8555-555555555555",
              tenant_id: raw?.tenant_id ?? TENANT_ID,
              name: raw?.name ?? "Nouvelle regle",
              match_pattern: raw?.match_pattern ?? "acier",
              match_type: raw?.match_type ?? "contains",
              action: raw?.action ?? "rename",
              action_params: (raw?.action_params as Record<string, unknown>) ?? {
                designation: "Acier galvanise",
              },
              priority: raw?.priority ?? 100,
              is_active: raw?.is_active ?? true,
              created_by: raw?.created_by ?? USER_ID,
              created_at: "2026-02-24T12:00:00.000Z",
              updated_at: "2026-02-24T12:00:00.000Z",
            });

            state.rulesById.set(row.id, row);

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: row, error: null })),
              })),
            };
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async () => ({ data: null, error: null })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return supabase;
}

describe("/api/takeoff/mapping-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET lists tenant mapping rules", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request("http://localhost/api/takeoff/mapping-rules")
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        mapping_rules?: MappingRuleStoredRow[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.mapping_rules).toHaveLength(2);
    expect(body.data?.mapping_rules?.[0]?.priority).toBeLessThanOrEqual(
      body.data?.mapping_rules?.[1]?.priority ?? 0
    );
  });

  it("POST creates a mapping rule", async () => {
    const supabase = createSupabaseMock({ rules: [] });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      new Request("http://localhost/api/takeoff/mapping-rules", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Regle renommage PVC",
          match_pattern: "tube pvc",
          match_type: "contains",
          action: "rename",
          action_params: {
            designation: "Tube PVC pression",
          },
          priority: 5,
          is_active: true,
        }),
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        mapping_rule?: MappingRuleStoredRow;
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.mapping_rule?.name).toBe("Regle renommage PVC");
    expect(body.data?.mapping_rule?.match_type).toBe("contains");
    expect(supabase.__state.rulesById.size).toBe(1);
  });

  it("returns 403 when current user is not tenant admin", async () => {
    const supabase = createSupabaseMock({ tenantRole: "viewer" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request("http://localhost/api/takeoff/mapping-rules")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("returns 422 for invalid create payload", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      new Request("http://localhost/api/takeoff/mapping-rules", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Regle invalide",
          match_pattern: "",
          match_type: "contains",
          action: "rename",
          action_params: {},
          priority: -1,
        }),
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });
});

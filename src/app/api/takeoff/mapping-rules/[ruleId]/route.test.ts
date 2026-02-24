import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  DELETE,
  PATCH,
} from "@/app/api/takeoff/mapping-rules/[ruleId]/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_RULE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    name: input?.name ?? "Regle rename cuivre",
    match_pattern: input?.match_pattern ?? "cuivre",
    match_type: input?.match_type ?? "contains",
    action: input?.action ?? "rename",
    action_params: input?.action_params ?? {
      designation: "Tube cuivre recuit",
    },
    priority: input?.priority ?? 30,
    is_active: input?.is_active ?? true,
    created_by: input?.created_by ?? USER_ID,
    created_at: input?.created_at ?? "2026-02-24T10:00:00.000Z",
    updated_at: input?.updated_at ?? "2026-02-24T10:00:00.000Z",
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const initialRules = options.rules ?? [baseRule()];
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

  function findRule(filters: { tenant_id?: string; id?: string }) {
    return [...state.rulesById.values()].find((rule) => {
      if (filters.tenant_id && rule.tenant_id !== filters.tenant_id) return false;
      if (filters.id && rule.id !== filters.id) return false;
      return true;
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
      maybeSingle: vi.fn(async () => ({ data: findRule(filters) ?? null, error: null })),
      single: vi.fn(async () => {
        const rule = findRule(filters);
        if (!rule) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: rule, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: MappingRuleStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: findRule(filters) ? [findRule(filters) as MappingRuleStoredRow] : [],
          error: null,
        }).then(onFulfilled, onRejected),
    };

    return builder;
  }

  function createUpdateBuilder(payload: unknown) {
    const patch = payload as Partial<MappingRuleStoredRow>;
    const filters: { tenant_id?: string; id?: string } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id") {
          filters[column] = value;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const current = findRule(filters);
        if (!current) {
          return { data: null, error: null };
        }

        const updated: MappingRuleStoredRow = {
          ...current,
          ...patch,
          updated_at: "2026-02-24T12:30:00.000Z",
        };
        state.rulesById.set(updated.id, updated);
        return { data: updated, error: null };
      }),
      single: vi.fn(async () => {
        const current = findRule(filters);
        if (!current) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }

        const updated: MappingRuleStoredRow = {
          ...current,
          ...patch,
          updated_at: "2026-02-24T12:30:00.000Z",
        };
        state.rulesById.set(updated.id, updated);
        return { data: updated, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: MappingRuleStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const current = findRule(filters);
        if (!current) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        }

        const updated: MappingRuleStoredRow = {
          ...current,
          ...patch,
          updated_at: "2026-02-24T12:30:00.000Z",
        };
        state.rulesById.set(updated.id, updated);
        return Promise.resolve({ data: [updated], error: null }).then(
          onFulfilled,
          onRejected
        );
      },
    };

    return builder;
  }

  function createDeleteBuilder() {
    const filters: { tenant_id?: string; id?: string } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id") {
          filters[column] = value;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const current = findRule(filters);
        if (!current) {
          return { data: null, error: null };
        }

        state.rulesById.delete(current.id);
        return { data: { id: current.id }, error: null };
      }),
      single: vi.fn(async () => {
        const current = findRule(filters);
        if (!current) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }

        state.rulesById.delete(current.id);
        return { data: { id: current.id }, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: Array<{ id: string }>; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const current = findRule(filters);
        if (!current) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        }

        state.rulesById.delete(current.id);
        return Promise.resolve({ data: [{ id: current.id }], error: null }).then(
          onFulfilled,
          onRejected
        );
      },
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
          update: vi.fn((payload: unknown) => createUpdateBuilder(payload)),
          delete: vi.fn(() => createDeleteBuilder()),
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

function makeParams(ruleId = RULE_ID) {
  return {
    params: Promise.resolve({ ruleId }),
  };
}

describe("/api/takeoff/mapping-rules/[ruleId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH updates a mapping rule", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request("http://localhost/api/takeoff/mapping-rules/" + RULE_ID, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Regle cuivre prioritaire",
          priority: 1,
          is_active: false,
        }),
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        mapping_rule?: MappingRuleStoredRow;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.mapping_rule?.priority).toBe(1);
    expect(body.data?.mapping_rule?.is_active).toBe(false);
  });

  it("DELETE removes a mapping rule", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request("http://localhost/api/takeoff/mapping-rules/" + RULE_ID, {
        method: "DELETE",
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        deleted?: boolean;
        rule_id?: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.deleted).toBe(true);
    expect(body.data?.rule_id).toBe(RULE_ID);
    expect(supabase.__state.rulesById.has(RULE_ID)).toBe(false);
  });

  it("returns 403 when current user is not tenant admin", async () => {
    const supabase = createSupabaseMock({ tenantRole: "viewer" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request("http://localhost/api/takeoff/mapping-rules/" + RULE_ID, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Regle",
        }),
      }),
      makeParams()
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

  it("returns 404 when PATCH targets an unknown rule", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request("http://localhost/api/takeoff/mapping-rules/" + MISSING_RULE_ID, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Regle inexistante",
        }),
      }),
      makeParams(MISSING_RULE_ID)
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });

  it("returns 404 when DELETE targets an unknown rule", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request("http://localhost/api/takeoff/mapping-rules/" + MISSING_RULE_ID, {
        method: "DELETE",
      }),
      makeParams(MISSING_RULE_ID)
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });

  it("returns 422 for invalid patch payload", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request("http://localhost/api/takeoff/mapping-rules/" + RULE_ID, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          priority: -5,
        }),
      }),
      makeParams()
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

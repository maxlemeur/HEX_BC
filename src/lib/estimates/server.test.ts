import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  bulkUpdateEstimateItems,
  createEstimateItem,
  patchEstimateVersion,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_1 = "55555555-5555-4555-8555-555555555555";
const ITEM_ID_2 = "66666666-6666-4666-8666-666666666666";
const OWNER_USER_ID = "77777777-7777-4777-8777-777777777777";
const CATEGORY_ID = "88888888-8888-4888-8888-888888888888";
const LABOR_ROLE_ID = "99999999-9999-4999-8999-999999999999";
const VERSION_UPDATED_AT = "2026-02-20T10:00:00.000Z";
const NEXT_VERSION_UPDATED_AT = "2026-02-20T10:00:01.000Z";

function createSupabaseMock(input: {
  rpcResult: {
    data: number | null;
    error:
      | {
          code: string;
          message: string;
          details: string | null;
          hint: string | null;
        }
      | null;
  };
  touchResult?: {
    data: {
      id: string;
      updated_at: string;
    } | null;
    error:
      | {
          code: string;
          message: string;
          details: string | null;
          hint: string | null;
        }
      | null;
  };
  auditLogInsertResult?: {
    data: unknown;
    error:
      | {
          code: string;
          message: string;
          details: string | null;
          hint: string | null;
        }
      | null;
  };
}) {
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
      updated_at: VERSION_UPDATED_AT,
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Project",
        reference: null,
        client_name: null,
        notes: null,
        is_archived: false,
      },
    },
    error: null,
  });

  const estimateVersionUpdateSingle = vi.fn().mockResolvedValue(
    input.touchResult ?? {
      data: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
      error: null,
    }
  );

  const estimateVersionUpdateSelect = {
    single: estimateVersionUpdateSingle,
  };

  const estimateVersionUpdateBuilder = {
    eq: vi.fn(),
    select: vi.fn(() => estimateVersionUpdateSelect),
  };

  estimateVersionUpdateBuilder.eq.mockReturnValue(estimateVersionUpdateBuilder);

  const auditLogInsertSelectSingle = vi.fn().mockResolvedValue(
    input.auditLogInsertResult ?? {
      data: null,
      error: null,
    }
  );

  const auditLogInsertSelect = {
    single: auditLogInsertSelectSingle,
  };

  const auditLogInsert = vi.fn(() => ({
    data: null,
    error: null,
    select: vi.fn(() => auditLogInsertSelect),
    single: auditLogInsertSelectSingle,
  }));

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
          update: vi.fn(() => estimateVersionUpdateBuilder),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: auditLogInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue(input.rpcResult),
    __mocks: {
      auditLogInsert,
    },
  };

  return supabase;
}

describe("bulkUpdateEstimateItems regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps stale bulk update RPC errors to a 409 conflict with parsed counts", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: "P0001",
          message: "STALE_BULK_UPDATE_ITEMS",
          details: "expected_count=2,updated_count=1",
          hint: null,
        },
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(VERSION_ID, [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
        {
          id: ITEM_ID_2,
          title: "Ligne 2",
        },
      ], VERSION_UPDATED_AT)
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "La liste de mise a jour est obsolete.",
      details: {
        expected_count: 2,
        updated_count: 1,
      },
    });
  });

  it("falls back to expected_count when stale error details are missing", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: "P0001",
          message: "STALE_BULK_UPDATE_ITEMS",
          details: null,
          hint: null,
        },
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(VERSION_ID, [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
      ], VERSION_UPDATED_AT)
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "La liste de mise a jour est obsolete.",
      details: {
        expected_count: 1,
      },
    });
  });

  it("accepts locked_count stale details emitted by the SQL lock guard", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: "P0001",
          message: "STALE_BULK_UPDATE_ITEMS",
          details: "expected_count=2,locked_count=1",
          hint: null,
        },
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(VERSION_ID, [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
        {
          id: ITEM_ID_2,
          title: "Ligne 2",
        },
      ], VERSION_UPDATED_AT)
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "La liste de mise a jour est obsolete.",
      details: {
        expected_count: 2,
        updated_count: 1,
      },
    });
  });

  it("returns 400 when the concurrency token is missing", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 1,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(
        VERSION_ID,
        [
          {
            id: ITEM_ID_1,
            title: "Ligne 1",
          },
        ],
        undefined
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Jeton de concurrence manquant.",
    });
  });

  it("returns 409 when the concurrency token does not match the version timestamp", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 1,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(
        VERSION_ID,
        [
          {
            id: ITEM_ID_1,
            title: "Ligne 1",
          },
        ],
        "2026-02-20T09:59:59.000Z"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Version modifiee par un autre utilisateur",
      details: {
        updated_at: VERSION_UPDATED_AT,
      },
    });
  });

  it("returns updated_count and refreshed version token when no conflict occurs", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 1,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(
        VERSION_ID,
        [
          {
            id: ITEM_ID_1,
            title: "Ligne 1",
          },
        ],
        VERSION_UPDATED_AT
      )
    ).resolves.toEqual({
      updated_count: 1,
      version: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    });
  });
});

describe("patchEstimateVersion optimistic concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the concurrency token is missing", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          title: "Maj",
        },
        undefined
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Jeton de concurrence manquant.",
    });
  });

  it("returns 409 when the concurrency token does not match", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          title: "Maj",
        },
        "2026-02-20T09:59:59.000Z"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Version modifiee par un autre utilisateur",
      details: {
        updated_at: VERSION_UPDATED_AT,
      },
    });
  });

  it("returns the updated version when token matches", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
      touchResult: {
        data: {
          id: VERSION_ID,
          updated_at: NEXT_VERSION_UPDATED_AT,
        },
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          title: "Maj",
        },
        VERSION_UPDATED_AT
      )
    ).resolves.toEqual({
      version: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    });
  });

  it("accepts coherent totals updates", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
      touchResult: {
        data: {
          id: VERSION_ID,
          updated_at: NEXT_VERSION_UPDATED_AT,
        },
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          total_ht_cents: 100_00,
          total_tax_cents: 20_00,
          total_ttc_cents: 120_00,
        },
        VERSION_UPDATED_AT
      )
    ).resolves.toEqual({
      version: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    });
  });

  it("rejects incoherent totals with an explicit bad request message", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          total_ht_cents: 100_00,
          total_tax_cents: 20_00,
          total_ttc_cents: 119_99,
        },
        VERSION_UPDATED_AT
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: expect.stringMatching(
        /total_ttc_cents.*total_ht_cents.*total_tax_cents/i
      ),
    });
  });

  it("accepts null totals without raising invariant errors", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
      touchResult: {
        data: {
          id: VERSION_ID,
          updated_at: NEXT_VERSION_UPDATED_AT,
        },
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          total_ht_cents: null,
          total_tax_cents: null,
          total_ttc_cents: null,
        } as unknown as Parameters<typeof patchEstimateVersion>[1],
        VERSION_UPDATED_AT
      )
    ).resolves.toEqual({
      version: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    });
  });

  it("logs invariant violations to audit_logs with action invariant_violation", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateVersion(
        VERSION_ID,
        {
          total_ht_cents: 100_00,
          total_tax_cents: 20_00,
          total_ttc_cents: 119_99,
        },
        VERSION_UPDATED_AT
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });

    expect(supabase.__mocks.auditLogInsert).toHaveBeenCalledTimes(1);
    const auditCalls = supabase.__mocks.auditLogInsert.mock.calls as unknown[][];
    const auditPayload = auditCalls[0] ? auditCalls[0][0] : null;
    const firstEntry = Array.isArray(auditPayload)
      ? auditPayload[0]
      : auditPayload;

    expect(firstEntry).toEqual(
      expect.objectContaining({
        action: "invariant_violation",
      })
    );
  });
});

function noRowsError() {
  return {
    code: "PGRST116",
    message: "No rows found",
    details: null,
    hint: null,
  };
}

function createCreateItemSupabaseMock() {
  const categoryEqCalls: Array<[string, unknown]> = [];
  const laborRoleEqCalls: Array<[string, unknown]> = [];

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
        role: "admin",
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
      updated_at: VERSION_UPDATED_AT,
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: OWNER_USER_ID,
        name: "Project",
        reference: null,
        client_name: null,
        notes: null,
        is_archived: false,
      },
    },
    error: null,
  });

  const categoryFilters = new Map<string, unknown>();
  const categoryBuilder = {
    eq: vi.fn((column: string, value: unknown) => {
      categoryEqCalls.push([column, value]);
      categoryFilters.set(column, value);
      return categoryBuilder;
    }),
    single: vi.fn(async () => {
      if (categoryFilters.get("user_id") === OWNER_USER_ID) {
        return {
          data: null,
          error: noRowsError(),
        };
      }

      return {
        data: {
          id: CATEGORY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
        },
        error: null,
      };
    }),
  };

  const laborRoleFilters = new Map<string, unknown>();
  const laborRoleBuilder = {
    eq: vi.fn((column: string, value: unknown) => {
      laborRoleEqCalls.push([column, value]);
      laborRoleFilters.set(column, value);
      return laborRoleBuilder;
    }),
    single: vi.fn(async () => {
      if (laborRoleFilters.get("user_id") === OWNER_USER_ID) {
        return {
          data: null,
          error: noRowsError(),
        };
      }

      return {
        data: {
          id: LABOR_ROLE_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          hourly_rate_cents: 4500,
        },
        error: null,
      };
    }),
  };

  const estimateItemsInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: {
          id: ITEM_ID_1,
        },
        error: null,
      }),
    })),
  }));

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

      if (table === "estimate_categories") {
        return {
          select: vi.fn(() => categoryBuilder),
        };
      }

      if (table === "labor_roles") {
        return {
          select: vi.fn(() => laborRoleBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          insert: estimateItemsInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    categoryEqCalls,
    laborRoleEqCalls,
    estimateItemsInsert,
    supabase,
  };
}

describe("estimate owner resource scoping regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects category IDs that are not owned by the estimate project owner", async () => {
    const { supabase, categoryEqCalls, estimateItemsInsert } = createCreateItemSupabaseMock();

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimateItem(VERSION_ID, {
        item_type: "line",
        title: "Ligne",
        category_id: CATEGORY_ID,
        labor_role_id: null,
        position: 1,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "category_id invalide.",
    });

    expect(categoryEqCalls).toContainEqual(["user_id", OWNER_USER_ID]);
    expect(estimateItemsInsert).not.toHaveBeenCalled();
  });

  it("rejects labor role IDs that are not owned by the estimate project owner", async () => {
    const { supabase, laborRoleEqCalls, estimateItemsInsert } = createCreateItemSupabaseMock();

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimateItem(VERSION_ID, {
        item_type: "line",
        title: "Ligne",
        category_id: null,
        labor_role_id: LABOR_ROLE_ID,
        position: 1,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "labor_role_id invalide.",
    });

    expect(laborRoleEqCalls).toContainEqual(["user_id", OWNER_USER_ID]);
    expect(estimateItemsInsert).not.toHaveBeenCalled();
  });
});

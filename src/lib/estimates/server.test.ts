import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  bulkUpdateEstimateItems,
  createEstimate,
  createEstimateItem,
  insertAssemblyIntoVersion,
  patchEstimateVersion,
  updateEstimateAssembly,
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
const ASSEMBLY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSERTED_SECTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSERTED_LINE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERSION_UPDATED_AT = "2026-02-20T10:00:00.000Z";
const NEXT_VERSION_UPDATED_AT = "2026-02-20T10:00:01.000Z";
const LOCK_EXPIRES_AT = "2099-02-20T10:00:00.000Z";

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
  draftLockUserId?: string | null;
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

  const estimateVersionAccessBuilder = {
    eq: vi.fn(),
    single: vi.fn(),
  };

  estimateVersionAccessBuilder.eq.mockReturnValue(estimateVersionAccessBuilder);
  estimateVersionAccessBuilder.single.mockResolvedValue({
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

  const estimateVersionTokenBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(
      input.touchResult ?? {
        data: {
          id: VERSION_ID,
          updated_at: NEXT_VERSION_UPDATED_AT,
        },
        error: null,
      }
    ),
  };
  estimateVersionTokenBuilder.eq.mockReturnValue(estimateVersionTokenBuilder);

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

  const estimateVersionUpdate = vi.fn(() => estimateVersionUpdateBuilder);

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

  const draftLocksBuilder = {
    eq: vi.fn(),
    gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        input.draftLockUserId === null
          ? null
          : {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: input.draftLockUserId ?? USER_ID,
              locked_at: VERSION_UPDATED_AT,
              expires_at: LOCK_EXPIRES_AT,
            },
      error: null,
    }),
  };
  draftLocksBuilder.eq.mockReturnValue(draftLocksBuilder);
  draftLocksBuilder.gt.mockReturnValue(draftLocksBuilder);

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
        const selectEstimateVersions = vi.fn((columns?: string) => {
          if (columns?.includes("estimate_projects")) {
            return estimateVersionAccessBuilder;
          }

          if (columns === "id, updated_at") {
            return estimateVersionTokenBuilder;
          }

          return estimateVersionAccessBuilder;
        });

        return {
          select: selectEstimateVersions,
          update: estimateVersionUpdate,
        };
      }

      if (table === "audit_logs") {
        return {
          insert: auditLogInsert,
        };
      }

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLocksBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue(input.rpcResult),
    __mocks: {
      auditLogInsert,
      estimateVersionUpdate,
    },
  };

  return supabase;
}

function createCreateEstimateSupabaseMock() {
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

  const estimateProjectInsertSingle = vi.fn().mockResolvedValue({
    data: {
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: "Projet test",
      reference: null,
      client_name: null,
      notes: null,
      is_archived: false,
    },
    error: null,
  });

  const estimateProjectInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: estimateProjectInsertSingle,
    })),
  }));

  const estimateVersionInsertSingle = vi.fn().mockResolvedValue({
    data: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      status: "draft",
      updated_at: NEXT_VERSION_UPDATED_AT,
    },
    error: null,
  });

  const estimateVersionInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: estimateVersionInsertSingle,
    })),
  }));

  const estimateCategoriesUpsert = vi.fn().mockResolvedValue({
    error: null,
  });

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

      if (table === "estimate_projects") {
        return {
          insert: estimateProjectInsert,
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              error: null,
            }),
          })),
        };
      }

      if (table === "estimate_versions") {
        return {
          insert: estimateVersionInsert,
        };
      }

      if (table === "estimate_categories") {
        return {
          upsert: estimateCategoriesUpsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      estimateProjectInsert,
      estimateVersionInsert,
      estimateCategoriesUpsert,
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

  it("requires an active draft lock owned by the current user", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: null,
        error: null,
      },
      draftLockUserId: null,
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
    ).rejects.toMatchObject({
      status: 409,
      code: "LOCK_REQUIRED",
      message: "Un verrou actif est requis pour modifier cette version brouillon.",
      details: {
        lock: null,
      },
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
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

    expect(supabase.rpc).toHaveBeenCalledWith(
      "bulk_update_estimate_items",
      expect.objectContaining({
        target_version_id: VERSION_ID,
        expected_version_updated_at: VERSION_UPDATED_AT,
      })
    );
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

  it("persists discount mode, steps and global coefficient in patch payload", async () => {
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
          discount_mode: "cascade",
          discount_steps: [400, 200],
          global_coefficient: 1.1,
        },
        VERSION_UPDATED_AT
      )
    ).resolves.toEqual({
      version: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    });

    expect(supabase.__mocks.estimateVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        discount_mode: "cascade",
        discount_steps: [400, 200],
        global_coefficient: 1.1,
      })
    );
  });

  it("returns 409 when a concurrent write invalidates the token before update", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
      touchResult: {
        data: null,
        error: noRowsError(),
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
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Version modifiee par un autre utilisateur",
      details: {
        updated_at: VERSION_UPDATED_AT,
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

describe("createEstimate payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists discount_mode, discount_steps and global_coefficient on initial version", async () => {
    const supabase = createCreateEstimateSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimate({
        project: {
          name: "Nouveau projet",
        },
        version: {
          discount_mode: "cascade",
          discount_steps: [250, 100],
          global_coefficient: 1.2,
        },
      })
    ).resolves.toMatchObject({
      project: {
        id: PROJECT_ID,
      },
      version: {
        id: VERSION_ID,
      },
    });

    expect(supabase.__mocks.estimateVersionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        discount_mode: "cascade",
        discount_steps: [250, 100],
        global_coefficient: 1.2,
      })
    );
  });

  it("uses defaults for new discount fields when version payload omits them", async () => {
    const supabase = createCreateEstimateSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await createEstimate({
      project: {
        name: "Projet par defaut",
      },
    });

    expect(supabase.__mocks.estimateVersionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        discount_mode: "simple",
        discount_steps: [],
        global_coefficient: 1,
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

  const draftLocksBuilder = {
    eq: vi.fn(),
    gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "lock-2",
        version_id: VERSION_ID,
        user_id: USER_ID,
        locked_at: VERSION_UPDATED_AT,
        expires_at: LOCK_EXPIRES_AT,
      },
      error: null,
    }),
  };
  draftLocksBuilder.eq.mockReturnValue(draftLocksBuilder);
  draftLocksBuilder.gt.mockReturnValue(draftLocksBuilder);

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

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLocksBuilder),
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

function createAssemblyInsertSupabaseMock(input?: {
  versionStatus?: "draft" | "sent";
  draftLockUserId?: string | null;
  rpcError?: {
    code: string;
    message: string;
    details: string | null;
    hint: string | null;
  } | null;
  validLaborRoleIds?: string[];
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
        role: "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const estimateVersionAccessBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: VERSION_ID,
        project_id: PROJECT_ID,
        status: input?.versionStatus ?? "draft",
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        updated_at: VERSION_UPDATED_AT,
        total_ht_cents: 0,
        total_tax_cents: 0,
        total_ttc_cents: 0,
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
    }),
  };
  estimateVersionAccessBuilder.eq.mockReturnValue(estimateVersionAccessBuilder);

  const draftLocksBuilder = {
    eq: vi.fn(),
    gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        input?.draftLockUserId === null
          ? null
          : {
              id: "lock-assembly",
              version_id: VERSION_ID,
              user_id: input?.draftLockUserId ?? USER_ID,
              locked_at: VERSION_UPDATED_AT,
              expires_at: LOCK_EXPIRES_AT,
            },
      error: null,
    }),
  };
  draftLocksBuilder.eq.mockReturnValue(draftLocksBuilder);
  draftLocksBuilder.gt.mockReturnValue(draftLocksBuilder);

  const assemblyBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: ASSEMBLY_ID,
        tenant_id: TENANT_ID,
        created_by: USER_ID,
        name: "Mur",
        description: null,
        created_at: VERSION_UPDATED_AT,
        updated_at: VERSION_UPDATED_AT,
      },
      error: null,
    }),
  };
  assemblyBuilder.eq.mockReturnValue(assemblyBuilder);

  let assemblyItemsOrderCalls = 0;
  const assemblyItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(() => {
      assemblyItemsOrderCalls += 1;
      if (assemblyItemsOrderCalls >= 2) {
        return Promise.resolve({
          data: [
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              tenant_id: TENANT_ID,
              assembly_id: ASSEMBLY_ID,
              title: "Parpaing",
              unit: "m2",
              k_fo: 1.2,
              k_mo: 1.1,
              labor_role_id: LABOR_ROLE_ID,
              default_quantity: 2,
              position: 1,
              created_at: VERSION_UPDATED_AT,
              updated_at: VERSION_UPDATED_AT,
            },
          ],
          error: null,
        });
      }
      return assemblyItemsBuilder;
    }),
  };
  assemblyItemsBuilder.eq.mockReturnValue(assemblyItemsBuilder);

  const laborRolesBuilder = {
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({
      data: (input?.validLaborRoleIds ?? []).map((id) => ({ id })),
      error: null,
    }),
  };
  laborRolesBuilder.eq.mockReturnValue(laborRolesBuilder);

  const estimateItemsUpdateIn = vi.fn().mockResolvedValue({
    data: null,
    error: null,
  });
  const estimateItemsUpdateBuilder = {
    eq: vi.fn(),
    in: estimateItemsUpdateIn,
  };
  estimateItemsUpdateBuilder.eq.mockReturnValue(estimateItemsUpdateBuilder);

  const estimateItemsSelectIn = vi.fn().mockResolvedValue({
    data: [
      {
        id: INSERTED_SECTION_ID,
        item_type: "section",
      },
      {
        id: INSERTED_LINE_ID,
        item_type: "line",
        labor_role_id: null,
      },
    ],
    error: null,
  });
  const estimateItemsSelectBuilder = {
    eq: vi.fn(),
    in: estimateItemsSelectIn,
  };
  estimateItemsSelectBuilder.eq.mockReturnValue(estimateItemsSelectBuilder);

  const rpc = vi.fn().mockResolvedValue({
    data: [
      {
        id: INSERTED_SECTION_ID,
        item_type: "section",
        parent_id: null,
        position: 2,
        labor_role_id: null,
      },
      {
        id: INSERTED_LINE_ID,
        item_type: "line",
        parent_id: INSERTED_SECTION_ID,
        position: 1,
        labor_role_id: LABOR_ROLE_ID,
      },
    ],
    error: input?.rpcError ?? null,
  });

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
          select: vi.fn(() => estimateVersionAccessBuilder),
        };
      }
      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLocksBuilder),
        };
      }
      if (table === "estimate_assemblies") {
        return {
          select: vi.fn(() => assemblyBuilder),
        };
      }
      if (table === "estimate_assembly_items") {
        return {
          select: vi.fn(() => assemblyItemsBuilder),
        };
      }
      if (table === "labor_roles") {
        return {
          select: vi.fn(() => laborRolesBuilder),
        };
      }
      if (table === "estimate_items") {
        return {
          update: vi.fn(() => estimateItemsUpdateBuilder),
          select: vi.fn(() => estimateItemsSelectBuilder),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc,
    __mocks: {
      estimateItemsUpdateIn,
      estimateItemsSelectIn,
    },
  };

  return supabase;
}

function createAssemblyUpdateSupabaseMock(input?: {
  rpcError?: {
    code: string;
    message: string;
    details: string | null;
    hint: string | null;
  } | null;
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
        role: "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const assemblyBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: ASSEMBLY_ID,
        tenant_id: TENANT_ID,
        created_by: USER_ID,
        name: "Mur",
        description: null,
        created_at: VERSION_UPDATED_AT,
        updated_at: VERSION_UPDATED_AT,
      },
      error: null,
    }),
  };
  assemblyBuilder.eq.mockReturnValue(assemblyBuilder);

  let assemblyItemsOrderCalls = 0;
  const assemblyItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(() => {
      assemblyItemsOrderCalls += 1;
      if (assemblyItemsOrderCalls >= 2) {
        return Promise.resolve({
          data: [
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              tenant_id: TENANT_ID,
              assembly_id: ASSEMBLY_ID,
              title: "Ligne",
              unit: null,
              k_fo: 1,
              k_mo: 1,
              labor_role_id: LABOR_ROLE_ID,
              default_quantity: null,
              position: 1,
              created_at: VERSION_UPDATED_AT,
              updated_at: VERSION_UPDATED_AT,
            },
          ],
          error: null,
        });
      }
      return assemblyItemsBuilder;
    }),
  };
  assemblyItemsBuilder.eq.mockReturnValue(assemblyItemsBuilder);

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
      if (table === "estimate_assemblies") {
        return {
          select: vi.fn(() => assemblyBuilder),
        };
      }
      if (table === "estimate_assembly_items") {
        return {
          select: vi.fn(() => assemblyItemsBuilder),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({
      data: 1,
      error: input?.rpcError ?? null,
    }),
  };

  return supabase;
}

describe("estimate assemblies insertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts assembly items and clears invalid labor roles", async () => {
    const supabase = createAssemblyInsertSupabaseMock({
      validLaborRoleIds: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await insertAssemblyIntoVersion({
      assemblyId: ASSEMBLY_ID,
      versionId: VERSION_ID,
      afterItemId: ITEM_ID_1,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "insert_estimate_assembly_into_version",
      expect.objectContaining({
        p_version_id: VERSION_ID,
        p_assembly_id: ASSEMBLY_ID,
        p_after_item_id: ITEM_ID_1,
      })
    );
    expect(supabase.__mocks.estimateItemsUpdateIn).toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ id: INSERTED_SECTION_ID }),
      expect.objectContaining({ id: INSERTED_LINE_ID }),
    ]);
  });

  it("requires an active draft lock owned by current user", async () => {
    const supabase = createAssemblyInsertSupabaseMock({
      draftLockUserId: null,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      insertAssemblyIntoVersion({
        assemblyId: ASSEMBLY_ID,
        versionId: VERSION_ID,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "LOCK_REQUIRED",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects insertion when version is read only", async () => {
    const supabase = createAssemblyInsertSupabaseMock({
      versionStatus: "sent",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      insertAssemblyIntoVersion({
        assemblyId: ASSEMBLY_ID,
        versionId: VERSION_ID,
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "READ_ONLY",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("maps invalid anchor errors from RPC to BAD_REQUEST", async () => {
    const supabase = createAssemblyInsertSupabaseMock({
      rpcError: {
        code: "P0001",
        message: "after_item_id invalide",
        details: null,
        hint: null,
      },
      validLaborRoleIds: [LABOR_ROLE_ID],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      insertAssemblyIntoVersion({
        assemblyId: ASSEMBLY_ID,
        versionId: VERSION_ID,
        afterItemId: ITEM_ID_1,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "afterItemId invalide.",
    });
  });
});

describe("estimate assemblies updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces assembly items through a single transactional RPC", async () => {
    const supabase = createAssemblyUpdateSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await updateEstimateAssembly(ASSEMBLY_ID, {
      items: [
        {
          title: "Ligne",
          labor_role_id: LABOR_ROLE_ID,
          position: 1,
        },
      ],
    });

    expect(supabase.rpc).toHaveBeenCalledWith("replace_estimate_assembly_items", {
      p_assembly_id: ASSEMBLY_ID,
      p_items: [
        {
          title: "Ligne",
          unit: null,
          k_fo: 1,
          k_mo: 1,
          labor_role_id: LABOR_ROLE_ID,
          default_quantity: null,
          position: 1,
        },
      ],
    });
    expect(result.assembly.id).toBe(ASSEMBLY_ID);
    expect(result.assembly.items).toHaveLength(1);
  });
});

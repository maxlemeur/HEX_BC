import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestHeadersGet } = vi.hoisted(() => ({
  mockRequestHeadersGet: vi.fn(),
}));
const mockServiceRoleRpc = vi.fn();

vi.mock("@/lib/supabase/service-role", () => {
  return {
    createServiceRoleClient: vi.fn(() => ({ rpc: mockServiceRoleRpc })),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/canonical-v2-creation", () => ({
  instantiateCanonicalEstimateV2FromTemplate: vi.fn(),
  persistCanonicalEstimateV2: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: mockRequestHeadersGet,
  })),
}));

import {
  bulkUpdateEstimateItems,
  createEstimate,
  createEstimateItem,
  computeAssemblyMetrics,
  insertAssemblyIntoVersion,
  insertTemplateIntoVersion,
  instantiateEstimateFromTemplate,
  listEstimateItems,
  patchEstimateVersion,
  updateEstimateAssembly,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  instantiateCanonicalEstimateV2FromTemplate,
  persistCanonicalEstimateV2,
} from "@/lib/estimates/canonical-v2-creation";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import type { Database } from "@/types/database";

// Exercise the frozen future contract against the unchanged implementation.
const patchEstimateSettingsPrecode = patchEstimateVersion as unknown as (
  versionId: string,
  input: Parameters<typeof patchEstimateVersion>[1] & {
    expected_content_revision: number;
  },
  concurrencyToken?: string
) => Promise<{
  version: Database["public"]["Tables"]["estimate_versions"]["Row"];
  items: Database["public"]["Tables"]["estimate_items"]["Row"][];
}>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_1 = "55555555-5555-4555-8555-555555555555";
const ITEM_ID_2 = "66666666-6666-4666-8666-666666666666";
const PARENT_ID_1 = "12121212-1212-4121-8121-121212121212";
const OWNER_USER_ID = "77777777-7777-4777-8777-777777777777";
const CATEGORY_ID = "88888888-8888-4888-8888-888888888888";
const LABOR_ROLE_ID = "99999999-9999-4999-8999-999999999999";
const SUPPLY_TYPE_ID = "abababab-abab-4bab-8bab-abababababab";
const ASSEMBLY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSERTED_SECTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSERTED_LINE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEMPLATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEMPLATE_VERSION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const VERSION_UPDATED_AT = "2026-02-20T10:00:00.000Z";
const NEXT_VERSION_UPDATED_AT = "2026-02-20T10:00:01.000Z";
const LOCK_EXPIRES_AT = "2099-02-20T10:00:00.000Z";
const LOCK_SESSION_ID = "abababab-1111-4111-8111-abababababab";
const OTHER_LOCK_SESSION_ID = "abababab-2222-4222-8222-abababababab";

mockRequestHeadersGet.mockImplementation((name: string) =>
  name === ESTIMATE_DRAFT_LOCK_SESSION_HEADER ? LOCK_SESSION_ID : null
);
const ROOT_SECTION_ID = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
const SECOND_LEVEL_SECTION_ID = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";

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
    data: Record<string, unknown> | null;
    error:
      | {
          code: string;
          message: string;
          details: string | null;
          hint: string | null;
        }
      | null;
  };
  recalculationLineItems?: Array<Record<string, unknown>>;
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
  draftLockSessionId?: string | null;
  rejectExclusionsColumn?: boolean;
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
    abortSignal: vi.fn(),
  };

  const estimateVersionAccessResponse = {
    data: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      status: "draft",
      title: null,
      exclusions: null,
      date_devis: "2026-02-20",
      validite_jours: 30,
      currency: "EUR",
      margin_multiplier: 1,
      margin_mode: "fixed",
      margin_bp: 0,
      discount_bp: 0,
      discount_mode: "simple",
      discount_steps: [],
      global_coefficient: 1,
      tax_rate_bp: 2000,
      contractor_role: "principal",
      rounding_mode: "none",
      rounding_step_cents: 1,
      rounding_adjustment_cents: 0,
      total_ht_cents: 0,
      total_tax_cents: 0,
      total_ttc_cents: 0,
      calc_engine_version: 1,
      calc_snapshot_content_revision: null,
      calc_snapshot_context: null,
      snapshot_content_hash: null,
      updated_at: VERSION_UPDATED_AT,
      content_revision: 1,
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
  };
  const estimateVersionFenceBuilder = {
    single: vi.fn().mockResolvedValue(estimateVersionAccessResponse),
  };
  estimateVersionAccessBuilder.eq.mockReturnValue(estimateVersionAccessBuilder);
  estimateVersionAccessBuilder.single.mockResolvedValue(estimateVersionAccessResponse);
  estimateVersionAccessBuilder.abortSignal.mockReturnValue(estimateVersionFenceBuilder);

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

  const estimateVersionUpdate = vi.fn((payload: Record<string, unknown>) => {
    if (
      input.rejectExclusionsColumn &&
      Object.prototype.hasOwnProperty.call(payload, "exclusions")
    ) {
      estimateVersionUpdateSingle.mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'exclusions' column of 'estimate_versions' in the schema cache",
          details: null,
          hint: null,
        },
      });
    }

    return estimateVersionUpdateBuilder;
  });

  estimateVersionUpdateBuilder.eq.mockReturnValue(estimateVersionUpdateBuilder);

  const recalculationItems: Array<Record<string, unknown>> = (input.recalculationLineItems ?? []).map(
    (item, index) => ({
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      position: index + 1,
      parent_id: null,
      title: "Ligne de recalcul",
      labor_role_id: null,
      labor_role_atelier_id: null,
      labor_role_chantier_id: null,
      ...item,
    })
  );
  mockServiceRoleRpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "save_estimate_settings_atomic") {
      throw new Error(`Unexpected settings RPC: ${name}`);
    }
    if (input.rejectExclusionsColumn) {
      return { data: null, error: { code: "PGRST204", message: "Missing exclusions column", details: null, hint: null } };
    }
    const projections = args.p_line_projections as Array<Record<string, unknown>>;
    return {
      data: {
        version: {
          ...estimateVersionAccessResponse.data,
          ...(args.p_settings_patch as Record<string, unknown>),
          ...(args.p_totals as Record<string, unknown>),
          updated_at: NEXT_VERSION_UPDATED_AT,
          content_revision: 2,
        },
        items: recalculationItems.map((item) => ({
          ...item,
          ...projections.find((projection) => projection.id === item.id),
        })),
      },
      error: null,
    };
  });
  const estimateItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn((from: number, to: number) =>
      Promise.resolve({
        data: recalculationItems.slice(from, to + 1),
        count: recalculationItems.length,
        error: null,
      })
    ),
    then: (
      resolve: (value: {
        data: Array<Record<string, unknown>>;
        count: number;
        error: null;
      }) => unknown
    ) =>
      Promise.resolve({
        data: recalculationItems,
        count: recalculationItems.length,
        error: null,
      }).then(resolve),
  };
  estimateItemsBuilder.eq.mockReturnValue(estimateItemsBuilder);
  estimateItemsBuilder.order.mockReturnValue(estimateItemsBuilder);

  const emptyCalculationDependencyBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (
      resolve: (value: { data: unknown[]; error: null }) => unknown
    ) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  emptyCalculationDependencyBuilder.eq.mockReturnValue(emptyCalculationDependencyBuilder);
  emptyCalculationDependencyBuilder.in.mockReturnValue(emptyCalculationDependencyBuilder);
  emptyCalculationDependencyBuilder.order.mockReturnValue(emptyCalculationDependencyBuilder);

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
              session_id: input.draftLockSessionId ?? LOCK_SESSION_ID,
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
            if (
              input.rejectExclusionsColumn &&
              columns.includes("exclusions")
            ) {
              return {
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: "PGRST204",
                    message:
                      "Could not find the 'exclusions' column of 'estimate_versions' in the schema cache",
                    details: null,
                    hint: null,
                  },
                }),
              };
            }
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

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => estimateItemsBuilder),
        };
      }

      if (["labor_roles", "margin_tiers", "feature_flags"].includes(table)) {
        return {
          select: vi.fn(() => emptyCalculationDependencyBuilder),
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

  const persistEstimateCreation = vi.fn().mockResolvedValue({
    data: {
      project: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Projet test",
        reference: null,
        client_name: null,
        notes: null,
        is_archived: false,
      },
      version: {
        id: VERSION_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        version_number: 1,
        status: "draft",
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    },
    error: null,
  });

  const estimateCategoriesUpsert = vi.fn().mockResolvedValue({
    error: null,
  });
  const estimateLaborRolesUpsert = vi.fn().mockResolvedValue({
    error: null,
  });
  const laborRolesReadBuilder = {
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  laborRolesReadBuilder.eq.mockReturnValue(laborRolesReadBuilder);

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
    rpc: persistEstimateCreation,
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => tenantMembershipBuilder),
        };
      }

      if (table === "estimate_categories") {
        return {
          upsert: estimateCategoriesUpsert,
        };
      }

      if (table === "labor_roles") {
        return {
          select: vi.fn(() => laborRolesReadBuilder),
          upsert: estimateLaborRolesUpsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      persistEstimateCreation,
      estimateCategoriesUpsert,
      estimateLaborRolesUpsert,
    },
  };

  mockServiceRoleRpc.mockImplementation(
    (name: string, payload: Record<string, unknown>) =>
      persistEstimateCreation(name, payload)
  );

  return supabase;
}

describe("bulkUpdateEstimateItems regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps batch preflight independent from the optional exclusions column", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: null,
        error: null,
      },
      rejectExclusionsColumn: true,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkUpdateEstimateItems(VERSION_ID, [], VERSION_UPDATED_AT)
    ).resolves.toEqual({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
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
      message: "La liste de mise à jour est obsolete.",
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

  it("rejects writes from another page owned by the same user", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: null,
        error: null,
      },
      draftLockSessionId: OTHER_LOCK_SESSION_ID,
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
      code: "CONFLICT",
      message: "Cette version est déjà verrouillée dans une autre page d'édition.",
      details: {
        lock: {
          user_id: USER_ID,
          session_id: OTHER_LOCK_SESSION_ID,
          is_current_user: true,
          is_current_session: false,
        },
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
      message: "La liste de mise à jour est obsolete.",
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
      message: "La liste de mise à jour est obsolete.",
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
      code: "VERSION_CONFLICT",
      message: "Version modifiée ailleurs (autre onglet, autre session ou autre utilisateur)",
      details: {
        updated_at: VERSION_UPDATED_AT,
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
      patchEstimateSettingsPrecode(
        VERSION_ID,
        {
          expected_content_revision: 1,
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
      patchEstimateSettingsPrecode(
        VERSION_ID,
        {
          expected_content_revision: 1,
          title: "Maj",
        },
        "2026-02-20T09:59:59.000Z"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "Version modifiée ailleurs (autre onglet, autre session ou autre utilisateur)",
      details: {
        updated_at: VERSION_UPDATED_AT,
      },
    });
  });

  it("refuses an unavailable atomic schema without a partial exclusions fallback", async () => {
    const supabase = createSupabaseMock({ rpcResult: { data: 0, error: null }, rejectExclusionsColumn: true });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    await expect(patchEstimateSettingsPrecode(VERSION_ID, {
      expected_content_revision: 1, title: "Maj", exclusions: null,
    }, VERSION_UPDATED_AT)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(mockServiceRoleRpc).toHaveBeenCalledTimes(1);
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("save_estimate_settings_atomic", expect.objectContaining({
      p_settings_patch: expect.objectContaining({ title: "Maj", exclusions: null }),
    }));
    expect(supabase.__mocks.estimateVersionUpdate).not.toHaveBeenCalled();
  });

  it("does not silently drop non-empty exclusions when the atomic schema is unavailable", async () => {
    const supabase = createSupabaseMock({ rpcResult: { data: 0, error: null }, rejectExclusionsColumn: true });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    await expect(patchEstimateSettingsPrecode(VERSION_ID, {
      expected_content_revision: 1, exclusions: "Peinture hors perimetre",
    }, VERSION_UPDATED_AT)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(mockServiceRoleRpc).toHaveBeenCalledTimes(1);
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("save_estimate_settings_atomic", expect.objectContaining({
      p_settings_patch: expect.objectContaining({ exclusions: "Peinture hors perimetre" }),
    }));
    expect(supabase.__mocks.estimateVersionUpdate).not.toHaveBeenCalled();
  });

  it("rejects unsupported patch currency codes", async () => {
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateSettingsPrecode(
        VERSION_ID,
        {
          expected_content_revision: 1,
          currency: "JPY",
        } as unknown as Parameters<typeof patchEstimateSettingsPrecode>[1],
        VERSION_UPDATED_AT
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Devise invalide. Valeurs autorisees: EUR, USD, GBP.",
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
      patchEstimateSettingsPrecode(
        VERSION_ID,
        {
          expected_content_revision: 1,
          discount_mode: "cascade",
          discount_steps: [400, 200],
          global_coefficient: 1.1,
        },
        VERSION_UPDATED_AT
      )
    ).resolves.toMatchObject({
      version: { id: VERSION_ID, updated_at: NEXT_VERSION_UPDATED_AT, content_revision: 2 },
      items: [],
    });

    expect(mockServiceRoleRpc).toHaveBeenCalledWith("save_estimate_settings_atomic",
      expect.objectContaining({
        p_expected_content_revision: 1,
        p_draft_lock_session_id: LOCK_SESSION_ID,
        p_settings_patch: expect.objectContaining({ discount_mode: "cascade", discount_steps: [400, 200], global_coefficient: 1.1 }),
      })
    );
    expect(supabase.__mocks.estimateVersionUpdate).not.toHaveBeenCalled();
  });

  it("recalculates and atomically persists reverse-charge totals when only the contractor role is patched", async () => {
    const updatedVersion = {
      id: VERSION_ID,
      updated_at: NEXT_VERSION_UPDATED_AT,
      contractor_role: "subcontractor",
      total_ht_cents: 10_000,
      total_tax_cents: 0,
      total_ttc_cents: 10_000,
    };
    const supabase = createSupabaseMock({
      rpcResult: {
        data: 0,
        error: null,
      },
      touchResult: {
        data: {
          id: VERSION_ID,
          updated_at: NEXT_VERSION_UPDATED_AT,
          contractor_role: "subcontractor",
          total_ht_cents: 10_000,
          total_tax_cents: 0,
          total_ttc_cents: 10_000,
        },
        error: null,
      },
      recalculationLineItems: [
        {
          id: ITEM_ID_1,
          item_type: "line",
          quantity: 1,
          unit_price_ht_cents: 10_000,
          tax_rate_bp: 2000,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          pu_ht_cents: 10_000,
        },
      ],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateSettingsPrecode(
        VERSION_ID,
        {
          expected_content_revision: 1,
          contractor_role: "subcontractor",
        },
        VERSION_UPDATED_AT
      )
    ).resolves.toMatchObject({
      version: updatedVersion,
      items: [expect.objectContaining({ id: ITEM_ID_1, line_total_ht_cents: 10_000, line_tax_cents: 0, line_total_ttc_cents: 10_000 })],
    });

    expect(mockServiceRoleRpc).toHaveBeenCalledWith(
      "save_estimate_settings_atomic",
      expect.objectContaining({
        p_version_id: VERSION_ID,
        p_tenant_id: TENANT_ID,
        p_expected_updated_at: VERSION_UPDATED_AT,
        p_actor_user_id: USER_ID,
        p_settings_patch: expect.objectContaining({ contractor_role: "subcontractor" }),
        p_expected_content_revision: 1,
        p_draft_lock_session_id: LOCK_SESSION_ID,
        p_totals: expect.objectContaining({
          total_ht_cents: 10_000,
          total_tax_cents: 0,
          total_ttc_cents: 10_000,
        }),
      })
    );
    expect(supabase.__mocks.estimateVersionUpdate).not.toHaveBeenCalled();
  });

  it.each([
    {
      rpcCode: "40001",
      rpcMessage: "ESTIMATE_DRAFT_LOCK_REQUIRED",
      expectedStatus: 409,
      expectedCode: "LOCK_REQUIRED",
    },
    {
      rpcCode: "42501",
      rpcMessage: "ESTIMATE_READ_ONLY",
      expectedStatus: 403,
      expectedCode: "READ_ONLY",
    },
    {
      rpcCode: "P0001",
      rpcMessage: "ESTIMATE_NOT_FOUND",
      expectedStatus: 404,
      expectedCode: "NOT_FOUND",
    },
    {
      rpcCode: "40001",
      rpcMessage: "ESTIMATE_VERSION_CONFLICT",
      expectedStatus: 409,
      expectedCode: "VERSION_CONFLICT",
    },
  ])(
    "preserves the $rpcMessage race outcome from the contractor-role RPC",
    async ({ rpcCode, rpcMessage, expectedStatus, expectedCode }) => {
      const supabase = createSupabaseMock({
        rpcResult: {
          data: 0,
          error: null,
        },
        recalculationLineItems: [
          {
            id: ITEM_ID_1,
            item_type: "line",
            quantity: 1,
            unit_price_ht_cents: 10_000,
            tax_rate_bp: 2000,
            k_fo: 1,
            h_mo: 0,
            h_mo_majoration: 1,
            k_mo: 1,
            pu_ht_cents: 10_000,
          },
        ],
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
      mockServiceRoleRpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: rpcCode,
          message: rpcMessage,
          details: null,
          hint: null,
        },
      });

      await expect(
        patchEstimateSettingsPrecode(
          VERSION_ID,
          {
            expected_content_revision: 1,
            contractor_role: "subcontractor",
          },
          VERSION_UPDATED_AT
        )
      ).rejects.toMatchObject({
        status: expectedStatus,
        code: expectedCode,
      });
    }
  );

  it("returns 409 when the atomic write loses its revision comparison", async () => {
    const supabase = createSupabaseMock({ rpcResult: { data: 0, error: null } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    mockServiceRoleRpc.mockResolvedValueOnce({ data: null, error: {
      code: "40001", message: "ESTIMATE_VERSION_CONFLICT", details: null, hint: null,
    } });
    await expect(patchEstimateSettingsPrecode(VERSION_ID, {
      expected_content_revision: 1, title: "Maj",
    }, VERSION_UPDATED_AT)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(mockServiceRoleRpc).toHaveBeenCalledTimes(1);
    expect(supabase.__mocks.estimateVersionUpdate).not.toHaveBeenCalled();
  });

  it("prevents caller totals from overriding the authoritative calculation", async () => {
    const supabase = createSupabaseMock({ rpcResult: { data: 0, error: null } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    await expect(patchEstimateSettingsPrecode(VERSION_ID, {
      expected_content_revision: 1, total_ht_cents: 100_00, total_tax_cents: 20_00, total_ttc_cents: 119_99,
    }, VERSION_UPDATED_AT)).resolves.toMatchObject({
      version: { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, content_revision: 2 }, items: [],
    });
    expect(mockServiceRoleRpc).toHaveBeenCalledWith("save_estimate_settings_atomic", expect.objectContaining({
      p_totals: { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, rounding_adjustment_cents: 0 },
    }));
    const settings = mockServiceRoleRpc.mock.calls[0]?.[1].p_settings_patch;
    expect(settings).not.toHaveProperty("total_ht_cents");
    expect(settings).not.toHaveProperty("total_tax_cents");
    expect(settings).not.toHaveProperty("total_ttc_cents");
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
      patchEstimateSettingsPrecode(
        VERSION_ID,
        {
          expected_content_revision: 1,
          total_ht_cents: null,
          total_tax_cents: null,
          total_ttc_cents: null,
        } as unknown as Parameters<typeof patchEstimateSettingsPrecode>[1],
        VERSION_UPDATED_AT
      )
    ).resolves.toMatchObject({
      version: { id: VERSION_ID, updated_at: NEXT_VERSION_UPDATED_AT, total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, content_revision: 2 }, items: [],
    });
  });

  it("rejects an incoherent atomic confirmation without acknowledging or retrying the write", async () => {
    const supabase = createSupabaseMock({ rpcResult: { data: 0, error: null } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    mockServiceRoleRpc.mockResolvedValueOnce({ data: { version: {
      id: VERSION_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID, status: "draft",
      updated_at: NEXT_VERSION_UPDATED_AT, content_revision: 2,
      total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 1, rounding_adjustment_cents: 0,
    }, items: [] }, error: null });
    await expect(patchEstimateSettingsPrecode(VERSION_ID, {
      expected_content_revision: 1, title: "Maj",
    }, VERSION_UPDATED_AT)).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(mockServiceRoleRpc).toHaveBeenCalledTimes(1);
    expect(supabase.__mocks.estimateVersionUpdate).not.toHaveBeenCalled();
  });
});

describe("createEstimate payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(persistCanonicalEstimateV2).mockResolvedValue({
      project: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Projet test",
      },
      version: {
        id: VERSION_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        status: "draft",
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
      insertedLineCount: 0,
      insertedSectionCount: 0,
      rootSectionId: null,
    } as never);
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
          max_section_depth: 3,
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

    expect(persistCanonicalEstimateV2).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          discount_mode: "cascade",
          discount_steps: [250, 100],
          global_coefficient: 1.2,
        }),
        source: { kind: "blank", importId: null },
      })
    );
  });

  it("claims a linked import in the same canonical creation transaction", async () => {
    const supabase = createCreateEstimateSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await createEstimate({
      project: {
        name: "Projet depuis import non exploitable",
      },
      linked_import_id: "abababab-abab-4bab-8bab-abababababab",
    });

    expect(persistCanonicalEstimateV2).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ kind: "new" }),
        source: {
          kind: "blank",
          importId: "abababab-abab-4bab-8bab-abababababab",
        },
      })
    );
  });

  it("rejects unsupported create currency codes", async () => {
    const supabase = createCreateEstimateSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimate({
        project: {
          name: "Projet invalide",
        },
        version: {
          currency: "JPY",
        } as unknown as NonNullable<Parameters<typeof createEstimate>[0]["version"]>,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Devise invalide. Valeurs autorisees: EUR, USD, GBP.",
    });

    expect(persistCanonicalEstimateV2).not.toHaveBeenCalled();
  });

  it("rejects linked_dpgf_source creation mode when project_id is missing", async () => {
    const supabase = createCreateEstimateSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimate({
        project: {
          name: "Projet sans ID",
        },
        creation_mode: "linked_dpgf_source",
      } as Parameters<typeof createEstimate>[0])
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "creation_mode=linked_dpgf_source requiert project_id.",
    });

    expect(persistCanonicalEstimateV2).not.toHaveBeenCalled();
  });
});

describe("instantiateEstimateFromTemplate with existing project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(instantiateCanonicalEstimateV2FromTemplate).mockResolvedValue({
      project: { id: PROJECT_ID },
      version: { id: TEMPLATE_VERSION_ID },
      insertedLineCount: 1,
      insertedSectionCount: 0,
      rootSectionId: null,
    } as never);
  });

  it("maps inaccessible target project errors to NOT_FOUND", async () => {
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
    const latestProjectVersionBuilder = {
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn(),
    };
    latestProjectVersionBuilder.eq.mockReturnValue(latestProjectVersionBuilder);
    latestProjectVersionBuilder.order.mockReturnValue(latestProjectVersionBuilder);
    latestProjectVersionBuilder.limit.mockReturnValue(latestProjectVersionBuilder);
    latestProjectVersionBuilder.maybeSingle.mockResolvedValue({
      data: {
        id: VERSION_ID,
      },
      error: null,
    });

    vi.mocked(instantiateCanonicalEstimateV2FromTemplate).mockRejectedValue(
      new Error("ESTIMATE_CANONICAL_V2_PROJECT_NOT_FOUND")
    );
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
            select: vi.fn(() => latestProjectVersionBuilder),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      instantiateEstimateFromTemplate(TEMPLATE_ID, {
        project_id: PROJECT_ID,
      })
    ).rejects.toMatchObject({
      status: 404,
      code: "ESTIMATE_TEMPLATE_TARGET_PROJECT_NOT_FOUND",
    });
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
      max_section_depth: 1,
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

  // Retained payload/owner regressions only. This fake datastore does not prove
  // atomicity; the native and ordinary HTTP suites establish that separately.
  const createItemRpc = vi.fn(async (name: string, payload: {
    p_item: Record<string, unknown>;
    p_version_id: string;
    p_version_patch: Record<string, number>;
  }) => {
    if (name !== "atomic_create_estimate_item") {
      throw new Error(`Unexpected RPC: ${name}`);
    }
    return {
      data: {
        item: { ...payload.p_item, tenant_id: TENANT_ID, version_id: VERSION_ID },
        version: { id: VERSION_ID, updated_at: NEXT_VERSION_UPDATED_AT },
        totals: payload.p_version_patch,
      },
      error: null,
    };
  });
  const calculationItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  calculationItemsBuilder.eq.mockReturnValue(calculationItemsBuilder);
  calculationItemsBuilder.order.mockReturnValue(calculationItemsBuilder);
  const featureFlagBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  featureFlagBuilder.eq.mockReturnValue(featureFlagBuilder);
  const estimateItemsParentBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: PARENT_ID_1,
        version_id: VERSION_ID,
        item_type: "section",
        parent_id: null,
      },
      error: null,
    }),
  };
  estimateItemsParentBuilder.eq.mockReturnValue(estimateItemsParentBuilder);

  const estimateItemsHierarchyBuilder = {
    eq: vi.fn(),
    then: (
      resolve: (value: {
        data: Array<{ id: string; parent_id: string | null; item_type: "section" | "line" }>;
        error: null;
      }) => void
    ) =>
      resolve({
        data: [
          {
            id: PARENT_ID_1,
            parent_id: null,
            item_type: "section",
          },
        ],
        error: null,
      }),
  };
  estimateItemsHierarchyBuilder.eq.mockReturnValue(estimateItemsHierarchyBuilder);

  const draftLocksBuilder = {
    eq: vi.fn(),
    gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "lock-2",
        version_id: VERSION_ID,
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        session_id: LOCK_SESSION_ID,
        locked_at: VERSION_UPDATED_AT,
        expires_at: LOCK_EXPIRES_AT,
      },
      error: null,
    }),
  };
  draftLocksBuilder.eq.mockReturnValue(draftLocksBuilder);
  draftLocksBuilder.gt.mockReturnValue(draftLocksBuilder);

  const supabase = {
    rpc: createItemRpc,
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
          select: vi.fn((columns: string) => {
            if (columns === "*") return calculationItemsBuilder;
            if (columns === "id, version_id, item_type, parent_id") {
              return estimateItemsParentBuilder;
            }
            if (columns === "id, parent_id, item_type") {
              return estimateItemsHierarchyBuilder;
            }
            throw new Error(`Unexpected estimate_items select columns: ${columns}`);
          }),
        };
      }

      if (table === "feature_flags") {
        return { select: vi.fn(() => featureFlagBuilder) };
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
    createItemRpc,
    supabase,
  };
}

function createListEstimateItemsSupabaseMock() {
  const SOURCE_VERSION_ID = "10101010-1010-4010-8010-101010101010";

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
    abortSignal: vi.fn(),
    single: vi.fn(),
  };
  estimateVersionBuilder.eq.mockReturnValue(estimateVersionBuilder);
  estimateVersionBuilder.abortSignal.mockReturnValue(estimateVersionBuilder);
  estimateVersionBuilder.single.mockResolvedValue({
    data: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      content_revision: 1,
      project_id: PROJECT_ID,
      status: "draft",
      margin_mode: "coefficient",
      margin_multiplier: 1,
      tax_rate_bp: 2000,
      updated_at: VERSION_UPDATED_AT,
      total_ht_cents: 0,
      total_tax_cents: 0,
      total_ttc_cents: 0,
      parent_version_id: null,
      variant_label: null,
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

  const estimateVersionNumbersBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  estimateVersionNumbersBuilder.eq.mockReturnValue(estimateVersionNumbersBuilder);
  estimateVersionNumbersBuilder.in.mockResolvedValue({
    data: [
      {
        id: SOURCE_VERSION_ID,
        version_number: 1,
      },
    ],
    error: null,
  });

  const estimateItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  estimateItemsBuilder.eq.mockReturnValue(estimateItemsBuilder);
  estimateItemsBuilder.order.mockReturnValue(estimateItemsBuilder);
  const estimateItemsResult = {
    data: [
      {
        id: ITEM_ID_1,
        item_type: "line",
        quantity: 12,
        source_provider: "takeoff",
        source_job_id: ITEM_ID_1,
      },
      {
        id: ITEM_ID_2,
        item_type: "line",
        quantity: 5,
        source_provider: "takeoff",
        source_job_id: ITEM_ID_2,
      },
      {
        id: INSERTED_LINE_ID,
        item_type: "line",
        quantity: 3,
        source_provider: "manual",
        source_job_id: null,
      },
    ],
    error: null,
  };
  Object.assign(estimateItemsBuilder, {
    then: (resolve: (value: typeof estimateItemsResult) => unknown) => Promise.resolve(estimateItemsResult).then(resolve),
  });
  estimateItemsBuilder.range.mockImplementation((from: number, to: number) => Promise.resolve({
    ...estimateItemsResult,
    data: estimateItemsResult.data.slice(from, to + 1),
    count: estimateItemsResult.data.length,
  }));

  const takeoffJobsBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  takeoffJobsBuilder.eq.mockReturnValue(takeoffJobsBuilder);
  takeoffJobsBuilder.in.mockResolvedValue({
    data: [
      {
        id: ITEM_ID_1,
        level: "A",
        completed_at: "2026-02-25T09:45:00.000Z",
        created_at: "2026-02-25T09:00:00.000Z",
      },
      {
        id: ITEM_ID_2,
        level: "B",
        completed_at: null,
        created_at: "2026-02-24T08:00:00.000Z",
      },
    ],
    error: null,
  });

  const takeoffVersionLinksBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  takeoffVersionLinksBuilder.eq.mockReturnValue(takeoffVersionLinksBuilder);
  takeoffVersionLinksBuilder.in.mockResolvedValue({
    data: [
      {
        takeoff_job_id: ITEM_ID_1,
        source_version_id: SOURCE_VERSION_ID,
        target_version_id: VERSION_ID,
        linked_at: "2026-02-25T10:00:00.000Z",
      },
    ],
    error: null,
  });

  const draftApplicationsBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  draftApplicationsBuilder.eq.mockReturnValue(draftApplicationsBuilder);
  draftApplicationsBuilder.in.mockResolvedValue({
    data: [],
    error: null,
  });

  const generatedOuvrageApplicationsBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  generatedOuvrageApplicationsBuilder.eq.mockReturnValue(
    generatedOuvrageApplicationsBuilder
  );
  generatedOuvrageApplicationsBuilder.in.mockResolvedValue({
    data: [],
    error: null,
  });

  const versionZeroApplicationsBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  versionZeroApplicationsBuilder.eq.mockReturnValue(versionZeroApplicationsBuilder);
  versionZeroApplicationsBuilder.in.mockResolvedValue({
    data: [],
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

      if (table === "estimate_versions") {
        return {
          select: vi.fn((columns?: string) => {
            if (typeof columns === "string" && columns.includes("version_number")) {
              return estimateVersionNumbersBuilder;
            }

            return estimateVersionBuilder;
          }),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => estimateItemsBuilder),
        };
      }

      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => takeoffJobsBuilder),
        };
      }

      if (table === "takeoff_version_links") {
        return {
          select: vi.fn(() => takeoffVersionLinksBuilder),
        };
      }

      if (table === "estimate_structure_draft_applications") {
        return {
          select: vi.fn(() => draftApplicationsBuilder),
        };
      }

      if (table === "estimate_generated_ouvrage_applications") {
        return {
          select: vi.fn(() => generatedOuvrageApplicationsBuilder),
        };
      }

      if (table === "estimate_version_zero_applications") {
        return {
          select: vi.fn(() => versionZeroApplicationsBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    takeoffJobsIn: takeoffJobsBuilder.in,
    takeoffVersionLinksIn: takeoffVersionLinksBuilder.in,
  };
}

describe("estimate item source provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists full takeoff provenance when provided", async () => {
    const { supabase, createItemRpc } = createCreateItemSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await createEstimateItem(VERSION_ID, {
      item_type: "section",
      position: 1,
      source_provider: "takeoff",
      source_job_id: ITEM_ID_2,
      source_file_name: "quantif-lot-01.pdf",
      source_page: 12,
    });

    expect(createItemRpc).toHaveBeenCalledWith(
      "atomic_create_estimate_item",
      expect.objectContaining({
        p_item: expect.objectContaining({
          source_provider: "takeoff",
          source_job_id: ITEM_ID_2,
          source_file_name: "quantif-lot-01.pdf",
          source_page: 12,
        }),
      })
    );
  });

  it("creates an unlinked line without querying a missing product_id column", async () => {
    const { supabase, createItemRpc } = createCreateItemSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createEstimateItem(VERSION_ID, {
      item_type: "line",
      parent_id: PARENT_ID_1,
      position: 1,
      title: "Ligne sans produit",
      product_id: null,
    });

    const insertPayload = createItemRpc.mock.calls[0]![1].p_item;
    expect(insertPayload).not.toHaveProperty("product_id");
    expect(result).toMatchObject({
      item: { id: insertPayload.id },
      version: {
        id: VERSION_ID,
        updated_at: NEXT_VERSION_UPDATED_AT,
      },
    });
  });

  it("hydrates source level and extraction date from takeoff jobs", async () => {
    const { supabase, takeoffJobsIn, takeoffVersionLinksIn } =
      createListEstimateItemsSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listEstimateItems(VERSION_ID);

    expect(takeoffJobsIn).toHaveBeenCalledWith("id", [ITEM_ID_1, ITEM_ID_2]);
    expect(takeoffVersionLinksIn).toHaveBeenCalledWith("takeoff_job_id", [
      ITEM_ID_1,
      ITEM_ID_2,
    ]);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ITEM_ID_1,
          source_level: "A",
          source_extracted_at: "2026-02-25T09:45:00.000Z",
          source_version_number: 1,
          line_truth: expect.objectContaining({
            source: expect.objectContaining({
              label: "Plan / métré",
            }),
            qtyStatus: expect.objectContaining({
              code: "measured",
            }),
            confidence: expect.objectContaining({
              label: "forte",
            }),
          }),
        }),
        expect.objectContaining({
          id: ITEM_ID_2,
          source_level: "B",
          source_extracted_at: "2026-02-24T08:00:00.000Z",
          source_version_number: null,
          line_truth: expect.objectContaining({
            confidence: expect.objectContaining({
              label: "moyenne",
            }),
          }),
        }),
        expect.objectContaining({
          id: INSERTED_LINE_ID,
          line_truth: expect.objectContaining({
            source: expect.objectContaining({
              label: "Saisie manuelle",
            }),
            qtyStatus: expect.objectContaining({
              code: "assumed",
            }),
          }),
        }),
      ])
    );
  });
});

describe("estimate owner resource scoping regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects category IDs that are not owned by the estimate project owner", async () => {
    const { supabase, categoryEqCalls, createItemRpc } = createCreateItemSupabaseMock();

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimateItem(VERSION_ID, {
        item_type: "line",
        parent_id: PARENT_ID_1,
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
    expect(createItemRpc).not.toHaveBeenCalled();
  });

  it("rejects labor role IDs that are not owned by the estimate project owner", async () => {
    const { supabase, laborRoleEqCalls, createItemRpc } = createCreateItemSupabaseMock();

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimateItem(VERSION_ID, {
        item_type: "line",
        parent_id: PARENT_ID_1,
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
    expect(createItemRpc).not.toHaveBeenCalled();
  });
});

function createAssemblyInsertSupabaseMock(input?: {
  versionStatus?: "draft" | "sent";
  lineItems?: Array<Record<string, unknown>>;
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
        tenant_id: TENANT_ID,
        content_revision: 1,
        calc_engine_version: 1,
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
              session_id: LOCK_SESSION_ID,
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
    in: vi.fn(),
    is: vi.fn().mockResolvedValue({ data: [], error: null }),
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
  assemblyItemsBuilder.in.mockReturnValue(assemblyItemsBuilder);

  let assemblyMembersOrderCalls = 0;
  const assemblyMembersBuilder = {
    eq: vi.fn(),
    order: vi.fn(() => {
      assemblyMembersOrderCalls += 1;
      if (assemblyMembersOrderCalls % 2 === 0) {
        return Promise.resolve({ data: [], error: null });
      }
      return assemblyMembersBuilder;
    }),
  };
  assemblyMembersBuilder.eq.mockReturnValue(assemblyMembersBuilder);


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

  const insertedItems: Array<Record<string, unknown>> = [
    { id: INSERTED_SECTION_ID, tenant_id: TENANT_ID, version_id: VERSION_ID, item_type: "section", parent_id: null, position: 2 },
    ...(input?.lineItems ?? [{ id: INSERTED_LINE_ID, item_type: "line", labor_role_id: null, quantity: 2, unit_price_ht_cents: 2500, k_fo: 1, h_mo: 0, k_mo: 1, tax_rate_bp: 2000 }]).map((item) => ({
      tenant_id: TENANT_ID, version_id: VERSION_ID, parent_id: INSERTED_SECTION_ID, position: 1, ...item,
    })),
  ];
  const estimateItemsSelectBuilder = {
    eq: vi.fn(), order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: insertedItems.filter((item) => item.item_type === "line"), error: null }),
  };
  estimateItemsSelectBuilder.eq.mockReturnValue(estimateItemsSelectBuilder);
  estimateItemsSelectBuilder.order.mockReturnValue(estimateItemsSelectBuilder);
  const emptyDependencyBuilder = {
    eq: vi.fn(), in: vi.fn(), order: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  emptyDependencyBuilder.eq.mockReturnValue(emptyDependencyBuilder);
  emptyDependencyBuilder.in.mockReturnValue(emptyDependencyBuilder);
  emptyDependencyBuilder.order.mockReturnValue(emptyDependencyBuilder);

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "insert_estimate_assembly_into_version") return { data: insertedItems, error: input?.rpcError ?? null };
    if (name === "finalize_estimate_assembly_calculation") {
      const projections = args.p_item_updates as Array<Record<string, unknown>>;
      return { data: {
        items: insertedItems.map((item) => ({ ...item, ...projections.find((projection) => projection.id === item.id) })),
        version: { id: VERSION_ID, updated_at: NEXT_VERSION_UPDATED_AT, content_revision: 2 },
        totals: args.p_version_patch,
      }, error: null };
    }
    throw new Error(`Unexpected assembly RPC: ${name}`);
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
      if (table === "estimate_assembly_members") {
        return {
          select: vi.fn(() => assemblyMembersBuilder),
        };
      }
      if (table === "labor_roles") {
        return {
          select: vi.fn(() => laborRolesBuilder),
        };
      }
      if (["feature_flags", "margin_tiers"].includes(table)) return { select: vi.fn(() => emptyDependencyBuilder) };
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
      assemblyItemsBuilder,
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
  const rpc = vi.fn().mockResolvedValue({
    data: 1,
    error: input?.rpcError ?? null,
  });
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
        ds_cents: 2149,
        avg_time_hours: 0.5,
        created_at: VERSION_UPDATED_AT,
        updated_at: VERSION_UPDATED_AT,
      },
      error: null,
    }),
  };
  assemblyBuilder.eq.mockReturnValue(assemblyBuilder);

  let latestDirectCostCents = 1647;
  let latestLaborHours: number | null = 0.5;
  const assemblyUpdateBuilder = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockImplementation(async () => ({
      data: {
        id: ASSEMBLY_ID,
        tenant_id: TENANT_ID,
        created_by: USER_ID,
        name: "Mur",
        description: null,
        ds_cents: latestDirectCostCents,
        avg_time_hours: latestLaborHours,
        created_at: VERSION_UPDATED_AT,
        updated_at: VERSION_UPDATED_AT,
      },
      error: null,
    })),
  };
  assemblyUpdateBuilder.eq.mockReturnValue(assemblyUpdateBuilder);
  assemblyUpdateBuilder.select.mockReturnValue(assemblyUpdateBuilder);
  const assemblyUpdate = vi.fn(
    (payload: { ds_cents?: number; avg_time_hours?: number | null }) => {
      if ("ds_cents" in payload) {
        latestDirectCostCents = payload.ds_cents ?? 0;
      }
      if ("avg_time_hours" in payload) {
        latestLaborHours = payload.avg_time_hours ?? null;
      }
      return assemblyUpdateBuilder;
    }
  );

  const laborRolesBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  laborRolesBuilder.eq.mockReturnValue(laborRolesBuilder);
  laborRolesBuilder.in.mockResolvedValue({
    data: [{ id: LABOR_ROLE_ID, hourly_rate_cents: 3000 }],
    error: null,
  });

  let assemblyItemsOrderCalls = 0;
  const assemblyItemsBuilder = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn().mockResolvedValue({ data: [], error: null }),
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
  assemblyItemsBuilder.in.mockReturnValue(assemblyItemsBuilder);

  let assemblyMembersOrderCalls = 0;
  const assemblyMembersBuilder = {
    eq: vi.fn(),
    order: vi.fn(() => {
      assemblyMembersOrderCalls += 1;
      if (assemblyMembersOrderCalls % 2 === 0) {
        return Promise.resolve({ data: [], error: null });
      }
      return assemblyMembersBuilder;
    }),
  };
  assemblyMembersBuilder.eq.mockReturnValue(assemblyMembersBuilder);


  const assemblyItemsUpsert = vi.fn().mockResolvedValue({
    data: null,
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
      if (table === "estimate_assemblies") {
        return {
          select: vi.fn(() => assemblyBuilder),
          update: assemblyUpdate,
        };
      }
      if (table === "estimate_assembly_items") {
        return {
          select: vi.fn(() => assemblyItemsBuilder),
          upsert: assemblyItemsUpsert,
        };
      }
      if (table === "estimate_assembly_members") {
        return {
          select: vi.fn(() => assemblyMembersBuilder),
        };
      }
      if (table === "labor_roles") {
        return {
          select: vi.fn(() => laborRolesBuilder),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc,
    __mocks: {
      assemblyUpdate,
      assemblyItemsUpsert,
    },
  };

  return supabase;
}

describe("estimate assembly metrics", () => {
  it("uses K FO for supplies and K MO for labor without a separate loss factor", () => {
    const metrics = computeAssemblyMetrics(
      [
        {
          title: "Tube inox",
          position: 1,
          cost_type: "material",
          default_quantity: 2,
          h_mo: 3,
          labor_role_id: LABOR_ROLE_ID,
          unit_cost_ht_cents: 1000,
          k_fo: 1.2,
          k_mo: 1.5,
          loss_coeff_bp: 5000,
        },
      ],
      new Map([[LABOR_ROLE_ID, 4000]])
    );

    expect(metrics).toEqual({
      directCostCents: 20400,
      laborHours: 3,
    });
  });
});

describe("estimate assemblies insertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renormalise les lignes inserees au lieu de les laisser a 0 EUR", async () => {
    // SQL materializes lines at zero; the real calculator must provide the projection.
    const supabase = createAssemblyInsertSupabaseMock({
      lineItems: [
        {
          id: INSERTED_LINE_ID,
          item_type: "line",
          labor_role_id: null,
          quantity: 10,
          unit_price_ht_cents: 2500,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
          h_mo_majoration: 1,
          tax_rate_bp: 2000,
          pu_ht_cents: 0,
          line_total_ht_cents: 0,
          line_tax_cents: 0,
          line_total_ttc_cents: 0,
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await insertAssemblyIntoVersion({
      assemblyId: ASSEMBLY_ID,
      versionId: VERSION_ID,
      afterItemId: ITEM_ID_1,
    });

    const line = result.items.find((item) => item.id === INSERTED_LINE_ID);
    // 10 x 25,00 EUR : la ligne ne doit plus valoir 0.
    expect(line?.line_total_ht_cents).toBe(25_000);
    expect(line?.pu_ht_cents).toBe(2_500);
    expect(line?.line_total_ttc_cents).toBe(30_000);
    expect(result.totals).toEqual({ total_ht_cents: 25_000, total_tax_cents: 5_000, total_ttc_cents: 30_000 });
  });

  it("refuse d'inserer un ouvrage contenant de la main-d'oeuvre sans role", async () => {
    const supabase = createAssemblyInsertSupabaseMock({
      validLaborRoleIds: [],
    });
    // Un composant labor sans role : son taux horaire (unit_cost_ht_cents)
    // n'aurait nulle part ou atterrir sur la ligne de devis, et tout le cout
    // MO serait perdu (ligne inseree a 0 EUR).
    supabase.__mocks.assemblyItemsBuilder.in.mockResolvedValueOnce({
      data: [{ id: "labor-1", title: "Pose cloison", cost_type: "labor", h_mo: 1, labor_role_id: null }],
      error: null,
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
      code: "ESTIMATE_ASSEMBLY_LABOR_ROLE_REQUIRED",
    });

    // Rien ne doit avoir ete insere.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "insert_estimate_assembly_into_version",
      expect.anything()
    );
  });

  it("returns inserted assembly items only after atomic financial confirmation", async () => {
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
    expect(supabase.rpc).toHaveBeenCalledWith("finalize_estimate_assembly_calculation", expect.objectContaining({
      p_draft_lock_session_id: LOCK_SESSION_ID,
      p_expected_content_revision: 1,
      p_inserted_item_ids: [INSERTED_SECTION_ID, INSERTED_LINE_ID],
      p_version_patch: { total_ht_cents: 5000, total_tax_cents: 1000, total_ttc_cents: 6000 },
    }));
    expect(supabase.__mocks.estimateItemsUpdateIn).not.toHaveBeenCalled();
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

function createTemplateInsertSupabaseMock(input?: {
  versionStatus?: "draft" | "sent" | "accepted" | "archived";
  versionMaxSectionDepth?: number;
  draftLockUserId?: string | null;
  templateItems?: Array<{
    id: string;
    parent_id: string | null;
    item_type: "section" | "line";
    position: number;
  }>;
  afterItemId?: string | null;
  anchorExists?: boolean;
  anchorParentId?: string | null;
  parentItem?: {
    id: string;
    version_id: string;
    parent_id: string | null;
    item_type: "section" | "line";
  };
  hierarchyItems?: Array<{
    id: string;
    parent_id: string | null;
    item_type: "section" | "line";
  }>;
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

  const estimateVersionAccessBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: VERSION_ID,
        project_id: PROJECT_ID,
        status: input?.versionStatus ?? "draft",
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        max_section_depth: input?.versionMaxSectionDepth ?? 3,
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
              id: "lock-template",
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

  const templateBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: TEMPLATE_ID,
        tenant_id: TENANT_ID,
        name: "Template test",
        description: null,
        source_version_id: null,
        created_by: USER_ID,
        margin_multiplier: 1,
        margin_mode: "fixed",
        currency: "EUR",
        margin_bp: 0,
        discount_bp: 0,
        discount_mode: "simple",
        discount_steps: [],
        global_coefficient: 1,
        tax_rate_bp: 2000,
        rounding_mode: "none",
        rounding_step_cents: 1,
        validite_jours: 30,
        created_at: VERSION_UPDATED_AT,
        updated_at: VERSION_UPDATED_AT,
      },
      error: null,
    }),
  };
  templateBuilder.eq.mockReturnValue(templateBuilder);

  const defaultTemplateItems = [
    {
      id: ROOT_SECTION_ID,
      parent_id: null,
      item_type: "section" as const,
      position: 1,
    },
    {
      id: "abababab-abab-4aba-8aba-abababababab",
      parent_id: ROOT_SECTION_ID,
      item_type: "line" as const,
      position: 1,
    },
  ];
  let templateItemsOrderCalls = 0;
  const templateItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(() => {
      templateItemsOrderCalls += 1;
      if (templateItemsOrderCalls >= 2) {
        return Promise.resolve({
          data: input?.templateItems ?? defaultTemplateItems,
          error: null,
        });
      }
      return templateItemsBuilder;
    }),
  };
  templateItemsBuilder.eq.mockReturnValue(templateItemsBuilder);

  const anchorBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(
      input?.anchorExists === false
        ? { data: null, error: null }
        : {
            data: {
              id: input?.afterItemId ?? ITEM_ID_1,
              parent_id: input?.anchorParentId ?? null,
            },
            error: null,
          }
    ),
  };
  anchorBuilder.eq.mockReturnValue(anchorBuilder);

  const parentBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data:
        input?.parentItem ??
        (input?.anchorParentId
          ? {
              id: input.anchorParentId,
              version_id: VERSION_ID,
              parent_id: null,
              item_type: "section",
            }
          : null),
      error: null,
    }),
  };
  parentBuilder.eq.mockReturnValue(parentBuilder);

  const hierarchyBuilder = {
    eq: vi.fn(),
    data: input?.hierarchyItems ?? [],
    error: null,
  };
  hierarchyBuilder.eq.mockReturnValue(hierarchyBuilder);

  const rpcData = [
    {
      id: INSERTED_SECTION_ID,
      item_type: "section" as const,
      parent_id: null,
      position: 2,
      labor_role_id: null,
    },
    {
      id: INSERTED_LINE_ID,
      item_type: "line" as const,
      parent_id: INSERTED_SECTION_ID,
      position: 1,
      labor_role_id: null,
    },
  ];
  const rpc = vi.fn().mockResolvedValue({
    data: rpcData,
    error: input?.rpcError ?? null,
  });

  const estimateItemsSelectIn = vi.fn().mockResolvedValue({
    data: rpcData,
    error: null,
  });
  const estimateItemsSelectBuilder = {
    eq: vi.fn(),
    in: estimateItemsSelectIn,
  };
  estimateItemsSelectBuilder.eq.mockReturnValue(estimateItemsSelectBuilder);

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
      if (table === "estimate_templates") {
        return {
          select: vi.fn(() => templateBuilder),
        };
      }
      if (table === "estimate_template_items") {
        return {
          select: vi.fn(() => templateItemsBuilder),
        };
      }
      if (table === "estimate_items") {
        return {
          select: vi.fn((columns: string) => {
            if (columns === "id, parent_id") {
              return anchorBuilder;
            }
            if (columns === "id, version_id, item_type, parent_id") {
              return parentBuilder;
            }
            if (columns === "id, parent_id, item_type") {
              return hierarchyBuilder;
            }
            if (columns === "*") {
              return estimateItemsSelectBuilder;
            }
            throw new Error(`Unexpected estimate_items select: ${columns}`);
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc,
  };

  return supabase;
}

describe("estimate templates insertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects template insertion when a root line is not under a section leaf", async () => {
    const supabase = createTemplateInsertSupabaseMock({
      versionMaxSectionDepth: 3,
      templateItems: [
        {
          id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
          parent_id: null,
          item_type: "line",
          position: 1,
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      insertTemplateIntoVersion({
        templateId: TEMPLATE_ID,
        versionId: VERSION_ID,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Une ligne doit être ajoutée sous une section.",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects insertion when adding a root section would exceed max depth", async () => {
    const supabase = createTemplateInsertSupabaseMock({
      versionMaxSectionDepth: 3,
      afterItemId: ITEM_ID_1,
      anchorParentId: PARENT_ID_1,
      parentItem: {
        id: PARENT_ID_1,
        version_id: VERSION_ID,
        parent_id: SECOND_LEVEL_SECTION_ID,
        item_type: "section",
      },
      hierarchyItems: [
        {
          id: ROOT_SECTION_ID,
          parent_id: null,
          item_type: "section",
        },
        {
          id: SECOND_LEVEL_SECTION_ID,
          parent_id: ROOT_SECTION_ID,
          item_type: "section",
        },
        {
          id: PARENT_ID_1,
          parent_id: SECOND_LEVEL_SECTION_ID,
          item_type: "section",
        },
      ],
      templateItems: [
        {
          id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
          parent_id: null,
          item_type: "section",
          position: 1,
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      insertTemplateIntoVersion({
        templateId: TEMPLATE_ID,
        versionId: VERSION_ID,
        afterItemId: ITEM_ID_1,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Impossible de créer ce niveau: profondeur max 3.",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
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
          supply_type_id: SUPPLY_TYPE_ID,
          unit: "ml",
          k_fo: 0.5,
          k_mo: 1.1,
          default_quantity: 1,
          h_mo: 0.5,
          cost_type: "material",
          unit_cost_ht_cents: 998,
          position: 1,
        },
      ],
    });

    expect(supabase.rpc).toHaveBeenCalledWith("replace_estimate_assembly_contents", {
      p_assembly_id: ASSEMBLY_ID,
      p_items: [
        {
          title: "Ligne",
          unit: "ml",
          k_fo: 0.5,
          k_mo: 1.1,
          labor_role_id: LABOR_ROLE_ID,
          supply_type_id: SUPPLY_TYPE_ID,
          default_quantity: 1,
          h_mo: 0.5,
          position: 1,
          cost_type: "material",
          unit_cost_ht_cents: 998,
          loss_coeff_bp: 0,
          yield_value: null,
          yield_unit: null,
          source_metadata: {},
        },
      ],
      p_members: [],
    });
    expect(result.assembly.id).toBe(ASSEMBLY_ID);
    expect(result.assembly.items).toHaveLength(1);
    expect(result.assembly.ds_cents).toBe(2149);
    expect(result.assembly.avg_time_hours).toBe(0.5);
  });
  it("maps cyclic compositions to a domain conflict", async () => {
    const supabase = createAssemblyUpdateSupabaseMock({
      rpcError: {
        code: "P0001",
        message: "Estimate assembly composition would create a cycle",
        details: null,
        hint: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      updateEstimateAssembly(ASSEMBLY_ID, {
        members: [
          {
            child_assembly_id: "99999999-9999-4999-8999-999999999999",
            quantity: 1,
            position: 2,
          },
        ],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "ESTIMATE_ASSEMBLY_CYCLE",
    });
  });


});

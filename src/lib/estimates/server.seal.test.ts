import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockServiceRoleRpc = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/service-role", () => {
  return {
    createServiceRoleClient: vi.fn(() => ({ rpc: mockServiceRoleRpc })),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("./pdf-generator", () => ({
  generateEstimatePdfNow: vi.fn(),
}));

vi.mock("./gating", () => ({
  evaluateEstimateSendGating: vi.fn().mockResolvedValue({
    canSend: true,
    blockingFlags: [],
    warningFlags: [],
    stalePriceDays: 90,
    checkedAt: "2026-02-22T12:00:00.000Z",
  }),
}));

vi.mock("./version-totals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./version-totals")>();
  return {
    ...actual,
    calculateEstimateTotalsForItems: vi.fn(),
    calculateEstimateSnapshotForItems: vi.fn(),
  };
});

import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  freezeEstimateV2SnapshotForSend,
  patchEstimateStatus,
  verifyEstimateSeal,
} from "@/lib/estimates/server";
import { evaluateEstimateSendGating } from "./gating";
import { generateEstimatePdfNow } from "./pdf-generator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  calculateEstimateSnapshotForItems,
  calculateEstimateTotalsForItems,
} from "./version-totals";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";
const NEXT_UPDATED_AT = "2026-02-21T10:00:01.000Z";
const LOCK_EXPIRES_AT = "2099-02-21T10:00:00.000Z";

type QueryResult = {
  data: unknown;
  error: {
    code: string;
    message: string;
    details: string | null;
    hint: string | null;
  } | null;
};

function createExpectedSealHash(input: {
  version: {
    id: string;
    tenant_id: string;
    project_id: string;
    version_number: number;
    date_devis: string;
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    margin_multiplier: number;
    discount_bp: number;
    tax_rate_bp: number;
    rounding_mode: "none" | "nearest" | "up" | "down";
    rounding_step_cents: number;
  };
  items: Array<{
    id: string;
    position: number;
    item_type: "section" | "line";
    title: string;
    quantity: number | null;
    unit_price_ht_cents: number | null;
    tax_rate_bp: number | null;
    k_fo: number | null;
    h_mo: number | null;
    h_mo_majoration?: number | null;
    k_mo: number | null;
    supply_type_id?: string | null;
    pu_ht_cents: number | null;
    line_total_ht_cents: number | null;
    line_tax_cents: number | null;
    line_total_ttc_cents: number | null;
  }>;
}) {
  const payload = {
    meta: {
      payload_version: 1,
      version_id: input.version.id,
      tenant_id: input.version.tenant_id,
      project_id: input.version.project_id,
    },
    version: {
      version_number: input.version.version_number,
      date_devis: input.version.date_devis,
      total_ht_cents: input.version.total_ht_cents,
      total_tax_cents: input.version.total_tax_cents,
      total_ttc_cents: input.version.total_ttc_cents,
      margin_multiplier: input.version.margin_multiplier,
      discount_bp: input.version.discount_bp,
      tax_rate_bp: input.version.tax_rate_bp,
      rounding_mode: input.version.rounding_mode,
      rounding_step_cents: input.version.rounding_step_cents,
    },
    items: [...input.items]
      .sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }
        return left.id.localeCompare(right.id);
      })
      .map((item) => ({
        id: item.id,
        position: item.position,
        item_type: item.item_type,
        title: item.title,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        h_mo_majoration: item.h_mo_majoration ?? null,
        k_mo: item.k_mo,
        supply_type_id: item.supply_type_id ?? null,
        pu_ht_cents: item.pu_ht_cents,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
      })),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .toLowerCase();
}

function createExpectedSplitSealHash(
  input: {
    version: {
      id: string;
      tenant_id: string;
      project_id: string;
      version_number: number;
      date_devis: string;
      total_ht_cents: number;
      total_tax_cents: number;
      total_ttc_cents: number;
      margin_multiplier: number;
      discount_bp: number;
      tax_rate_bp: number;
      rounding_mode: "none" | "nearest" | "up" | "down";
      rounding_step_cents: number;
      calc_engine_version: number;
      contractor_role?: string;
    };
    items: Array<{
      id: string;
      position: number;
      item_type: "section" | "line";
      title: string;
      quantity: number | null;
      unit_price_ht_cents: number | null;
      tax_rate_bp: number | null;
      k_fo: number | null;
      h_mo: number | null;
      h_mo_majoration?: number | null;
      k_mo: number | null;
      h_mo_atelier?: number | null;
      k_mo_atelier?: number | null;
      labor_role_atelier_id?: string | null;
      h_mo_chantier?: number | null;
      k_mo_chantier?: number | null;
      labor_role_chantier_id?: string | null;
      supply_type_id?: string | null;
      pu_ht_cents: number | null;
      line_total_ht_cents: number | null;
      line_tax_cents: number | null;
      line_total_ttc_cents: number | null;
    }>;
  },
  options?: {
    payloadVersion?: 1 | 2;
    includeCalcEngineVersion?: boolean;
  }
) {
  const payloadVersion = options?.payloadVersion ?? 2;
  const includeCalcEngineVersion =
    options?.includeCalcEngineVersion ?? true;
  const payload = {
    meta: {
      payload_version: payloadVersion,
      version_id: input.version.id,
      tenant_id: input.version.tenant_id,
      project_id: input.version.project_id,
    },
    version: {
      version_number: input.version.version_number,
      date_devis: input.version.date_devis,
      total_ht_cents: input.version.total_ht_cents,
      total_tax_cents: input.version.total_tax_cents,
      total_ttc_cents: input.version.total_ttc_cents,
      margin_multiplier: input.version.margin_multiplier,
      discount_bp: input.version.discount_bp,
      tax_rate_bp: input.version.tax_rate_bp,
      rounding_mode: input.version.rounding_mode,
      rounding_step_cents: input.version.rounding_step_cents,
      ...(includeCalcEngineVersion
        ? { calc_engine_version: input.version.calc_engine_version }
        : {}),
      ...(input.version.contractor_role &&
      input.version.contractor_role !== "principal"
        ? { contractor_role: input.version.contractor_role }
        : {}),
    },
    items: [...input.items]
      .sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }
        return left.id.localeCompare(right.id);
      })
      .map((item) => ({
        id: item.id,
        position: item.position,
        item_type: item.item_type,
        title: item.title,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        h_mo_majoration: item.h_mo_majoration ?? null,
        k_mo: item.k_mo,
        ...(item.h_mo_atelier != null
          ? { h_mo_atelier: item.h_mo_atelier }
          : {}),
        ...(item.k_mo_atelier != null
          ? { k_mo_atelier: item.k_mo_atelier }
          : {}),
        ...(item.labor_role_atelier_id != null
          ? { labor_role_atelier_id: item.labor_role_atelier_id }
          : {}),
        ...(item.h_mo_chantier != null
          ? { h_mo_chantier: item.h_mo_chantier }
          : {}),
        ...(item.k_mo_chantier != null
          ? { k_mo_chantier: item.k_mo_chantier }
          : {}),
        ...(item.labor_role_chantier_id != null
          ? { labor_role_chantier_id: item.labor_role_chantier_id }
          : {}),
        supply_type_id: item.supply_type_id ?? null,
        pu_ht_cents: item.pu_ht_cents,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
      })),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .toLowerCase();
}

function createSupabaseSealMock(input: {
  versionSelectResponses: QueryResult[];
  estimateItemsResult: QueryResult;
  updateResult?: QueryResult;
  eventInsertError?: QueryResult["error"];
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

  const versionResponses = [...input.versionSelectResponses];
  const estimateVersionsSelect = vi.fn(() => {
    const response = versionResponses.shift();
    if (!response) {
      throw new Error("Unexpected estimate_versions select call.");
    }

    const builder = {
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue(response),
    };
    builder.eq.mockReturnValue(builder);
    return builder;
  });

  const updatePayloads: unknown[] = [];
  const updateEqCalls: Array<[string, unknown]> = [];
  const estimateVersionsUpdate = vi.fn((payload: unknown) => {
    updatePayloads.push(payload);
    const builder = {
      eq: vi.fn((column: string, value: unknown) => {
        updateEqCalls.push([column, value]);
        return builder;
      }),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(
          input.updateResult ?? {
            data: {
              id: VERSION_ID,
              status: "sent",
              updated_at: NEXT_UPDATED_AT,
              seal_hash:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            error: null,
          }
        ),
      })),
    };
    return builder;
  });

  const estimateItemsSelect = vi.fn(() => {
    const estimateItemsBuilder = {
      eq: vi.fn(),
      order: vi.fn(),
    };
    estimateItemsBuilder.eq.mockReturnValue(estimateItemsBuilder);
    estimateItemsBuilder.order
      .mockImplementationOnce(() => estimateItemsBuilder)
      .mockResolvedValue(input.estimateItemsResult);
    return estimateItemsBuilder;
  });

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
              locked_at: UPDATED_AT,
              expires_at: LOCK_EXPIRES_AT,
            },
      error: null,
    }),
  };
  draftLocksBuilder.eq.mockReturnValue(draftLocksBuilder);
  draftLocksBuilder.gt.mockReturnValue(draftLocksBuilder);

  const eventInsert = vi.fn().mockResolvedValue({
    error: input.eventInsertError ?? null,
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
          select: estimateVersionsSelect,
          update: estimateVersionsUpdate,
        };
      }

      if (table === "estimate_items") {
        return {
          select: estimateItemsSelect,
        };
      }

      if (table === "estimate_version_events") {
        return {
          insert: eventInsert,
        };
      }

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLocksBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      updatePayloads,
      updateEqCalls,
      eventInsert,
    },
  };

  return supabase;
}

function createVersionAccessRow(status: "draft" | "sent" | "accepted" | "archived") {
  return {
    id: VERSION_ID,
    project_id: PROJECT_ID,
    status,
    margin_mode: "fixed",
    margin_multiplier: 1.2,
    margin_bp: 1_667,
    discount_bp: 250,
    tax_rate_bp: 2000,
    updated_at: UPDATED_AT,
    total_ht_cents: 10000,
    total_tax_cents: 2000,
    total_ttc_cents: 12000,
    content_revision: 1,
    estimate_projects: {
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: "Projet test",
      reference: null,
      client_name: null,
      notes: null,
      is_archived: false,
    },
  };
}

describe("estimate seal payload versions", () => {
  const item = {
    id: "77777777-7777-4777-8777-777777777777",
    position: 1,
    item_type: "line",
    parent_id: null,
    title: "Ligne v2",
    description: "u",
    quantity: 2,
    unit_price_ht_cents: 5_000,
    tax_rate_bp: 1_000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    labor_role_id: "role-1",
    category_id: "category-1",
    supply_type_id: null,
    pu_ht_cents: 5_000,
    snapshot_pu_ht_cents: 4_950,
    snapshot_fo_ht_cents: 3_000,
    snapshot_mo_ht_cents: 6_900,
    snapshot_mo_atelier_ht_cents: 2_900,
    snapshot_mo_chantier_ht_cents: 4_000,
    line_total_ht_cents: 9_900,
    line_tax_cents: 990,
    line_total_ttc_cents: 10_890,
  };
  const version = {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_number: 2,
    title: "Offre v2",
    exclusions: "Hors peinture",
    date_devis: "2026-08-12",
    validite_jours: 45,
    currency: "EUR",
    total_ht_cents: 10_000,
    total_tax_cents: 1_000,
    total_ttc_cents: 11_000,
    margin_multiplier: 1.35,
    margin_mode: "tiered",
    discount_bp: 1_000,
    discount_mode: "cascade",
    discount_steps: [500, 250],
    global_coefficient: 1.1,
    max_section_depth: 4,
    tax_rate_bp: 2_000,
    rounding_mode: "nearest",
    rounding_step_cents: 5,
    calc_engine_version: 2,
    calc_snapshot_content_revision: 7,
    calc_snapshot_context: {
      labor_split_enabled: true,
      labor_roles: [{ id: "role-1", hourly_rate_cents: 4_500 }],
      margin_tiers: [{ threshold_cents: 0, multiplier: 1.35 }],
    },
    contractor_role: "subcontractor",
    seal_hash: null,
  };

  it("uses v3 for engine 2 and seals every immutable unified-engine setting", () => {
    const payload = buildCanonicalEstimateSealPayload({
      version: version as never,
      items: [item] as never,
    });

    expect(payload).toMatchObject({
      meta: { payload_version: 3 },
      version: {
        validite_jours: 45,
        title: "Offre v2",
        exclusions: "Hors peinture",
        currency: "EUR",
        margin_mode: "tiered",
        discount_mode: "cascade",
        discount_steps: [500, 250],
        global_coefficient: 1.1,
        max_section_depth: 4,
        calc_engine_version: 2,
        calc_snapshot_content_revision: 7,
        calc_snapshot_context: version.calc_snapshot_context,
        contractor_role: "subcontractor",
      },
    });

    const baseHash = computeEstimateSealHash(payload);
    const mutations = [
      { margin_mode: "fixed" },
      { discount_mode: "simple" },
      { discount_steps: [750] },
      { global_coefficient: 1.2 },
      { max_section_depth: 5 },
      { currency: "USD" },
      { validite_jours: 30 },
      { title: "Offre v2 modifiée" },
      { exclusions: "Hors peinture et échafaudage" },
      { calc_snapshot_content_revision: 8 },
      {
        calc_snapshot_context: {
          labor_split_enabled: false,
          labor_roles: [],
          margin_tiers: [],
        },
      },
    ];
    mutations.forEach((mutation) => {
      const mutated = buildCanonicalEstimateSealPayload({
        version: { ...version, ...mutation } as never,
        items: [item] as never,
      });
      expect(computeEstimateSealHash(mutated)).not.toBe(baseHash);
    });

    const snapshotMutation = buildCanonicalEstimateSealPayload({
      version: version as never,
      items: [{ ...item, snapshot_pu_ht_cents: 4_949 }] as never,
    });
    expect(computeEstimateSealHash(snapshotMutation)).not.toBe(baseHash);
    const hierarchyMutation = buildCanonicalEstimateSealPayload({
      version: version as never,
      items: [{ ...item, parent_id: "another-section" }] as never,
    });
    expect(computeEstimateSealHash(hierarchyMutation)).not.toBe(baseHash);
  });

  it("keeps engine 1 on payload v2 by default", () => {
    const payload = buildCanonicalEstimateSealPayload({
      version: { ...version, calc_engine_version: 1 } as never,
      items: [item] as never,
    });

    expect(payload.meta.payload_version).toBe(2);
    expect(payload.version).not.toHaveProperty("global_coefficient");
  });
});

describe("estimate status seal flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    mockServiceRoleRpc.mockImplementation(
      async (functionName: string, parameters: Record<string, unknown>) => {
        if (functionName === "transition_estimate_version_status") {
          return {
            data: {
              id: VERSION_ID,
              status: parameters.p_next_status,
              updated_at: NEXT_UPDATED_AT,
              seal_hash: parameters.p_seal_hash,
            },
            error: null,
          };
        }

        return { data: null, error: null };
      }
    );
    vi.mocked(evaluateEstimateSendGating).mockReset().mockResolvedValue({
      canSend: true,
      blockingFlags: [],
      warningFlags: [],
      stalePriceDays: 90,
      checkedAt: "2026-02-22T12:00:00.000Z",
    });
    vi.mocked(calculateEstimateSnapshotForItems).mockResolvedValue({
      context: {
        effective_margin_multiplier: 1,
        labor_split_enabled: false,
        labor_roles: [],
        margin_tiers: [],
      },
      breakdown: {
        totals: {
          costSubtotalCents: 0,
          saleSubtotalBeforeCoefficientCents: 0,
          saleSubtotalCents: 0,
          discountCents: 0,
          appliedMarginMultiplier: 1,
          globalCoefficient: 1,
          discountMode: "simple",
          discountStepTotals: [],
          saleTotalCents: 0,
          taxCents: 0,
          ttcCents: 0,
          roundedTtcCents: 0,
          roundingAdjustmentCents: 0,
          adjustedTaxCents: 0,
        },
        lineById: new Map(),
        sectionById: new Map(),
        rootLineIds: [],
        invariants: { sumAllocatedHtCents: 0, matchesFooter: true },
      },
    });
    vi.mocked(calculateEstimateTotalsForItems).mockResolvedValue({
      total_ht_cents: 10_000,
      total_tax_cents: 2_000,
      total_ttc_cents: 12_000,
    });
  });

  it("rejects status update when concurrency token is missing", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "sent" }, undefined)
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Jeton de concurrence manquant.",
    });
  });

  it("rejects invalid status transitions", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "accepted" }, UPDATED_AT)
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Transition de statut invalide: draft -> accepted.",
    });
  });

  it("returns conflict when status update token is stale at write time", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("sent"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    mockServiceRoleRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "ESTIMATE_VERSION_CONFLICT",
        details: null,
        hint: null,
      },
    });

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "accepted" }, UPDATED_AT)
    ).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "Version modifiee par un autre utilisateur",
      details: {
        updated_at: UPDATED_AT,
      },
    });

    expect(mockServiceRoleRpc).toHaveBeenCalledWith(
      "transition_estimate_version_status",
      expect.objectContaining({
        p_version_id: VERSION_ID,
        p_expected_updated_at: UPDATED_AT,
        p_next_status: "accepted",
      })
    );
  });

  it("requires an active draft lock before transitioning out of draft", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
      draftLockUserId: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateStatus(
        VERSION_ID,
        {
          status: "sent",
          updated_at: UPDATED_AT,
        },
        UPDATED_AT
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "LOCK_REQUIRED",
      message: "Un verrou actif est requis pour modifier cette version brouillon.",
      details: {
        lock: null,
      },
    });

    expect(supabase.__mocks.updatePayloads).toEqual([]);
  });

  it("blocks draft -> sent when gating reports blocking anomalies", async () => {
    vi.mocked(evaluateEstimateSendGating).mockResolvedValueOnce({
      canSend: false,
      blockingFlags: [
        {
          key: "missing_price",
          severity: "blocking",
          count: 1,
          item_ids: ["line-1"],
          label: "Prix manquant",
          description: "Le prix unitaire FO est absent ou egal a 0.",
        },
      ],
      warningFlags: [],
      stalePriceDays: 90,
      checkedAt: "2026-02-22T12:00:00.000Z",
    });

    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "sent" }, UPDATED_AT)
    ).rejects.toMatchObject({
      status: 400,
      code: "ESTIMATE_GATING_BLOCKED",
    });

    expect(vi.mocked(generateEstimatePdfNow)).not.toHaveBeenCalled();
    expect(supabase.__mocks.updatePayloads).toEqual([]);
  });

  it("rejects force send for non-admin users", async () => {
    vi.mocked(evaluateEstimateSendGating).mockResolvedValueOnce({
      canSend: false,
      blockingFlags: [
        {
          key: "missing_price",
          severity: "blocking",
          count: 1,
          item_ids: ["line-1"],
          label: "Prix manquant",
          description: "Le prix unitaire FO est absent ou egal a 0.",
        },
      ],
      warningFlags: [],
      stalePriceDays: 90,
      checkedAt: "2026-02-22T12:00:00.000Z",
    });

    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "sent", force: true }, UPDATED_AT)
    ).rejects.toMatchObject({
      status: 403,
      code: "FORCE_SEND_FORBIDDEN",
    });

    expect(vi.mocked(generateEstimatePdfNow)).not.toHaveBeenCalled();
    expect(supabase.__mocks.updatePayloads).toEqual([]);
  });

  it("computes the seal and uses the atomic trusted send command", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
        {
          data: {
            id: VERSION_ID,
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            version_number: 1,
            date_devis: "2026-02-21",
            total_ht_cents: 10000,
            total_tax_cents: 2000,
            total_ttc_cents: 12000,
            margin_multiplier: 1.2,
            discount_bp: 0,
            tax_rate_bp: 2000,
            rounding_mode: "none",
            rounding_step_cents: 1,
            seal_hash: null,
          },
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            position: 1,
            item_type: "line",
            title: "Ligne",
            quantity: 1,
            unit_price_ht_cents: 10000,
            tax_rate_bp: 2000,
            k_fo: 1,
            h_mo: 0,
            h_mo_majoration: null,
            k_mo: 0,
            supply_type_id: null,
            pu_ht_cents: 10000,
            line_total_ht_cents: 10000,
            line_tax_cents: 2000,
            line_total_ttc_cents: 12000,
          },
        ],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "sent" }, UPDATED_AT)
    ).resolves.toMatchObject({
      version: expect.objectContaining({
        id: VERSION_ID,
        status: "sent",
      }),
    });

    expect(supabase.__mocks.updatePayloads).toEqual([]);
    expect(supabase.__mocks.eventInsert).not.toHaveBeenCalled();
    expect(mockServiceRoleRpc).toHaveBeenCalledWith(
      "transition_estimate_version_status",
      expect.objectContaining({
        p_version_id: VERSION_ID,
        p_tenant_id: TENANT_ID,
        p_expected_updated_at: UPDATED_AT,
        p_next_status: "sent",
        p_seal_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_actor_user_id: USER_ID,
        p_event_metadata: {},
        p_occurred_at: expect.any(String),
      })
    );

    expect(vi.mocked(generateEstimatePdfNow)).toHaveBeenCalledWith(VERSION_ID, {
      force: true,
      triggeredBy: "send",
    });
    expect(vi.mocked(evaluateEstimateSendGating)).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          margin_bp: 1_667,
          discount_bp: 250,
        }),
      })
    );
    expect(vi.mocked(calculateEstimateTotalsForItems)).not.toHaveBeenCalled();
  });

  it("blocks a v2 seal when the stored footer is stale", async () => {
    const accessVersion = {
      ...createVersionAccessRow("draft"),
      calc_engine_version: 2,
    };
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: accessVersion, error: null },
        {
          data: {
            id: VERSION_ID,
            margin_multiplier: 1.2,
            margin_mode: "fixed",
            tax_rate_bp: 2_000,
            discount_bp: 0,
            discount_mode: "simple",
            discount_steps: [],
            global_coefficient: 1,
            rounding_mode: "none",
            rounding_step_cents: 1,
            calc_engine_version: 2,
            contractor_role: "principal",
            estimate_projects: { user_id: USER_ID },
          },
          error: null,
        },
      ],
      estimateItemsResult: { data: [], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(calculateEstimateSnapshotForItems).mockResolvedValueOnce({
      context: {
        effective_margin_multiplier: 1,
        labor_split_enabled: false,
        labor_roles: [],
        margin_tiers: [],
      },
      breakdown: {
        totals: {} as never,
        lineById: new Map(),
        sectionById: new Map(),
        rootLineIds: [],
        invariants: { sumAllocatedHtCents: 9_000, matchesFooter: false },
      },
    });

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "sent" }, UPDATED_AT)
    ).rejects.toMatchObject({
      status: 400,
      code: "ESTIMATE_TOTALS_OUT_OF_SYNC",
    });

    expect(vi.mocked(generateEstimatePdfNow)).not.toHaveBeenCalled();
    expect(mockServiceRoleRpc).not.toHaveBeenCalledWith(
      "transition_estimate_version_status",
      expect.anything()
    );
  });

  it("maps a snapshot deadlock to the public version conflict", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: {
            ...createVersionAccessRow("draft"),
            calc_engine_version: 2,
          },
          error: null,
        },
        {
          data: {
            id: VERSION_ID,
            margin_multiplier: 1.2,
            margin_mode: "fixed",
            tax_rate_bp: 2_000,
            discount_bp: 0,
            discount_mode: "simple",
            discount_steps: [],
            global_coefficient: 1,
            rounding_mode: "none",
            rounding_step_cents: 1,
            calc_engine_version: 2,
            contractor_role: "principal",
            estimate_projects: { user_id: USER_ID },
          },
          error: null,
        },
      ],
      estimateItemsResult: { data: [], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    mockServiceRoleRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40P01",
        message: "deadlock detected",
        details: null,
        hint: null,
      },
    });

    await expect(
      freezeEstimateV2SnapshotForSend(VERSION_ID, UPDATED_AT)
    ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(mockServiceRoleRpc).toHaveBeenCalledWith(
      "freeze_estimate_v2_snapshot",
      expect.objectContaining({ p_purpose: "send" })
    );
  });

  it("aborts draft -> sent transition when PDF generation fails", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("draft"),
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(generateEstimatePdfNow).mockRejectedValueOnce(
      new Error("pdf generation failed")
    );

    await expect(
      patchEstimateStatus(VERSION_ID, { status: "sent" }, UPDATED_AT)
    ).rejects.toThrow("pdf generation failed");

    expect(supabase.__mocks.updatePayloads).toEqual([]);
    expect(supabase.__mocks.eventInsert).not.toHaveBeenCalled();
  });
});

describe("verifyEstimateSeal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("returns valid=true when stored hash matches computed hash", async () => {
    const items = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        position: 1,
        item_type: "line" as const,
        title: "Ligne",
        quantity: 2,
        unit_price_ht_cents: 5000,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: null,
        k_mo: 0,
        supply_type_id: null,
        pu_ht_cents: 5000,
        line_total_ht_cents: 10000,
        line_tax_cents: 2000,
        line_total_ttc_cents: 12000,
      },
    ];

    const sealHash = createExpectedSealHash({
      version: {
        id: VERSION_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        version_number: 1,
        date_devis: "2026-02-21",
        total_ht_cents: 10000,
        total_tax_cents: 2000,
        total_ttc_cents: 12000,
        margin_multiplier: 1.2,
        discount_bp: 0,
        tax_rate_bp: 2000,
        rounding_mode: "none",
        rounding_step_cents: 1,
      },
      items,
    });

    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("sent"),
          error: null,
        },
        {
          data: {
            id: VERSION_ID,
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            version_number: 1,
            date_devis: "2026-02-21",
            total_ht_cents: 10000,
            total_tax_cents: 2000,
            total_ttc_cents: 12000,
            margin_multiplier: 1.2,
            discount_bp: 0,
            tax_rate_bp: 2000,
            rounding_mode: "none",
            rounding_step_cents: 1,
            seal_hash: sealHash,
          },
          error: null,
        },
      ],
      estimateItemsResult: {
        data: items,
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toEqual({
      valid: true,
      computed_hash: sealHash,
      stored_hash: sealHash,
    });
  });

  it("returns valid=false when stored hash is missing or mismatched", async () => {
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        {
          data: createVersionAccessRow("sent"),
          error: null,
        },
        {
          data: {
            id: VERSION_ID,
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            version_number: 1,
            date_devis: "2026-02-21",
            total_ht_cents: 10000,
            total_tax_cents: 2000,
            total_ttc_cents: 12000,
            margin_multiplier: 1.2,
            discount_bp: 0,
            tax_rate_bp: 2000,
            rounding_mode: "none",
            rounding_step_cents: 1,
            seal_hash: null,
          },
          error: null,
        },
      ],
      estimateItemsResult: {
        data: [],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await verifyEstimateSeal(VERSION_ID);
    expect(result.valid).toBe(false);
    expect(result.stored_hash).toBeNull();
    expect(result.computed_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("couvre la main-d'œuvre atelier/chantier dans le sceau", async () => {
    const baseItem = {
      id: "66666666-6666-4666-8666-666666666666",
      position: 1,
      item_type: "line" as const,
      title: "Ligne",
      quantity: 2,
      unit_price_ht_cents: 5000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: null,
      k_mo: 0,
      supply_type_id: null,
      pu_ht_cents: 5000,
      line_total_ht_cents: 10000,
      line_tax_cents: 2000,
      line_total_ttc_cents: 12000,
    };
    const version = {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      date_devis: "2026-02-21",
      total_ht_cents: 10000,
      total_tax_cents: 2000,
      total_ttc_cents: 12000,
      margin_multiplier: 1.2,
      discount_bp: 0,
      tax_rate_bp: 2000,
      rounding_mode: "none" as const,
      rounding_step_cents: 1,
    };

    // Sceau « historique » calculé sans la ventilation atelier.
    const legacyHash = createExpectedSealHash({ version, items: [baseItem] });

    // Un item sans ventilation atelier reste valide (rétro-compatibilité).
    const compatibleSupabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        { data: { ...version, seal_hash: legacyHash }, error: null },
      ],
      estimateItemsResult: { data: [baseItem], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      compatibleSupabase as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: true,
    });

    // Une ventilation peut avoir été présente AVANT son ajout au payload du
    // sceau. Le vérificateur v1 pré-split doit accepter ce sceau historique au
    // lieu de déclarer à tort une altération.
    const historicalSplitSupabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        { data: { ...version, seal_hash: legacyHash }, error: null },
      ],
      estimateItemsResult: {
        data: [{ ...baseItem, h_mo_atelier: 5, labor_role_atelier_id: "role-a" }],
        error: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      historicalSplitSupabase as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("valide une vraie fixture v1 dont le hash contient la ventilation", async () => {
    const version = {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      date_devis: "2026-02-21",
      total_ht_cents: 10000,
      total_tax_cents: 2000,
      total_ttc_cents: 12000,
      margin_multiplier: 1.2,
      discount_bp: 0,
      tax_rate_bp: 2000,
      rounding_mode: "none" as const,
      rounding_step_cents: 1,
      calc_engine_version: 1,
      contractor_role: "principal",
    };
    const splitItem = {
      id: "abababab-abab-4bab-8bab-abababababab",
      position: 1,
      item_type: "line" as const,
      title: "Ligne v1 ventilée",
      quantity: 1,
      unit_price_ht_cents: 10000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: null,
      k_mo: 1,
      h_mo_atelier: 3,
      k_mo_atelier: 1.1,
      labor_role_atelier_id: "role-atelier",
      h_mo_chantier: 2,
      k_mo_chantier: 1.2,
      labor_role_chantier_id: "role-chantier",
      supply_type_id: null,
      pu_ht_cents: 10000,
      line_total_ht_cents: 10000,
      line_tax_cents: 2000,
      line_total_ttc_cents: 12000,
    };
    const v1SplitHash = createExpectedSplitSealHash(
      { version, items: [splitItem] },
      {
        payloadVersion: 1,
        includeCalcEngineVersion: false,
      }
    );
    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        { data: { ...version, seal_hash: v1SplitHash }, error: null },
      ],
      estimateItemsResult: { data: [splitItem], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toEqual({
      valid: true,
      computed_hash: v1SplitHash,
      stored_hash: v1SplitHash,
    });
  });

  it("protege le moteur et la ventilation des nouveaux sceaux v2 sans fallback permissif", async () => {
    const version = {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      date_devis: "2026-02-21",
      total_ht_cents: 10000,
      total_tax_cents: 2000,
      total_ttc_cents: 12000,
      margin_multiplier: 1.2,
      discount_bp: 0,
      tax_rate_bp: 2000,
      rounding_mode: "none" as const,
      rounding_step_cents: 1,
      calc_engine_version: 2,
      contractor_role: "principal",
    };
    const item = {
      id: "99999999-9999-4999-8999-999999999999",
      position: 1,
      item_type: "line" as const,
      title: "Ligne ventilée",
      quantity: 1,
      unit_price_ht_cents: 10000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: null,
      k_mo: 1,
      h_mo_atelier: 5,
      k_mo_atelier: 1,
      labor_role_atelier_id: "role-a",
      h_mo_chantier: null,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
      supply_type_id: null,
      pu_ht_cents: 10000,
      line_total_ht_cents: 10000,
      line_tax_cents: 2000,
      line_total_ttc_cents: 12000,
    };
    const v2Hash = createExpectedSplitSealHash({
      version,
      items: [item],
    });

    const validSupabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        { data: { ...version, seal_hash: v2Hash }, error: null },
      ],
      estimateItemsResult: { data: [item], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      validSupabase as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: true,
      computed_hash: v2Hash,
    });

    const v1HashOnEngineV2 = createExpectedSplitSealHash(
      { version, items: [item] },
      {
        payloadVersion: 1,
        includeCalcEngineVersion: false,
      }
    );
    const legacyHashOnEngineV2Supabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        {
          data: { ...version, seal_hash: v1HashOnEngineV2 },
          error: null,
        },
      ],
      estimateItemsResult: { data: [item], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      legacyHashOnEngineV2Supabase as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: false,
      stored_hash: v1HashOnEngineV2,
    });

    const splitTamperedSupabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        { data: { ...version, seal_hash: v2Hash }, error: null },
      ],
      estimateItemsResult: {
        data: [{ ...item, h_mo_atelier: 6 }],
        error: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      splitTamperedSupabase as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: false,
    });

    const engineTamperedSupabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        {
          data: {
            ...version,
            calc_engine_version: 1,
            seal_hash: v2Hash,
          },
          error: null,
        },
      ],
      estimateItemsResult: { data: [item], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      engineTamperedSupabase as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: false,
    });
  });

  it("EST-E27 : ajouter le regime de TVA n invalide aucun sceau existant", async () => {
    // La lecon de b74a0c8, appliquee avant de commettre la meme erreur : une cle
    // ajoutee au payload canonique sur TOUTES les versions changerait le hash de
    // l integralite du parc scelle, sans reparation possible. `contractor_role`
    // n entre donc dans le payload que hors valeur par defaut.
    const baseItem = {
      id: "88888888-8888-4888-8888-888888888888",
      position: 1,
      item_type: "line" as const,
      title: "Ligne",
      quantity: 1,
      unit_price_ht_cents: 10000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: null,
      k_mo: 1,
      supply_type_id: null,
      pu_ht_cents: 10000,
      line_total_ht_cents: 10000,
      line_tax_cents: 2000,
      line_total_ttc_cents: 12000,
    };
    const version = {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      date_devis: "2026-02-21",
      total_ht_cents: 10000,
      total_tax_cents: 2000,
      total_ttc_cents: 12000,
      margin_multiplier: 1.2,
      discount_bp: 0,
      tax_rate_bp: 2000,
      rounding_mode: "none" as const,
      rounding_step_cents: 1,
    };

    // Sceau emis avant l existence de la colonne.
    const legacyHash = createExpectedSealHash({ version, items: [baseItem] });

    // Etat REEL en base apres migration : `contractor_role = principal` sur
    // toutes les lignes, par le defaut de la colonne.
    const principal = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        {
          data: { ...version, contractor_role: "principal", seal_hash: legacyHash },
          error: null,
        },
      ],
      estimateItemsResult: { data: [baseItem], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(principal as never);
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: true,
    });

    // En revanche, passer une version en sous-traitance CHANGE le document : le
    // sceau doit le detecter.
    const subcontractor = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        {
          data: {
            ...version,
            contractor_role: "subcontractor",
            seal_hash: legacyHash,
          },
          error: null,
        },
      ],
      estimateItemsResult: { data: [baseItem], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      subcontractor as never
    );
    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: false,
    });
  });

  it("garde les sceaux historiques valides sur l'etat REEL en base (k_mo_* = 1)", async () => {
    // Regression : le test precedent utilise une fixture ou les colonnes de
    // ventilation sont ABSENTES, etat que la base ne produit jamais. La
    // migration 029_est_031_labor_split_atelier_chantier.sql declare
    // `k_mo_atelier` / `k_mo_chantier` en `default 1.0` et les backfille a 1.0
    // sur TOUTES les lignes existantes (l.13-14). Une ligne sans ventilation
    // porte donc k = 1 et h = null, jamais null partout.
    //
    // Avec le test `!= null`, `k_mo_*: 1` entrait dans le payload canonique de
    // chaque item et invalidait le sceau de l'integralite du parc deja scelle
    // — sans reparation possible, `seal_hash` etant immuable hors transition
    // draft -> sent (025_est046_seal_and_events.sql:36).
    const baseItem = {
      id: "77777777-7777-4777-8777-777777777777",
      position: 1,
      item_type: "line" as const,
      title: "Ligne sans ventilation",
      quantity: 2,
      unit_price_ht_cents: 5000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 3,
      h_mo_majoration: null,
      k_mo: 1,
      supply_type_id: null,
      pu_ht_cents: 5000,
      line_total_ht_cents: 10000,
      line_tax_cents: 2000,
      line_total_ttc_cents: 12000,
    };
    const version = {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      date_devis: "2026-02-21",
      total_ht_cents: 10000,
      total_tax_cents: 2000,
      total_ttc_cents: 12000,
      margin_multiplier: 1.2,
      discount_bp: 0,
      tax_rate_bp: 2000,
      rounding_mode: "none" as const,
      rounding_step_cents: 1,
    };

    // Sceau emis avant que les colonnes de ventilation n'entrent dans le payload.
    const legacyHash = createExpectedSealHash({ version, items: [baseItem] });

    // L'etat REEL en base : coefficients a 1 (valeur par defaut), heures nulles,
    // roles nuls. Aucune ventilation effective -> le hash doit etre inchange.
    const storedItem = {
      ...baseItem,
      h_mo_atelier: null,
      k_mo_atelier: 1,
      labor_role_atelier_id: null,
      h_mo_chantier: null,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
    };

    const supabase = createSupabaseSealMock({
      versionSelectResponses: [
        { data: createVersionAccessRow("sent"), error: null },
        { data: { ...version, seal_hash: legacyHash }, error: null },
      ],
      estimateItemsResult: { data: [storedItem], error: null },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(verifyEstimateSeal(VERSION_ID)).resolves.toMatchObject({
      valid: true,
    });
  });
});

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  patchEstimateStatus,
  verifyEstimateSeal,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const estimateVersionsUpdate = vi.fn((payload: unknown) => {
    updatePayloads.push(payload);
    const builder = {
      eq: vi.fn(),
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
    builder.eq.mockReturnValue(builder);
    return builder;
  });

  const estimateItemsBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
  };
  estimateItemsBuilder.eq.mockReturnValue(estimateItemsBuilder);
  estimateItemsBuilder.order
    .mockImplementationOnce(() => estimateItemsBuilder)
    .mockResolvedValue(input.estimateItemsResult);

  const estimateItemsSelect = vi.fn(() => estimateItemsBuilder);

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
    margin_multiplier: 1.2,
    tax_rate_bp: 2000,
    updated_at: UPDATED_AT,
    total_ht_cents: 10000,
    total_tax_cents: 2000,
    total_ttc_cents: 12000,
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

describe("estimate status seal flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("computes seal hash and inserts sent event on draft -> sent", async () => {
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

    expect(supabase.__mocks.updatePayloads).toHaveLength(1);
    const updatePayload = supabase.__mocks.updatePayloads[0] as {
      status: string;
      seal_hash: string;
    };
    expect(updatePayload.status).toBe("sent");
    expect(updatePayload.seal_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(supabase.__mocks.eventInsert).toHaveBeenCalledTimes(1);
    expect(supabase.__mocks.eventInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        estimate_version_id: VERSION_ID,
        tenant_id: TENANT_ID,
        event_type: "sent",
        created_by: USER_ID,
        metadata: expect.objectContaining({
          seal_hash: updatePayload.seal_hash,
        }),
      })
    );
  });
});

describe("verifyEstimateSeal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

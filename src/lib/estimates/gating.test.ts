import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlagValueForTenant: vi.fn(),
  getStalePriceDaysForTenant: vi.fn(),
}));

import {
  evaluateEstimateSendGating,
} from "@/lib/estimates/gating";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

function createOrderBuilder(result: QueryResult, requiredOrders = 1) {
  let orderCallCount = 0;
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.order.mockImplementation(() => {
    orderCallCount += 1;
    if (orderCallCount >= requiredOrders) {
      return Promise.resolve(result);
    }
    return builder;
  });

  return builder;
}

function createSupabaseGatingMock(input: {
  items: unknown[];
  marginTiers: unknown[];
  documents: unknown[];
  supplierPrices?: unknown[];
}) {
  const estimateItemsBuilder = createOrderBuilder(
    {
      data: input.items,
      error: null,
    },
    1
  );
  const marginTiersBuilder = createOrderBuilder(
    {
      data: input.marginTiers,
      error: null,
    },
    2
  );
  const estimateDocumentsBuilder = {
    eq: vi.fn(),
    limit: vi.fn().mockResolvedValue({
      data: input.documents,
      error: null,
    }),
  };
  estimateDocumentsBuilder.eq.mockReturnValue(estimateDocumentsBuilder);

  const supplierPricesBuilder = {
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({
      data: input.supplierPrices ?? [],
      error: null,
    }),
  };
  supplierPricesBuilder.eq.mockReturnValue(supplierPricesBuilder);

  return {
    from: vi.fn((table: string) => {
      if (table === "estimate_items") {
        return {
          select: vi.fn(() => estimateItemsBuilder),
        };
      }
      if (table === "margin_tiers") {
        return {
          select: vi.fn(() => marginTiersBuilder),
        };
      }
      if (table === "estimate_documents") {
        return {
          select: vi.fn(() => estimateDocumentsBuilder),
        };
      }
      if (table === "supplier_pricebook") {
        return {
          select: vi.fn(() => supplierPricesBuilder),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createLineItem(input: {
  id: string;
  quantity: number;
  unitPriceHtCents: number;
  laborHours?: number;
  laborRoleId?: string | null;
  selectedSupplierPriceId?: string | null;
}) {
  return {
    id: input.id,
    item_type: "line",
    quantity: input.quantity,
    unit_price_ht_cents: input.unitPriceHtCents,
    h_mo: input.laborHours ?? 1,
    labor_role_id: input.laborRoleId ?? "role-1",
    selected_supplier_price_id: input.selectedSupplierPriceId ?? null,
    h_mo_atelier: null,
    h_mo_chantier: null,
    labor_role_atelier_id: null,
    labor_role_chantier_id: null,
    k_mo_atelier: 1,
    k_mo_chantier: 1,
  };
}

describe("estimate send gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue(null);
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(90);
  });

  it("returns canSend=true when no flags are raised", async () => {
    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 2, unitPriceHtCents: 5000 })],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        total_ht_cents: 10000,
      },
      project: {
        notes: null,
      },
    });

    expect(result.canSend).toBe(true);
    expect(result.blockingFlags).toHaveLength(0);
    expect(result.warningFlags).toHaveLength(0);
  });

  it("returns blocking flags for tiered margin without tiers and missing pdf", async () => {
    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 0, unitPriceHtCents: 0 })],
      marginTiers: [],
      documents: [],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "tiered",
        total_ht_cents: 10000,
      },
      project: {
        notes: null,
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags.map((flag) => flag.key)).toEqual(
      expect.arrayContaining([
        "missing_price",
        "missing_quantity",
        "margin_not_configured",
        "no_pdf_generated",
      ])
    );
  });

  it("supports warning override via feature flags", async () => {
    vi.mocked(getFeatureFlagValueForTenant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("missing_price");

    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 1, unitPriceHtCents: 0 })],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        total_ht_cents: 10000,
      },
      project: {
        notes: null,
      },
    });

    expect(result.canSend).toBe(true);
    expect(result.blockingFlags).toHaveLength(0);
    expect(result.warningFlags.map((flag) => flag.key)).toContain("missing_price");
  });

  it("adds supplier_price_outdated warning for stale selected supplier prices", async () => {
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(30);

    const supabase = createSupabaseGatingMock({
      items: [
        createLineItem({
          id: "line-1",
          quantity: 1,
          unitPriceHtCents: 5000,
          selectedSupplierPriceId: "sp-1",
        }),
      ],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
      supplierPrices: [
        {
          id: "sp-1",
          updated_at: "2025-01-01T00:00:00.000Z",
          created_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        total_ht_cents: 10000,
      },
      project: {
        notes: null,
      },
    });

    expect(result.warningFlags.map((flag) => flag.key)).toContain(
      "supplier_price_outdated"
    );
  });
});

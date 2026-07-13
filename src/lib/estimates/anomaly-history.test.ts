import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// We test getAnomalyTrend's internal flag-transition logic by mocking
// the supabase layer and feeding controlled audit_logs data.
// getCurrentAnomalySummary is tested indirectly via the route test,
// since it relies heavily on supabase joins. Here we focus on
// the trend computation and flag transition detection.
// ---------------------------------------------------------------------------

vi.mock("@/lib/feature-flags", () => ({
  getStalePriceDaysForTenant: vi.fn().mockResolvedValue(90),
  getFeatureFlagValueForTenant: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/catalogue/stale-prices", () => ({
  isPriceStale: vi.fn().mockReturnValue(false),
  DEFAULT_STALE_PRICE_DAYS: 90,
  parseStalePriceDays: vi.fn().mockReturnValue(90),
}));

vi.mock("@/lib/estimates/outlier-detection", () => ({
  detectEstimateOutliers: vi.fn().mockReturnValue({}),
  ESTIMATE_OUTLIER_FLAG_KEYS: ["price_outlier", "quantity_outlier"],
}));

vi.mock("@/lib/estimate-quality", () => ({
  ESTIMATE_QUALITY_FLAG_KEYS: [
    "missing_price",
    "missing_quantity",
    "missing_labor_time",
    "missing_labor_role",
    "supplier_price_outdated",
    "labor_split_incomplete",
    "price_outlier",
    "quantity_outlier",
  ],
  ESTIMATE_QUALITY_FLAG_META: {
    missing_price: { label: "Prix manquant", description: "" },
    missing_quantity: { label: "Quantite manquante", description: "" },
    missing_labor_time: { label: "Temps MO manquant", description: "" },
    missing_labor_role: { label: "Role MO manquant", description: "" },
    supplier_price_outdated: {
      label: "Prix fournisseur obsolete",
      description: "",
    },
    labor_split_incomplete: { label: "Split MO incomplet", description: "" },
    price_outlier: { label: "Prix atypique", description: "" },
    quantity_outlier: { label: "Quantite atypique", description: "" },
  },
  computeEstimateQualityFlagsByItemId: vi.fn().mockReturnValue({}),
}));

import {
  getAnomalyTrend,
  getCurrentAnomalySummary,
} from "@/lib/estimates/anomaly-history";
import { computeEstimateQualityFlagsByItemId } from "@/lib/estimate-quality";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildMockSupabase(auditRows: Record<string, unknown>[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: auditRows, error: null }),
  };

  return {
    from: vi.fn().mockReturnValue(query),
    __query: query,
  };
}

function buildMockSummarySupabase(params: {
  estimateItemsRows: Record<string, unknown>[];
  dismissalRows?: Record<string, unknown>[];
}) {
  const estimateItemsBuilder = {
    eq: vi.fn().mockReturnThis(),
    data: params.estimateItemsRows,
    error: null,
  };

  const estimateItemSelect = vi.fn().mockReturnValue(estimateItemsBuilder);

  const dismissalResult = {
    data: params.dismissalRows ?? [],
    error: null,
  };

  const dismissalBuilder = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnValue(dismissalResult),
  };

  const dismissalSelect = vi.fn().mockReturnValue(dismissalBuilder);

  return {
    from: vi.fn((table: string) => {
      if (table === "estimate_items") {
        return {
          select: estimateItemSelect,
        };
      }

      if (table === "estimate_item_outlier_dismissals") {
        return {
          select: dismissalSelect,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      estimateItemSelect,
      dismissalSelect,
    },
  };
}

describe("getAnomalyTrend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty trend for no audit logs", async () => {
    const supabase = buildMockSupabase([]);
    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    expect(result.trend).toEqual([]);
    expect(result.avgResolution).toEqual([]);
  });

  it("detects flag appearance on INSERT", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-15T10:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    expect(result.trend).toEqual([
      { period: "2025-06", opened: 1, resolved: 0 },
    ]);
  });

  it("detects multiple flags on same INSERT", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-15T10:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 0, h_mo: 0, labor_role_id: null },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    // missing_price, missing_quantity, missing_labor_time all opened
    expect(result.trend).toEqual([
      { period: "2025-06", opened: 3, resolved: 0 },
    ]);
  });

  it("detects flag resolution on UPDATE", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-10T10:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-2",
        created_at: "2025-06-12T10:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
        after_data: { unit_price_ht_cents: 1000, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    // INSERT: missing_price opened. UPDATE: missing_price resolved.
    expect(result.trend).toEqual([
      { period: "2025-06", opened: 1, resolved: 1 },
    ]);
  });

  it("computes resolution time", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-01T00:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-2",
        created_at: "2025-06-04T00:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
        after_data: { unit_price_ht_cents: 500, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    expect(result.avgResolution).toEqual([
      { flagKey: "missing_price", flagLabel: "Prix manquant", avgDays: 3 },
    ]);
  });

  it("detects flag resolution on DELETE", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-01T00:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-2",
        created_at: "2025-06-02T00:00:00Z",
        record_id: "item-1",
        action: "DELETE",
        before_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
        after_data: null,
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    // INSERT opens missing_price, DELETE resolves it
    expect(result.trend).toEqual([
      { period: "2025-06", opened: 1, resolved: 1 },
    ]);
  });

  it("handles multiple transitions on the same item", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-01T00:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 0, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-2",
        created_at: "2025-06-05T00:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: { unit_price_ht_cents: 0, quantity: 0, h_mo: 2, labor_role_id: "role-1" },
        after_data: { unit_price_ht_cents: 500, quantity: 0, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-3",
        created_at: "2025-06-10T00:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: { unit_price_ht_cents: 500, quantity: 0, h_mo: 2, labor_role_id: "role-1" },
        after_data: { unit_price_ht_cents: 500, quantity: 3, h_mo: 2, labor_role_id: "role-1" },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    // INSERT opens missing_price + missing_quantity
    // UPDATE 1 resolves missing_price
    // UPDATE 2 resolves missing_quantity
    expect(result.trend).toEqual([
      { period: "2025-06", opened: 2, resolved: 2 },
    ]);
  });

  it("applies date_from/date_to filter on trend display", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-05-15T10:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-2",
        created_at: "2025-07-15T10:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
        after_data: { unit_price_ht_cents: 500, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {
      date_from: "2025-06-01",
      date_to: "2025-06-30",
    });

    // Both events are outside June, so trend is empty for that window
    // But the running state is still built correctly
    expect(result.trend).toEqual([]);
  });

  it("detects missing_labor_role flag correctly", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-01T00:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 500, quantity: 5, h_mo: 2, labor_role_id: null },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    // missing_labor_role: h_mo > 0 && labor_role_id is null
    expect(result.trend).toEqual([
      { period: "2025-06", opened: 1, resolved: 0 },
    ]);
  });

  it("handles empty before/after data gracefully", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-1",
        created_at: "2025-06-01T00:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: null,
        after_data: null,
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    expect(result.trend).toEqual([]);
    expect(result.avgResolution).toEqual([]);
  });

  it("queries newest rows but replays transitions chronologically", async () => {
    const supabase = buildMockSupabase([
      {
        id: "log-2",
        created_at: "2025-06-03T00:00:00Z",
        record_id: "item-1",
        action: "UPDATE",
        before_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
        after_data: { unit_price_ht_cents: 500, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
      {
        id: "log-1",
        created_at: "2025-06-01T00:00:00Z",
        record_id: "item-1",
        action: "INSERT",
        before_data: null,
        after_data: { unit_price_ht_cents: 0, quantity: 5, h_mo: 2, labor_role_id: "role-1" },
      },
    ]);

    const result = await getAnomalyTrend(supabase as never, TENANT_ID, {});

    expect(supabase.__query.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: false }
    );
    expect(result.avgResolution).toEqual([
      { flagKey: "missing_price", flagLabel: "Prix manquant", avgDays: 2 },
    ]);
  });
});

describe("getCurrentAnomalySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives version label from version_number and uses it for search", async () => {
    vi.mocked(computeEstimateQualityFlagsByItemId).mockReturnValue({
      "item-1": ["missing_price"],
    });

    const supabase = buildMockSummarySupabase({
      estimateItemsRows: [
        {
          id: "item-1",
          item_type: "line",
          selected_supplier_price_id: null,
          estimate_versions: {
            id: "version-1",
            title: null,
            version_number: 12,
            tenant_id: TENANT_ID,
            estimate_projects: {
              id: "project-1",
              name: "Projet A",
              is_archived: false,
              user_id: "owner-1",
              profiles: {
                id: "owner-1",
                full_name: "Owner One",
              },
            },
          },
        },
      ],
      dismissalRows: [],
    });

    const result = await getCurrentAnomalySummary(supabase as never, TENANT_ID, {
      search: "v12",
    });

    expect(supabase.__mocks.estimateItemSelect).toHaveBeenCalledWith(
      expect.stringContaining("title")
    );
    expect(supabase.__mocks.estimateItemSelect).toHaveBeenCalledWith(
      expect.stringContaining("version_number")
    );
    expect(supabase.__mocks.estimateItemSelect).not.toHaveBeenCalledWith(
      expect.stringContaining("label")
    );
    expect(result.currentAnomalies).toEqual([
      expect.objectContaining({
        versionId: "version-1",
        versionLabel: "V12",
        projectName: "Projet A",
        ownerName: "Owner One",
        flagKey: "missing_price",
        severity: "blocking",
        itemCount: 1,
      }),
    ]);
    expect(result.ownerOptions).toEqual([
      { id: "owner-1", name: "Owner One" },
    ]);
  });

  it("sorts blocking anomalies deterministically and returns named owner options", async () => {
    vi.mocked(computeEstimateQualityFlagsByItemId)
      .mockReturnValueOnce({ "item-warning": ["missing_labor_time"] })
      .mockReturnValueOnce({ "item-blocking-b": ["missing_price"] })
      .mockReturnValueOnce({
        "item-blocking-a-1": ["missing_price"],
        "item-blocking-a-2": ["missing_price"],
      });

    function item(input: {
      id: string;
      versionId: string;
      projectName: string;
      ownerId: string;
      ownerName: string;
    }) {
      return {
        id: input.id,
        item_type: "line",
        selected_supplier_price_id: null,
        estimate_versions: {
          id: input.versionId,
          title: null,
          version_number: 1,
          tenant_id: TENANT_ID,
          estimate_projects: {
            id: `project-${input.versionId}`,
            name: input.projectName,
            is_archived: false,
            user_id: input.ownerId,
            profiles: { id: input.ownerId, full_name: input.ownerName },
          },
        },
      };
    }

    const supabase = buildMockSummarySupabase({
      estimateItemsRows: [
        item({
          id: "item-warning",
          versionId: "version-warning",
          projectName: "Projet Z",
          ownerId: "owner-z",
          ownerName: "Zoé",
        }),
        item({
          id: "item-blocking-b",
          versionId: "version-blocking-b",
          projectName: "Projet B",
          ownerId: "owner-b",
          ownerName: "Bruno",
        }),
        item({
          id: "item-blocking-a-1",
          versionId: "version-blocking-a",
          projectName: "Projet A",
          ownerId: "owner-a",
          ownerName: "Alice",
        }),
        item({
          id: "item-blocking-a-2",
          versionId: "version-blocking-a",
          projectName: "Projet A",
          ownerId: "owner-a",
          ownerName: "Alice",
        }),
      ],
    });

    const result = await getCurrentAnomalySummary(
      supabase as never,
      TENANT_ID,
      {}
    );

    expect(result.currentAnomalies.map((row) => [
      row.projectName,
      row.severity,
      row.itemCount,
    ])).toEqual([
      ["Projet A", "blocking", 2],
      ["Projet B", "blocking", 1],
      ["Projet Z", "warning", 1],
    ]);
    expect(result.ownerOptions).toEqual([
      { id: "owner-a", name: "Alice" },
      { id: "owner-b", name: "Bruno" },
      { id: "owner-z", name: "Zoé" },
    ]);
  });
});

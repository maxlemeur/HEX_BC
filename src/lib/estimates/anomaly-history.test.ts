import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


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
    "line_nature_mismatch",
    "supplier_price_outdated",
    "labor_split_incomplete",
    "price_outlier",
    "quantity_outlier",
  ],
  ESTIMATE_QUALITY_FLAG_META: {
    missing_price: { label: "Prix manquant", description: "" },
    missing_quantity: { label: "Quantité manquante", description: "" },
    missing_labor_time: { label: "Temps MO manquant", description: "" },
    missing_labor_role: { label: "Rôle MO manquant", description: "" },
    line_nature_mismatch: { label: "Nature incoherente", description: "" },
    supplier_price_outdated: {
      label: "Prix fournisseur obsolete",
      description: "",
    },
    labor_split_incomplete: { label: "Split MO incomplet", description: "" },
    price_outlier: { label: "Prix atypique", description: "" },
    quantity_outlier: { label: "Quantité atypique", description: "" },
  },
  computeEstimateQualityFlagsByItemId: vi.fn().mockReturnValue({}),
}));

import { getAnomalyTrend } from "@/lib/estimates/anomaly-history";

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

describe("getAnomalyTrend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

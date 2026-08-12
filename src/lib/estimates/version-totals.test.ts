import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import {
  calculateEstimateSnapshotForItems,
  calculateEstimateTotalsForItems,
} from "@/lib/estimates/version-totals";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadMarginTiersForTotals } from "@/lib/estimates/margin-tiers-loader";

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock("@/lib/estimates/margin-tiers-loader", () => ({
  loadMarginTiersForTotals: vi.fn(),
}));

const lineItems = [
  {
    id: "line-1",
    parent_id: null,
    item_type: "line",
    title: "Ligne",
    description: null,
    position: 1,
    quantity: 1,
    unit_price_ht_cents: 1_000,
    tax_rate_bp: 1_000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 1_000,
    labor_role_id: null,
    category_id: null,
    line_total_ht_cents: 1_000,
    line_tax_cents: 100,
    line_total_ttc_cents: 1_100,
  },
] as EstimateItemRecord[];

const baseVersion = {
  margin_multiplier: 1,
  margin_mode: "fixed" as const,
  tax_rate_bp: 2_000,
  discount_bp: 0,
  discount_mode: "simple" as const,
  discount_steps: [],
  global_coefficient: 1,
  rounding_mode: "none" as const,
  rounding_step_cents: 0,
  contractor_role: "principal" as const,
};

describe("calculateEstimateTotalsForItems", () => {
  beforeEach(() => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    vi.mocked(loadMarginTiersForTotals).mockResolvedValue([]);
  });

  it.each([
    ["stored legacy", 1, 200],
    ["missing legacy fallback", undefined, 200],
    ["stored unified", 2, 100],
  ])("uses the %s calculation contract", async (_label, calcEngineVersion, tax) => {
    const result = await calculateEstimateTotalsForItems({
      supabase: {} as never,
      tenantId: "tenant-1",
      projectUserId: "user-1",
      version: {
        ...baseVersion,
        calc_engine_version: calcEngineVersion,
      },
      lineItems,
    });

    expect(result).toEqual({
      total_ht_cents: 1_000,
      total_tax_cents: tax,
      total_ttc_cents: 1_000 + tax,
    });
  });

  it("bases a v2 tiered discount on the resolved margin", async () => {
    vi.mocked(loadMarginTiersForTotals).mockResolvedValue([
      { threshold_cents: 0, multiplier: 2 },
    ]);

    const result = await calculateEstimateTotalsForItems({
      supabase: {} as never,
      tenantId: "tenant-1",
      projectUserId: "user-1",
      version: {
        ...baseVersion,
        margin_mode: "tiered",
        discount_bp: 1_000,
        calc_engine_version: 2,
      },
      lineItems,
    });

    expect(result).toEqual({
      total_ht_cents: 1_800,
      total_tax_cents: 180,
      total_ttc_cents: 1_980,
    });
  });

  it("freezes an owner-scoped, sorted and exhaustive calculation context", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(loadMarginTiersForTotals).mockResolvedValue([
      { threshold_cents: 0, multiplier: 1.2, position: 2 },
      { threshold_cents: 0, multiplier: 1.3, position: 4 },
    ]);
    const eq = vi.fn();
    const roleQuery = {
      select: vi.fn(),
      eq,
      in: vi.fn().mockResolvedValue({
        data: [
          { id: "role-z", hourly_rate_cents: 4_500 },
          { id: "role-a-missing", hourly_rate_cents: 3_500 },
        ],
        error: null,
      }),
    };
    roleQuery.select.mockReturnValue(roleQuery);
    eq.mockReturnValue(roleQuery);
    const supabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe("labor_roles");
        return roleQuery;
      }),
    };
    const itemsWithRoles = [
      {
        ...lineItems[0],
        labor_role_id: "role-z",
        labor_role_atelier_id: "role-a-missing",
      },
    ];

    const result = await calculateEstimateSnapshotForItems({
      supabase: supabase as never,
      tenantId: "tenant-1",
      projectUserId: "owner-1",
      version: {
        ...baseVersion,
        margin_mode: "tiered",
        calc_engine_version: 2,
      },
      lineItems: itemsWithRoles,
    });

    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(result.context).toEqual({
      effective_margin_multiplier: 1.3,
      labor_split_enabled: true,
      labor_roles: [
        { id: "role-a-missing", hourly_rate_cents: 3_500 },
        { id: "role-z", hourly_rate_cents: 4_500 },
      ],
      margin_tiers: [
        { threshold_cents: 0, multiplier: 1.2 },
        { threshold_cents: 0, multiplier: 1.3 },
      ],
    });
  });

  it("freezes the selected tier when cost crosses the threshold both ways", async () => {
    vi.mocked(loadMarginTiersForTotals).mockResolvedValue([
      { threshold_cents: 0, multiplier: 1.6 },
      { threshold_cents: 10_000, multiplier: 1.4 },
    ]);
    const calculate = (costCents: number) =>
      calculateEstimateSnapshotForItems({
        supabase: {} as never,
        tenantId: "tenant-1",
        projectUserId: "owner-1",
        version: {
          ...baseVersion,
          margin_mode: "tiered",
          calc_engine_version: 2,
        },
        lineItems: [
          {
            ...lineItems[0],
            unit_price_ht_cents: costCents,
          },
        ],
      });

    const above = await calculate(10_001);
    const below = await calculate(9_999);

    expect(above.context.effective_margin_multiplier).toBe(1.4);
    expect(below.context.effective_margin_multiplier).toBe(1.6);
  });

  it("materializes the default tiers in the authoritative context", async () => {
    vi.mocked(loadMarginTiersForTotals).mockResolvedValue([]);

    const result = await calculateEstimateSnapshotForItems({
      supabase: {} as never,
      tenantId: "tenant-1",
      projectUserId: "owner-1",
      version: {
        ...baseVersion,
        margin_mode: "tiered",
        calc_engine_version: 2,
      },
      lineItems,
    });

    expect(result.context.margin_tiers).not.toEqual([]);
    expect(result.context.effective_margin_multiplier).toBe(1.6);
  });

  it("rejects a v2 role that does not belong to the project owner", async () => {
    const roleQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    roleQuery.select.mockReturnValue(roleQuery);
    roleQuery.eq.mockReturnValue(roleQuery);

    await expect(
      calculateEstimateSnapshotForItems({
        supabase: { from: vi.fn(() => roleQuery) } as never,
        tenantId: "tenant-1",
        projectUserId: "owner-1",
        version: { ...baseVersion, calc_engine_version: 2 },
        lineItems: [{ ...lineItems[0], labor_role_id: "foreign-role" }],
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_LABOR_ROLE_OWNER_MISMATCH",
      details: { missing_role_ids: ["foreign-role"] },
    });
  });

  it("keeps the historical zero-rate fallback for a v1 missing role", async () => {
    const roleQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    roleQuery.select.mockReturnValue(roleQuery);
    roleQuery.eq.mockReturnValue(roleQuery);

    const result = await calculateEstimateSnapshotForItems({
      supabase: { from: vi.fn(() => roleQuery) } as never,
      tenantId: "tenant-1",
      projectUserId: "owner-1",
      version: { ...baseVersion, calc_engine_version: 1 },
      lineItems: [{ ...lineItems[0], labor_role_id: "legacy-missing-role" }],
    });

    expect(result.context.labor_roles).toEqual([
      { id: "legacy-missing-role", hourly_rate_cents: 0 },
    ]);
  });

  it("rejects a v2 publication snapshot with unsplit hours but no role", async () => {
    await expect(
      calculateEstimateSnapshotForItems({
        supabase: {} as never,
        tenantId: "tenant-1",
        projectUserId: "owner-1",
        version: { ...baseVersion, calc_engine_version: 2 },
        lineItems: [{ ...lineItems[0], h_mo: 2, labor_role_id: null }],
        requireCompleteLaborRoleAssignments: true,
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_LABOR_ROLE_REQUIRED",
      details: {
        missing_assignments: [
          {
            item_id: "line-1",
            hours_field: "h_mo",
            role_field: "labor_role_id",
          },
        ],
      },
    });
  });

  it("rejects every missing split role in a v2 publication snapshot", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);

    await expect(
      calculateEstimateSnapshotForItems({
        supabase: {} as never,
        tenantId: "tenant-1",
        projectUserId: "owner-1",
        version: { ...baseVersion, calc_engine_version: 2 },
        lineItems: [
          {
            ...lineItems[0],
            h_mo: 5,
            labor_role_id: null,
            h_mo_atelier: 2,
            labor_role_atelier_id: null,
            h_mo_chantier: 3,
            labor_role_chantier_id: null,
          },
        ],
        requireCompleteLaborRoleAssignments: true,
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_LABOR_ROLE_REQUIRED",
      details: {
        missing_assignments: [
          {
            item_id: "line-1",
            hours_field: "h_mo_atelier",
            role_field: "labor_role_atelier_id",
          },
          {
            item_id: "line-1",
            hours_field: "h_mo_chantier",
            role_field: "labor_role_chantier_id",
          },
        ],
      },
    });
  });

  it("rejects a missing legacy role when the split flag is on but the line has no split payload", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);

    await expect(
      calculateEstimateSnapshotForItems({
        supabase: {} as never,
        tenantId: "tenant-1",
        projectUserId: "owner-1",
        version: { ...baseVersion, calc_engine_version: 2 },
        lineItems: [{ ...lineItems[0], h_mo: 2, labor_role_id: null }],
        requireCompleteLaborRoleAssignments: true,
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_LABOR_ROLE_REQUIRED",
      details: {
        missing_assignments: [
          {
            item_id: "line-1",
            hours_field: "h_mo",
            role_field: "labor_role_id",
          },
        ],
      },
    });
  });

  it("keeps an incomplete v2 draft calculation editable", async () => {
    const result = await calculateEstimateSnapshotForItems({
      supabase: {} as never,
      tenantId: "tenant-1",
      projectUserId: "owner-1",
      version: { ...baseVersion, calc_engine_version: 2 },
      lineItems: [{ ...lineItems[0], h_mo: 2, labor_role_id: null }],
    });

    expect(result.breakdown.totals.saleTotalCents).toBe(1_000);
  });

  it("keeps v1 publication compatibility for hours without a role", async () => {
    const result = await calculateEstimateSnapshotForItems({
      supabase: {} as never,
      tenantId: "tenant-1",
      projectUserId: "owner-1",
      version: { ...baseVersion, calc_engine_version: 1 },
      lineItems: [{ ...lineItems[0], h_mo: 2, labor_role_id: null }],
      requireCompleteLaborRoleAssignments: true,
    });

    expect(result.breakdown.totals.saleTotalCents).toBe(1_000);
  });
});

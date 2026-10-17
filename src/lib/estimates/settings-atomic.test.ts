import { beforeEach, describe, expect, it, vi } from "vitest";

const calculationMocks = vi.hoisted(() => ({
  readAllEstimateItems: vi.fn(),
  assertEstimateVersionUnchanged: vi.fn(),
  calculateEstimateSnapshotForItems: vi.fn(),
  calculateEstimateV3SnapshotForItems: vi.fn(),
}));

vi.mock("@/lib/estimates/read-all-items-server", () => ({
  readAllEstimateItems: calculationMocks.readAllEstimateItems,
  assertEstimateVersionUnchanged: calculationMocks.assertEstimateVersionUnchanged,
}));
vi.mock("@/lib/estimates/version-totals", () => ({
  calculateEstimateSnapshotForItems: calculationMocks.calculateEstimateSnapshotForItems,
  calculateEstimateV3SnapshotForItems: calculationMocks.calculateEstimateV3SnapshotForItems,
}));

import { persistAtomicEstimateSettings } from "@/lib/estimates/settings-atomic";

// Lot 2, sous-lot 2.1 (docs/testing/estimate-engine-v3-2.1.md, F-TS-08). Isolation justifiée :
// les réglages d'une v3 seraient recalculés avec le moteur v1 (taux de version forcé sur les
// lignes, projections v1) puis envoyés à la RPC. 2.1 les refusait par leur nom ; 2.5 livre la
// branche v3 (D5 à D8) : l'assertion est réécrite délibérément, le moteur v1/v2 n'est jamais
// appelé et la RPC reçoit les sept totaux v3 sans multiplicateur de marge réécrit.
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-10-17T08:00:00.000Z";

function v3Draft() {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    status: "draft",
    updated_at: UPDATED_AT,
    content_revision: 4,
    calc_engine_version: 3,
    margin_multiplier: 1,
    margin_mode: "fixed",
    margin_bp: 0,
    discount_bp: 0,
    discount_amount_cents: null,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
    rounding_adjustment_cents: 0,
  };
}

function createSupabase(version: Record<string, unknown>) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue({ data: version, error: null }),
  };
  return { from: vi.fn(() => builder) };
}

describe("persistAtomicEstimateSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calculationMocks.readAllEstimateItems.mockResolvedValue([]);
    calculationMocks.assertEstimateVersionUnchanged.mockResolvedValue(undefined);
    calculationMocks.calculateEstimateSnapshotForItems.mockResolvedValue({
      breakdown: {
        totals: { saleTotalCents: 0, adjustedTaxCents: 0, roundedTtcCents: 0, roundingAdjustmentCents: 0, appliedMarginMultiplier: 1 },
        lineById: new Map(),
      },
      dependencies: { labor_roles: [], margin_tiers: [], labor_split_flag: null },
    });
  });

  it("routes v3 settings to the v3 engine, never to the v1/v2 one", async () => {
    const version = v3Draft();
    const v3Totals = { gross_ht_cents: 0, discount_applied_cents: 0, commercial_rounding_cents: 0 };
    calculationMocks.calculateEstimateV3SnapshotForItems.mockResolvedValue({
      breakdown: {
        lines: [],
        totals: { ...v3Totals, total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, rounding_adjustment_cents: 0 },
      },
      dependencies: { labor_roles: [], margin_tiers: [], labor_split_flag: null },
    });
    const savedVersion = { ...version, ...v3Totals, content_revision: 5, updated_at: "2026-10-17T08:01:00.000Z" };
    const rpcClient = { rpc: vi.fn().mockResolvedValue({ data: { version: savedVersion, items: [] }, error: null }) };

    await expect(
      persistAtomicEstimateSettings({
        supabase: createSupabase(version) as never,
        rpcClient: rpcClient as never,
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        projectUserId: USER_ID,
        authorizedVersion: version as never,
        expectedUpdatedAt: UPDATED_AT,
        expectedContentRevision: 4,
        draftLockSessionId: "55555555-5555-4555-8555-555555555555",
        patch: { margin_bp: 1500 },
      })
    ).resolves.toMatchObject({ version: { id: VERSION_ID, content_revision: 5 } });

    expect(calculationMocks.calculateEstimateSnapshotForItems).not.toHaveBeenCalled();
    expect(calculationMocks.calculateEstimateV3SnapshotForItems).toHaveBeenCalledOnce();
    expect(rpcClient.rpc).toHaveBeenCalledWith("save_estimate_settings_atomic", expect.objectContaining({
      p_settings_patch: { margin_bp: 1500 },
      p_line_projections: [],
      p_totals: { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, rounding_adjustment_cents: 0, ...v3Totals },
    }));
  });
});

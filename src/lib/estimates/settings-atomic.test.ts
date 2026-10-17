import { beforeEach, describe, expect, it, vi } from "vitest";

const calculationMocks = vi.hoisted(() => ({
  readAllEstimateItems: vi.fn(),
  assertEstimateVersionUnchanged: vi.fn(),
  calculateEstimateSnapshotForItems: vi.fn(),
}));

vi.mock("@/lib/estimates/read-all-items-server", () => ({
  readAllEstimateItems: calculationMocks.readAllEstimateItems,
  assertEstimateVersionUnchanged: calculationMocks.assertEstimateVersionUnchanged,
}));
vi.mock("@/lib/estimates/version-totals", () => ({
  calculateEstimateSnapshotForItems: calculationMocks.calculateEstimateSnapshotForItems,
}));

import { persistAtomicEstimateSettings } from "@/lib/estimates/settings-atomic";

// Lot 2, sous-lot 2.1 (docs/testing/estimate-engine-v3-2.1.md, F-TS-08). Isolation justifiée :
// les réglages d'une v3 seraient recalculés avec le moteur v1 (taux de version forcé sur les
// lignes, projections v1) puis envoyés à la RPC ; aucune v3 n'existe en E2E avant 2.5 pour le
// montrer. Le refus doit être nommé avant tout calcul et tout appel SQL.
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

  it("refuses v3 settings by name before any calculation or RPC", async () => {
    const version = v3Draft();
    const rpcClient = { rpc: vi.fn().mockResolvedValue({ data: { version, items: [] }, error: null }) };

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
    ).rejects.toMatchObject({ code: "ESTIMATE_ENGINE_UNAVAILABLE", engineVersion: 3 });

    expect(calculationMocks.calculateEstimateSnapshotForItems).not.toHaveBeenCalled();
    expect(rpcClient.rpc).not.toHaveBeenCalled();
  });
});

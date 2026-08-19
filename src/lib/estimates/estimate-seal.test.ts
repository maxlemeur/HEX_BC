import { describe, expect, it } from "vitest";

import {
  CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION,
  LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
  PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION,
  UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION,
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  type EstimateSealVersionFields,
} from "@/lib/estimates/estimate-seal";
import type { Database } from "@/types/database";

type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

function createVersion(
  overrides: Partial<EstimateSealVersionFields> = {},
): EstimateSealVersionFields {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_number: 2,
    title: "Offre hydraulique",
    exclusions: "Hors peinture",
    date_devis: "2026-08-12",
    validite_jours: 45,
    currency: "EUR",
    total_ht_cents: 10_000,
    total_tax_cents: 2_000,
    total_ttc_cents: 12_000,
    rounding_adjustment_cents: 50,
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
    calc_snapshot_context: { labor_split_enabled: true },
    contractor_role: "principal",
    seal_hash: null,
    ...overrides,
  };
}

function createItem(overrides: Partial<EstimateItemRow> = {}): EstimateItemRow {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    parent_id: null,
    item_type: "line",
    line_nature: "supply_and_labor",
    position: 2,
    title: "Collecteur cuivre",
    description: "DN20",
    quantity: 4,
    unit_price_ht_cents: 2_500,
    tax_rate_bp: 2_000,
    k_fo: 1,
    h_mo: 0.5,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: 2_500,
    labor_role_id: "role-1",
    category_id: "category-1",
    supply_type_id: null,
    selected_supplier_price_id: null,
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    snapshot_pu_ht_cents: 2_475,
    snapshot_fo_ht_cents: 2_000,
    snapshot_mo_ht_cents: 475,
    snapshot_mo_atelier_ht_cents: null,
    snapshot_mo_chantier_ht_cents: null,
    line_total_ht_cents: 9_900,
    line_tax_cents: 1_980,
    line_total_ttc_cents: 11_880,
    ...overrides,
  };
}

describe("estimate seal payload versions", () => {
  it("exposes the published payload version constants in order", () => {
    expect(LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION).toBe(1);
    expect(PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION).toBe(2);
    expect(UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION).toBe(3);
    expect(CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION).toBe(4);
  });

  it("builds the current payload for an engine-2 version and items", () => {
    const items = [
      createItem({ id: "line-b", position: 2, title: "Vanne", quantity: 1 }),
      createItem({ id: "line-a", position: 1, title: "Collecteur", quantity: 4 }),
    ];

    const payload = buildCanonicalEstimateSealPayload({
      version: createVersion(),
      items,
    });

    expect(payload.meta).toEqual({
      payload_version: CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION,
      version_id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
    });
    expect(payload.version.total_ht_cents).toBe(10_000);
    expect(payload.version.rounding_adjustment_cents).toBe(50);
    expect(payload.version.calc_engine_version).toBe(2);
    expect(payload.items.map((item) => item.id)).toEqual(["line-a", "line-b"]);
    expect(payload.items[0]).toMatchObject({
      quantity: 4,
      line_nature: "supply_and_labor",
      parent_id: null,
    });
  });
});

describe("computeEstimateSealHash", () => {
  it("is stable for the same fixture and changes with contractual fields", () => {
    const version = createVersion();
    const items = [createItem()];
    const payload = buildCanonicalEstimateSealPayload({ version, items });

    const first = computeEstimateSealHash(payload);
    const second = computeEstimateSealHash(payload);
    const rebuilt = computeEstimateSealHash(
      buildCanonicalEstimateSealPayload({ version, items }),
    );

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(rebuilt).toBe(first);

    const totalChanged = computeEstimateSealHash(
      buildCanonicalEstimateSealPayload({
        version: createVersion({ total_ht_cents: 10_100 }),
        items,
      }),
    );
    const quantityChanged = computeEstimateSealHash(
      buildCanonicalEstimateSealPayload({
        version,
        items: [createItem({ quantity: 5 })],
      }),
    );

    expect(totalChanged).not.toBe(first);
    expect(quantityChanged).not.toBe(first);
    expect(quantityChanged).not.toBe(totalChanged);
  });
});

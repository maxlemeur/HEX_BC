import { describe, expect, it } from "vitest";

import { buildEstimateItemUpdatePayload, buildVersionDiscountPatch, hasLaborSplitFields, readLaborSplitFields, resolveLaborRoleHourlyRate, type EstimateItem } from "@/lib/estimates/editor-items";

function createItem(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    h_mo_atelier_per_unit: null,
    h_mo_chantier_per_unit: null,
    h_mo_per_unit: null,
    pricing_status: "priced",
    snapshot_gross_fo_ht_cents: null,
    snapshot_gross_ht_cents: null,
    unit_code: null,
    id: "line-1",
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-01T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: "section-1",
    item_type: "line",
    line_nature: "supply_and_labor",
    position: 2,
    title: "Tube acier",
    aid: "A.1",
    description: "Fourniture et pose",
    quantity: 3,
    unit_price_ht_cents: 1250,
    tax_rate_bp: 2000,
    k_fo: 1.1,
    fo_provision: 1,
    h_mo: 2.5,
    h_mo_majoration: 1.2,
    k_mo: 1.05,
    h_mo_atelier: 1,
    k_mo_atelier: 1.1,
    labor_role_atelier_id: "role-atelier",
    h_mo_chantier: 1.5,
    k_mo_chantier: 1.2,
    labor_role_chantier_id: "role-chantier",
    pu_ht_cents: 5200,
    labor_role_id: "role-default",
    category_id: "category-1",
    supply_type_id: "supply-1",
    product_id: "product-1",
    selected_supplier_price_id: "supplier-price-1",
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    line_total_ht_cents: 15600,
    line_tax_cents: 3120,
    line_total_ttc_cents: 18720,
    ...overrides,
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

describe("estimate editor item payloads", () => {
  it("n'invente pas de ventilation MO quand la source n'en porte pas", () => {
    // La garde `key in source` protege les patches partiels : une ligne dont la
    // ventilation n'est pas mentionnee ne doit pas la voir ecrasee par des null.
    const line = createItem();
    for (const key of [
      "h_mo_atelier",
      "k_mo_atelier",
      "labor_role_atelier_id",
      "h_mo_chantier",
      "k_mo_chantier",
      "labor_role_chantier_id",
    ]) {
      delete (line as unknown as Record<string, unknown>)[key];
    }

    const updatePayload = buildEstimateItemUpdatePayload(line);

    expect(updatePayload).not.toHaveProperty("h_mo_atelier");
    expect(updatePayload).not.toHaveProperty("labor_role_atelier_id");
    expect(updatePayload).not.toHaveProperty("h_mo_chantier");
    expect(updatePayload).not.toHaveProperty("labor_role_chantier_id");
  });

  it("normalizes labor split fields and resolves scoped hourly-rate fallbacks", () => {
    expect(
      readLaborSplitFields({
        h_mo_atelier: Number.NaN,
        k_mo_atelier: 1.25,
        labor_role_atelier_id: "  atelier-role  ",
        h_mo_chantier: 2,
        k_mo_chantier: Number.POSITIVE_INFINITY,
        labor_role_chantier_id: "   ",
      })
    ).toEqual({
      h_mo_atelier: 0,
      k_mo_atelier: 1.25,
      labor_role_atelier_id: "atelier-role",
      h_mo_chantier: 2,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
    });

    expect(
      readLaborSplitFields({
        h_mo_atelier: 0,
        k_mo_atelier: 1,
        h_mo_chantier: 0,
        k_mo_chantier: 1,
      })
    ).toMatchObject({
      h_mo_atelier: null,
      h_mo_chantier: null,
    });

    expect(hasLaborSplitFields({ title: "legacy line" })).toBe(false);
    expect(hasLaborSplitFields({ h_mo_atelier: undefined })).toBe(true);

    const role = {
      hourly_rate_cents: 4200,
      hourly_rate_atelier_cents: 5100,
      hourly_rate_chantier_cents: Number.NaN,
    };
    expect(resolveLaborRoleHourlyRate(role, "default")).toBe(4200);
    expect(resolveLaborRoleHourlyRate(role, "atelier")).toBe(5100);
    expect(resolveLaborRoleHourlyRate(role, "chantier")).toBe(4200);
  });
});

describe("buildVersionDiscountPatch (EST-E26 etape 16)", () => {
  it("persiste le coefficient hors mode cascade", () => {
    // Le defaut corrige : on ecrivait `global_coefficient: 1` hors cascade,
    // alors que `total_ht_cents` etait calcule AVEC le coefficient — le moteur
    // l'applique inconditionnellement au sous-total. La version stockee etait
    // auto-contradictoire, et le total chutait au rechargement.
    expect(
      buildVersionDiscountPatch({
        discountMode: "simple",
        globalCoefficient: 1.15,
        cascadeDiscountSteps: [],
      })
    ).toEqual({
      discount_mode: "simple",
      discount_steps: [],
      global_coefficient: 1.15,
    });
  });

  it("retombe sur un coefficient neutre et jamais negatif", () => {
    expect(
      buildVersionDiscountPatch({
        discountMode: "simple",
        globalCoefficient: null,
        cascadeDiscountSteps: [],
      }).global_coefficient
    ).toBe(1);
    expect(
      buildVersionDiscountPatch({
        discountMode: "simple",
        globalCoefficient: -2,
        cascadeDiscountSteps: [],
      }).global_coefficient
    ).toBe(0);
  });
});

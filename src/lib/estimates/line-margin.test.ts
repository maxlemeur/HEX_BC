import { describe, expect, it } from "vitest";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import type { LaborRole } from "@/lib/estimates/editor-items";
import {
  computeEstimateLineMargin,
  formatMarkupRatio,
} from "@/lib/estimates/line-margin";

function makeRole(overrides: Partial<LaborRole> = {}): LaborRole {
  return {
    id: "role-default",
    tenant_id: "tenant-1",
    name: "Serrurier",
    hourly_rate_cents: 5_000,
    is_active: true,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as unknown as LaborRole;
}

function makeLine(
  overrides: Partial<EstimateItemRecord> = {}
): EstimateItemRecord & { line_total_ht_cents?: number | null } {
  return {
    id: "line-1",
    item_type: "line",
    parent_id: null,
    position: 1,
    title: "Ligne",
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2_000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    labor_role_id: null,
    pu_ht_cents: 0,
    line_total_ht_cents: 0,
    ...overrides,
  } as unknown as EstimateItemRecord & { line_total_ht_cents?: number | null };
}

describe("computeEstimateLineMargin", () => {
  it("expose le deboursé sec fourniture, deja calcule par le moteur", () => {
    const margin = computeEstimateLineMargin({
      // 3 x 100,00 EUR de fourniture, k_fo 1,10 => 330,00 EUR de deboursé sec.
      item: makeLine({
        quantity: 3,
        unit_price_ht_cents: 10_000,
        k_fo: 1.1,
        line_total_ht_cents: 44_550,
      }),
      laborRoles: [],
      isLaborSplitEnabled: false,
    });

    expect(margin.costCents).toBe(33_000);
    expect(margin.saleCents).toBe(44_550);
    expect(margin.marginCents).toBe(11_550);
  });

  it("compte la main-d'oeuvre au taux du role", () => {
    const margin = computeEstimateLineMargin({
      // 2 h a 50,00 EUR/h => 100,00 EUR.
      item: makeLine({
        h_mo: 2,
        labor_role_id: "role-default",
        line_total_ht_cents: 13_000,
      }),
      laborRoles: [makeRole()],
      isLaborSplitEnabled: false,
    });

    expect(margin.costCents).toBe(10_000);
    expect(margin.marginCents).toBe(3_000);
  });

  it("affiche la MARQUE, pas le taux de marge", () => {
    // Coefficient de vente 1,35 sur un deboursé sec de 100,00 EUR :
    // taux de marge 35 %, taux de MARQUE 25,9 %. Les confondre a cote d'un
    // total de vente est l'erreur la plus couteuse du metier.
    const margin = computeEstimateLineMargin({
      item: makeLine({
        quantity: 1,
        unit_price_ht_cents: 10_000,
        line_total_ht_cents: 13_500,
      }),
      laborRoles: [],
      isLaborSplitEnabled: false,
    });

    expect(margin.marginCents).toBe(3_500);
    expect(margin.markupRatio).toBeCloseTo(0.2593, 4);
    expect(formatMarkupRatio(margin.markupRatio)).toBe("25,9 %");
  });

  it("rend une marge negative visible sur une ligne vendue a perte", () => {
    const margin = computeEstimateLineMargin({
      item: makeLine({
        quantity: 1,
        unit_price_ht_cents: 10_000,
        line_total_ht_cents: 8_000,
      }),
      laborRoles: [],
      isLaborSplitEnabled: false,
    });

    expect(margin.marginCents).toBe(-2_000);
    expect(margin.markupRatio).toBeCloseTo(-0.25, 4);
  });

  it("ne divise pas par zero quand la ligne n'est pas chiffree", () => {
    const margin = computeEstimateLineMargin({
      item: makeLine({ line_total_ht_cents: 0 }),
      laborRoles: [],
      isLaborSplitEnabled: false,
    });

    expect(margin.markupRatio).toBeNull();
    expect(formatMarkupRatio(margin.markupRatio)).toBe("-");
  });

  it("honore la ventilation atelier/chantier quand le flag est actif", () => {
    const item = makeLine({
      h_mo_atelier: 2,
      labor_role_atelier_id: "role-atelier",
      h_mo_chantier: 3,
      labor_role_chantier_id: "role-chantier",
      line_total_ht_cents: 0,
    });
    const roles = [
      makeRole({ id: "role-atelier", hourly_rate_cents: 4_000 }),
      makeRole({ id: "role-chantier", hourly_rate_cents: 6_000 }),
    ] as LaborRole[];

    // Split ON : 2 h x 40,00 + 3 h x 60,00 = 260,00 EUR.
    expect(
      computeEstimateLineMargin({ item, laborRoles: roles, isLaborSplitEnabled: true })
        .costCents
    ).toBe(26_000);

    // Split OFF : la ventilation est ignoree, h_mo vaut 0 => aucun cout MO.
    expect(
      computeEstimateLineMargin({ item, laborRoles: roles, isLaborSplitEnabled: false })
        .costCents
    ).toBe(0);
  });
});

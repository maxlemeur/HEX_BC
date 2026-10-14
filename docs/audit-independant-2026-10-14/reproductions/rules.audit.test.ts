/**
 * Audit indépendant 2026-10-14 — tests de caractérisation complémentaires (axe règles de gestion).
 * Chaque test asserte le comportement du code de la copie figée et journalise l'attendu métier.
 */
import { describe, expect, it } from "vitest";

import { parseMajorationPercentToCoefficient } from "@/components/estimates/components/estimate-editor-row/shared";
import { normalizeMappedRowsForEstimateCreation, parseLocalizedNumber } from "@/lib/affaires/import-flow";
import {
  computeEstimateBreakdown,
  computeEstimateLineValues,
  computeEstimateTotals,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { checkApprovalRule } from "@/lib/estimates/rules-engine";
import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";
import { parseEuroToCents } from "@/lib/money";

const log = (label: string, value: unknown) => console.log(`[AUDIT] ${label}: ${JSON.stringify(value)}`);

function item(id: string, over: Partial<EstimateItemRecord>): EstimateItemRecord {
  return {
    id, item_type: "line", parent_id: null, title: id, description: "u", position: 0,
    labor_role_id: null, category_id: null, quantity: 1, unit_price_ht_cents: 0, tax_rate_bp: 2000,
    k_fo: 1, h_mo: 0, k_mo: 1, pu_ht_cents: null, line_total_ht_cents: null, line_tax_cents: null,
    line_total_ttc_cents: null, ...over,
  };
}

const breakdown = (items: EstimateItemRecord[], taxRateBp: number, engine: 1 | 2) =>
  computeEstimateBreakdown({
    items, marginMultiplier: 1, marginMode: "fixed", marginTiers: [], globalCoefficient: 1,
    discountMode: "simple", discountCents: 0, discountStepsBp: [], taxRateBp, roundingMode: "none",
    roundingStepCents: 0, isLaborSplitEnabled: false, laborRateById: new Map([["role", 4500]]),
    laborRateAtelierById: new Map(), laborRateChantierById: new Map(), calcEngineVersion: engine,
  }).totals;

describe("B-01 Heures de MO : totales dans le moteur, « par unité » dans l'aide", () => {
  it("10 m à 0,5 h/m et 45 €/h : 22,50 € de MO au lieu de 225 €", () => {
    const v = computeEstimateLineValues(
      { quantity: 10, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0.5, k_mo: 1, pu_ht_cents: null, labor_role_hourly_rate_cents: 4500 },
      { marginMultiplier: 1, taxRateBp: 2000, isLaborSplitEnabled: false }
    );
    log("h MO", { coutLigne: v.costLineCents, attenduSiHeuresParUnite: 10 * 1000 + 10 * 0.5 * 4500 });
    expect(v.costLineCents).toBe(12_250);
  });

  it("l'import DPGF recopie la colonne h MO sans la multiplier par la quantité", () => {
    const r = normalizeMappedRowsForEstimateCreation(
      [{ id: "r1", payload: { row_index: 1, mapped_row: { designation: "Tube", quantity: "10", unit_price_ht: "10", labor_hours: "0,5", h_mo_majoration: "100" } } }],
      { marginMultiplier: 1, defaultTaxRateBp: 2000 }
    );
    const l = r.validLines[0];
    log("Import h MO / majoration", { hMo: l.hMo, hMoMajoration: l.hMoMajoration });
    expect(l.hMo).toBe(0.5);
    expect(l.hMoMajoration).toBe(100); // « 100 » (100 %) devient un multiplicateur ×100
  });

  it("la majoration saisie au clavier est divisée par 100 (« 8 » → 0,08)", () => {
    expect(parseMajorationPercentToCoefficient("8")).toBe(0.08);
    expect(parseMajorationPercentToCoefficient("100")).toBe(1);
  });
});

describe("B-02 TVA en moteur v2 : le taux de version ne s'applique pas aux lignes existantes", () => {
  it("lignes à 20 %, version passée à 10 % : TVA calculée à 20 % en v2, 10 % en v1", () => {
    const items = [item("l1", { unit_price_ht_cents: 10_000, tax_rate_bp: 2000 })];
    const v2 = breakdown(items, 1000, 2);
    const v1 = breakdown(items, 1000, 1);
    log("TVA unique 10 %", { v2: v2.taxCents, v1: v1.taxCents });
    expect(v2.taxCents).toBe(2000);
    expect(v1.taxCents).toBe(1000);
  });

  it("multi-taux 20 % + 5,5 % : v2 = 2 550 c, v1 = 4 000 c (taux de ligne écrasé)", () => {
    const items = [
      item("l1", { unit_price_ht_cents: 10_000, tax_rate_bp: 2000 }),
      item("l2", { unit_price_ht_cents: 10_000, tax_rate_bp: 550 }),
    ];
    expect(breakdown(items, 2000, 2).taxCents).toBe(2550);
    expect(breakdown(items, 2000, 1).taxCents).toBe(4000);
    // La fonction de pied seule (chemin v1) applique le taux de version à toutes les lignes.
    expect(computeEstimateTotals({
      lineItems: items, marginMultiplier: 1, marginMode: "fixed", marginTiers: [], discountCents: 0,
      taxRateBp: 2000, roundingMode: "none", roundingStepCents: 0, isLaborSplitEnabled: false,
    }).taxCents).toBe(4000);
  });
});

describe("B-03 Seuil d'approbation inclusif", () => {
  it("5 000,00 € pile exige une approbation (la documentation dit « > seuil »)", () => {
    expect(checkApprovalRule({ actualValue: 500_000, threshold: 500_000 } as never).violated).toBe(true);
  });
});

describe("B-04 Offres fournisseurs et unités", () => {
  const offer = { unit_price_cents: 0, unit: "m", is_active: true, valid_from: "2026-10-01", valid_to: "2027-03-31", min_quantity: null };
  it("une offre à 0 € est éligible côté devis", () => {
    expect(supplierOfferIneligibility(offer as never, { currency: "EUR", quantity: 10, unit: "ml", today: "2026-10-14" })).toBeNull();
  });
  it("« ML » (mètre linéaire d'un DPGF) est refusé face à une offre en « ml »", () => {
    const r = supplierOfferIneligibility({ ...offer, unit: "ml", unit_price_cents: 1000 } as never, { currency: "EUR", quantity: 10, unit: "ML", today: "2026-10-14" });
    log("ML vs ml", r);
    expect(r).toBe("Unité différente du devis");
  });
});

describe("B-05 Parseurs numériques divergents", () => {
  it("« 1.250 » vaut 1 250 € en saisie de prix et 1,25 à l'import", () => {
    expect(parseEuroToCents("1.250")).toBe(125_000);
    expect(parseLocalizedNumber("1.250")).toBe(1.25);
  });
});

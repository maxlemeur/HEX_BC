import { describe, expect, it } from "vitest";

import {
  allocateProRata,
  computeAllSectionTotals,
  computeEstimateLineValues,
  computeEstimateTotals,
  computeCascadeDiscountCents,
  computeSectionTotals,
  computeInitialDiscountCents,
  computeStoredDiscountCents,
  normalizeDraftItems,
  MAX_MARGIN_MULTIPLIER,
  MAX_CENTS,
  UNASSIGNED_SUPPLY_TYPE_KEY,
  type EstimateLineLike,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { getMarginTiers } from "@/lib/estimates/margin-tiers";
import { bankersRound } from "@/lib/money";

function createLine(overrides: Partial<EstimateLineLike> = {}): EstimateLineLike {
  return {
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: null,
    k_fo: 1,
    h_mo: 0,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_hourly_rate_cents: 0,
    ...overrides,
  };
}

function createItemRecord(
  overrides: Partial<EstimateItemRecord> = {}
): EstimateItemRecord {
  return {
    id: crypto.randomUUID(),
    item_type: "line",
    parent_id: null,
    title: "Test line",
    description: null,
    position: 0,
    labor_role_id: null,
    category_id: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: null,
    k_fo: 1,
    h_mo: 0,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_hourly_rate_cents: 0,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    ...overrides,
  };
}

function createSectionRecord(
  overrides: Partial<EstimateItemRecord> = {}
): EstimateItemRecord {
  return createItemRecord({
    item_type: "section",
    title: "Section test",
    ...overrides,
  });
}

describe("bankersRound", () => {
  it("rounds half to nearest even (half-even)", () => {
    expect(bankersRound(0.5)).toBe(0);
    expect(bankersRound(1.5)).toBe(2);
    expect(bankersRound(2.5)).toBe(2);
    expect(bankersRound(3.5)).toBe(4);
    expect(bankersRound(4.5)).toBe(4);
  });

  it("rounds non-half values normally", () => {
    expect(bankersRound(1.3)).toBe(1);
    expect(bankersRound(1.7)).toBe(2);
    expect(bankersRound(2.1)).toBe(2);
    expect(bankersRound(2.9)).toBe(3);
  });

  it("handles negative half values", () => {
    expect(bankersRound(-0.5)).toBe(0);
    expect(bankersRound(-1.5)).toBe(-2);
    expect(bankersRound(-2.5)).toBe(-2);
    expect(bankersRound(-3.5)).toBe(-4);
  });

  it("returns 0 for non-finite values", () => {
    expect(bankersRound(NaN)).toBe(0);
    expect(bankersRound(Infinity)).toBe(0);
    expect(bankersRound(-Infinity)).toBe(0);
  });
});

describe("estimate calculations", () => {
  it("computeEstimateLineValues nominal", () => {
    const line = createLine({
      quantity: 3,
      unit_price_ht_cents: 1000,
      k_fo: 1.2,
      h_mo: 2.5,
      k_mo: 1.1,
      labor_role_hourly_rate_cents: 400,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1.3,
      taxRateBp: 2000,
    });

    expect(values).toEqual({
      costLineCents: 4700,
      saleLineCents: 6110,
      puHtCents: 2037,
      taxLineCents: 1222,
      ttcLineCents: 7332,
    });
  });

  it("EST-031: split actif avec MO atelier + chantier", () => {
    const line = createLine({
      quantity: 2,
      unit_price_ht_cents: 1000,
      k_fo: 1,
      h_mo: 9,
      k_mo: 9,
      h_mo_atelier: 1.5,
      k_mo_atelier: 1.1,
      h_mo_chantier: 2,
      k_mo_chantier: 1.2,
    });

    const values = computeEstimateLineValues(line, {
      marginMultiplier: 1.25,
      taxRateBp: 2000,
      isLaborSplitEnabled: true,
      laborRateAtelierCents: 400,
      laborRateChantierCents: 600,
    });

    expect(values).toEqual({
      costLineCents: 4100,
      saleLineCents: 5125,
      puHtCents: 2562,
      taxLineCents: 1025,
      ttcLineCents: 6150,
    });
  });

  it("EST-031: split actif avec une seule MO renseignee", () => {
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: 1000,
      k_fo: 1,
      h_mo_atelier: 0,
      k_mo_atelier: 1.3,
      h_mo_chantier: 2,
      k_mo_chantier: 1.5,
    });

    const values = computeEstimateLineValues(line, {
      marginMultiplier: 1,
      taxRateBp: 2000,
      isLaborSplitEnabled: true,
      laborRateAtelierCents: 400,
      laborRateChantierCents: 500,
    });

    expect(values).toEqual({
      costLineCents: 2500,
      saleLineCents: 2500,
      puHtCents: 2500,
      taxLineCents: 500,
      ttcLineCents: 3000,
    });
  });

  it("EST-031: split desactive conserve le calcul legacy", () => {
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: 1000,
      k_fo: 1,
      h_mo: 2,
      k_mo: 1.2,
      h_mo_atelier: 8,
      k_mo_atelier: 4,
      h_mo_chantier: 9,
      k_mo_chantier: 5,
      labor_role_hourly_rate_cents: 500,
    });

    const values = computeEstimateLineValues(line, {
      marginMultiplier: 1,
      taxRateBp: 2000,
      isLaborSplitEnabled: false,
      laborRateAtelierCents: 999,
      laborRateChantierCents: 888,
    });

    expect(values).toEqual({
      costLineCents: 2200,
      saleLineCents: 2200,
      puHtCents: 2200,
      taxLineCents: 440,
      ttcLineCents: 2640,
    });
  });

  it("EST-031: coefficients split par defaut n'activent pas le mode split", () => {
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: 0,
      h_mo: 2,
      k_mo: 1,
      k_mo_atelier: 1,
      k_mo_chantier: 1,
      labor_role_hourly_rate_cents: 500,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1,
      taxRateBp: 0,
    });

    expect(values).toEqual({
      costLineCents: 1000,
      saleLineCents: 1000,
      puHtCents: 1000,
      taxLineCents: 0,
      ttcLineCents: 1000,
    });
  });

  it("keeps canonical labor when inactive split fields were normalized to zero", () => {
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: 3192,
      k_fo: 1,
      h_mo: 1.9,
      k_mo: 1.5,
      h_mo_atelier: 0,
      k_mo_atelier: 1,
      labor_role_atelier_id: null,
      h_mo_chantier: 0,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
      labor_role_hourly_rate_cents: 10000,
    });

    const lineValues = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1.2,
      taxRateBp: 2000,
    });
    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      lineItems: [line],
      marginMultiplier: 1.2,
      discountCents: 0,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 1,
      isLaborSplitEnabled: false,
    });

    expect(lineValues).toEqual({
      costLineCents: 31692,
      saleLineCents: 38030,
      puHtCents: 38030,
      taxLineCents: 7606,
      ttcLineCents: 45636,
    });
    expect(totals).toMatchObject({
      costSubtotalCents: 31692,
      saleTotalCents: 38030,
      taxCents: 7606,
      roundedTtcCents: 45636,
    });
  });

  it("A1: single round avoids cumulative drift from triple rounding", () => {
    // When FO and MO each produce 0.5, triple rounding rounds each up
    // but single rounding correctly sums to 1.0 then rounds to 1
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: 1,
      k_fo: 0.5,
      h_mo: 1,
      k_mo: 0.5,
      labor_role_hourly_rate_cents: 1,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1,
      taxRateBp: 0,
    });

    // FO = 1 * 1 * 0.5 = 0.5, MO = 1 * 1 * 0.5 = 0.5
    // Single round: round(0.5 + 0.5) = round(1.0) = 1
    // Triple round would give: round(0.5) + round(0.5) = 1 + 1 = 2
    expect(values.costLineCents).toBe(1);
  });

  it("A2: puHtCents uses banker's rounding", () => {
    // saleLineCents=6113, quantity=2 -> 6113/2 = 3056.5
    // Math.round(3056.5) = 3057 (half-up bias)
    // bankersRound(3056.5) = 3056 (round to nearest even)
    const line = createLine({
      quantity: 2,
      unit_price_ht_cents: 6113,
      k_fo: 1,
      h_mo: 0,
      k_mo: 1,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1,
      taxRateBp: 0,
    });

    // costLine = round(2 * 6113 * 1 + 0) = 12226
    // saleLine = round(12226 * 1) = 12226
    // puHtCents = bankersRound(12226 / 2) = bankersRound(6113) = 6113
    expect(values.puHtCents).toBe(6113);

    // Now a case where the half-even matters
    const line2 = createLine({
      quantity: 2,
      unit_price_ht_cents: 1,
      k_fo: 1,
      h_mo: 0,
      k_mo: 1,
    });

    const values2 = computeEstimateLineValues(line2, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1,
      taxRateBp: 0,
    });

    // costLine = round(2*1*1) = 2, saleLine = 2, puHtCents = bankersRound(2/2) = 1
    expect(values2.puHtCents).toBe(1);
  });

  it("EST-029: h_mo_majoration 1.0 keeps neutral MO cost", () => {
    const withoutMajoration = createLine({
      quantity: 1,
      unit_price_ht_cents: 0,
      h_mo: 2,
      k_mo: 1,
      labor_role_hourly_rate_cents: 500,
    });

    const withNeutralMajoration = createLine({
      quantity: 1,
      unit_price_ht_cents: 0,
      h_mo: 2,
      h_mo_majoration: 1,
      k_mo: 1,
      labor_role_hourly_rate_cents: 500,
    });

    const baseValues = computeEstimateLineValues(withoutMajoration, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1,
      taxRateBp: 0,
    });
    const neutralValues = computeEstimateLineValues(withNeutralMajoration, {
      isLaborSplitEnabled: false,
      marginMultiplier: 1,
      taxRateBp: 0,
    });

    expect(baseValues.costLineCents).toBe(1000);
    expect(neutralValues.costLineCents).toBe(1000);
    expect(neutralValues.costLineCents).toBe(baseValues.costLineCents);
  });

  it("EST-029: h_mo_majoration > 1 increases MO cost", () => {
    const values = computeEstimateLineValues(
      createLine({
        quantity: 1,
        unit_price_ht_cents: 0,
        h_mo: 2,
        h_mo_majoration: 1.5,
        k_mo: 1,
        labor_role_hourly_rate_cents: 500,
      }),
      {
        isLaborSplitEnabled: false,
        marginMultiplier: 1,
        taxRateBp: 0,
      }
    );

    expect(values.costLineCents).toBe(1500);
  });

  it("EST-029: h_mo_majoration < 1 decreases MO cost", () => {
    const values = computeEstimateLineValues(
      createLine({
        quantity: 1,
        unit_price_ht_cents: 0,
        h_mo: 2,
        h_mo_majoration: 0.5,
        k_mo: 1,
        labor_role_hourly_rate_cents: 500,
      }),
      {
        isLaborSplitEnabled: false,
        marginMultiplier: 1,
        taxRateBp: 0,
      }
    );

    expect(values.costLineCents).toBe(500);
  });

  it("A5: sum of per-line taxes equals total tax (no discount)", () => {
    const lines = [
      createLine({ quantity: 1, unit_price_ht_cents: 333, k_fo: 1, h_mo: 0, k_mo: 1 }),
      createLine({ quantity: 1, unit_price_ht_cents: 333, k_fo: 1, h_mo: 0, k_mo: 1 }),
      createLine({ quantity: 1, unit_price_ht_cents: 334, k_fo: 1, h_mo: 0, k_mo: 1 }),
    ];

    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: lines,
      marginMultiplier: 1,
      discountCents: 0,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    // Per-line taxes: round(333*0.2)=67, round(333*0.2)=67, round(334*0.2)=67
    // Sum = 201
    // Old method: computeTaxCents(1000, 2000) = 200 (different!)
    // New method uses per-line sum = 201
    const perLineTaxSum = lines.reduce((sum, line) => {
      const v = computeEstimateLineValues(line, { isLaborSplitEnabled: false, marginMultiplier: 1, taxRateBp: 2000 });
      return sum + v.taxLineCents;
    }, 0);

    expect(totals.taxCents).toBe(perLineTaxSum);
    expect(totals.taxCents).toBe(201);
  });

  it("A5: tax with discount uses per-line sum minus discount tax", () => {
    const lines = [
      createLine({ quantity: 1, unit_price_ht_cents: 500, k_fo: 1, h_mo: 0, k_mo: 1 }),
      createLine({ quantity: 1, unit_price_ht_cents: 500, k_fo: 1, h_mo: 0, k_mo: 1 }),
    ];

    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: lines,
      marginMultiplier: 1,
      discountCents: 200,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    // Per-line: tax(500, 2000) = 100 each, sum = 200
    // Discount tax: tax(200, 2000) = 40
    // Total tax = 200 - 40 = 160
    expect(totals.taxCents).toBe(160);
    expect(totals.saleTotalCents).toBe(800);
    expect(totals.ttcCents).toBe(960);
  });

  it("A6: caps margin multiplier at MAX_MARGIN_MULTIPLIER", () => {
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: 1000,
      k_fo: 1,
      h_mo: 0,
      k_mo: 1,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 99999,
      taxRateBp: 0,
    });

    // Should be capped at MAX_MARGIN_MULTIPLIER (100)
    expect(values.saleLineCents).toBe(1000 * MAX_MARGIN_MULTIPLIER);
  });

  it("A6: caps computed cents at MAX_CENTS", () => {
    const line = createLine({
      quantity: 1,
      unit_price_ht_cents: MAX_CENTS,
      k_fo: 1,
      h_mo: 0,
      k_mo: 1,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: 2,
      taxRateBp: 0,
    });

    // costLineCents should be capped, not overflow
    expect(values.costLineCents).toBeLessThanOrEqual(MAX_CENTS);
    expect(values.saleLineCents).toBeLessThanOrEqual(MAX_CENTS);
  });

  it("A6b: signale un total ecrete au lieu de le minorer en silence", () => {
    const cappedTotals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      lineItems: [
        createLine({
          quantity: 1,
          unit_price_ht_cents: 900_000_000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
        }),
        createLine({ quantity: 1, unit_price_ht_cents: 900_000_000, k_fo: 1, h_mo: 0, k_mo: 1 }),
        createLine({ quantity: 1, unit_price_ht_cents: 900_000_000, k_fo: 1, h_mo: 0, k_mo: 1 }),
      ],
      marginMultiplier: 1,
      taxRateBp: 2000,
      discountCents: 0,
      roundingMode: "none",
      roundingStepCents: 1,
      isLaborSplitEnabled: false,
    });

    // Le montant reste borne (contrainte de stockage) MAIS l'ecretage est
    // desormais signale : sans ce drapeau le devis annoncait un total
    // inferieur au reel sans aucun avertissement.
    expect(cappedTotals.saleSubtotalCents).toBeLessThanOrEqual(MAX_CENTS);
    expect(cappedTotals.isCapped).toBe(true);

    const normalTotals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      lineItems: [
        createLine({
          quantity: 2,
          unit_price_ht_cents: 5000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
        }),
      ],
      marginMultiplier: 1,
      taxRateBp: 2000,
      discountCents: 0,
      roundingMode: "none",
      roundingStepCents: 1,
      isLaborSplitEnabled: false,
    });
    expect(normalTotals.isCapped).toBe(false);
  });

  it("computeEstimateTotals with discount and taxes", () => {
    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: [
        createLine({
          quantity: 2,
          unit_price_ht_cents: 1000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
          labor_role_hourly_rate_cents: 0,
        }),
        createLine({
          quantity: 1,
          unit_price_ht_cents: 5000,
          k_fo: 1,
          h_mo: 1,
          k_mo: 1,
          labor_role_hourly_rate_cents: 1000,
        }),
      ],
      marginMultiplier: 1.5,
      discountCents: 2000,
      taxRateBp: 1000,
      roundingMode: "none",
      roundingStepCents: 5,
    });

    expect(totals).toEqual({
      costSubtotalCents: 8000,
      saleSubtotalBeforeCoefficientCents: 12000,
      saleSubtotalCents: 12000,
      discountCents: 2000,
      appliedMarginMultiplier: 1.5,
      globalCoefficient: 1,
      isCapped: false,
      discountMode: "simple",
      discountStepTotals: [
        {
          stepNumber: 1,
          stepBp: null,
          subtotalBeforeCents: 12000,
          discountCents: 2000,
          subtotalAfterCents: 10000,
          cumulativeDiscountCents: 2000,
        },
      ],
      saleTotalCents: 10000,
      taxCents: 1000,
      ttcCents: 11000,
      roundedTtcCents: 11000,
      roundingAdjustmentCents: 0,
      adjustedTaxCents: 1000,
    });
  });

  it("EST-025: cascade vide n'applique aucune remise", () => {
    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: [createLine({ quantity: 1, unit_price_ht_cents: 10000, k_fo: 1 })],
      marginMultiplier: 1,
      discountCents: 9999,
      discountMode: "cascade",
      discountStepsBp: [],
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.discountCents).toBe(0);
    expect(totals.saleSubtotalCents).toBe(10000);
    expect(totals.saleTotalCents).toBe(10000);
    expect(totals.discountStepTotals).toEqual([]);
  });

  it("EST-025: 1 etape en cascade = simple (bp)", () => {
    const baseInput = {
      lineItems: [createLine({ quantity: 1, unit_price_ht_cents: 12345, k_fo: 1 })],
      marginMultiplier: 1,
      discountCents: 0,
      discountStepsBp: [1500],
      taxRateBp: 0,
      roundingMode: "none" as const,
      roundingStepCents: 1,
    };

    const simpleTotals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      ...baseInput,
      discountMode: "simple",
    });
    const cascadeTotals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      ...baseInput,
      discountMode: "cascade",
    });

    expect(cascadeTotals.discountCents).toBe(simpleTotals.discountCents);
    expect(cascadeTotals.saleTotalCents).toBe(simpleTotals.saleTotalCents);
    expect(cascadeTotals.discountStepTotals).toHaveLength(1);
  });

  it("EST-025: multi-etapes applique bankersRound a chaque etape", () => {
    const cascade = computeCascadeDiscountCents(1001, [5000, 5000]);
    expect(cascade).toEqual({
      discountCents: 750,
      subtotalAfterDiscountCents: 251,
      steps: [
        {
          stepNumber: 1,
          stepBp: 5000,
          subtotalBeforeCents: 1001,
          discountCents: 500,
          subtotalAfterCents: 501,
          cumulativeDiscountCents: 500,
        },
        {
          stepNumber: 2,
          stepBp: 5000,
          subtotalBeforeCents: 501,
          discountCents: 250,
          subtotalAfterCents: 251,
          cumulativeDiscountCents: 750,
        },
      ],
    });

    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: [createLine({ quantity: 1, unit_price_ht_cents: 1001, k_fo: 1 })],
      marginMultiplier: 1,
      discountCents: 0,
      discountMode: "cascade",
      discountStepsBp: [5000, 5000],
      taxRateBp: 0,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.discountCents).toBe(750);
    expect(totals.saleTotalCents).toBe(251);
    expect(totals.discountStepTotals).toEqual(cascade.steps);
  });

  it("EST-025: global_coefficient est applique apres marge et avant remise", () => {
    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: [createLine({ quantity: 1, unit_price_ht_cents: 1000, k_fo: 1 })],
      marginMultiplier: 1.5,
      global_coefficient: 1.2,
      discountCents: 100,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.saleSubtotalBeforeCoefficientCents).toBe(1500);
    expect(totals.saleSubtotalCents).toBe(1800);
    expect(totals.discountCents).toBe(100);
    expect(totals.saleTotalCents).toBe(1700);
    expect(totals.taxCents).toBe(340);
    expect(totals.globalCoefficient).toBe(1.2);
  });

  it("EST-025: limites sur les etapes et le coefficient global", () => {
    const cascade = computeCascadeDiscountCents(1000, [-500, 20000, Number.NaN]);
    expect(cascade.discountCents).toBe(1000);
    expect(cascade.subtotalAfterDiscountCents).toBe(0);
    expect(cascade.steps.map((step) => step.stepBp)).toEqual([0, 10000, 0]);

    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: [createLine({ quantity: 1, unit_price_ht_cents: 1000, k_fo: 1 })],
      marginMultiplier: 1,
      globalCoefficient: -10,
      discountCents: 500,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.saleSubtotalCents).toBe(0);
    expect(totals.saleTotalCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.globalCoefficient).toBe(0);
  });

  it("applies rounding modes none/nearest/up/down", () => {
    const lineItems = [
      createLine({
        quantity: 1,
        unit_price_ht_cents: 1055,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_hourly_rate_cents: 0,
      }),
    ];

    const expectedByMode = {
      none: { roundedTtcCents: 1266, roundingAdjustmentCents: 0, adjustedTaxCents: 211 },
      nearest: {
        roundedTtcCents: 1300,
        roundingAdjustmentCents: 34,
        adjustedTaxCents: 245,
      },
      up: { roundedTtcCents: 1300, roundingAdjustmentCents: 34, adjustedTaxCents: 245 },
      down: {
        roundedTtcCents: 1200,
        roundingAdjustmentCents: -66,
        adjustedTaxCents: 145,
      },
    } as const;

    (["none", "nearest", "up", "down"] as const).forEach((roundingMode) => {
      const totals = computeEstimateTotals({
        marginMode: "fixed",
        marginTiers: [],
        isLaborSplitEnabled: false,
        lineItems,
        marginMultiplier: 1,
        discountCents: 0,
        taxRateBp: 2000,
        roundingMode,
        roundingStepCents: 100,
      });

      expect(totals.saleTotalCents).toBe(1055);
      expect(totals).toMatchObject(expectedByMode[roundingMode]);
    });
  });

  it("clamps null and negative values to safe non-negative values", () => {
    const line = createLine({
      quantity: null,
      unit_price_ht_cents: -500,
      k_fo: null,
      h_mo: -2,
      k_mo: null,
      labor_role_hourly_rate_cents: -1000,
    });

    const values = computeEstimateLineValues(line, {
      isLaborSplitEnabled: false,
      marginMultiplier: -1,
      taxRateBp: -2000,
    });

    expect(values).toEqual({
      costLineCents: 0,
      saleLineCents: 0,
      puHtCents: 0,
      taxLineCents: 0,
      ttcLineCents: 0,
    });
  });

  it("keeps sale total HT >= 0 when discount exceeds subtotal", () => {
    const totals = computeEstimateTotals({
      marginMode: "fixed",
      marginTiers: [],
      isLaborSplitEnabled: false,
      lineItems: [
        createLine({
          quantity: 1,
          unit_price_ht_cents: 1000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
          labor_role_hourly_rate_cents: 0,
        }),
      ],
      marginMultiplier: 1,
      discountCents: 5000,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 5,
    });

    expect(totals.saleSubtotalCents).toBe(1000);
    expect(totals.saleTotalCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.ttcCents).toBe(0);
    expect(totals.roundedTtcCents).toBe(0);
  });

  it("EST-028: applies low tier multiplier below first threshold", () => {
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: [
        createLine({
          quantity: 1,
          unit_price_ht_cents: 5_000_000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
        }),
      ],
      marginMultiplier: 1.1,
      marginMode: "tiered",
      marginTiers: getMarginTiers(),
      discountCents: 0,
      taxRateBp: 0,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.costSubtotalCents).toBe(5_000_000);
    expect(totals.appliedMarginMultiplier).toBe(1.6);
    expect(totals.saleSubtotalCents).toBe(8_000_000);
  });

  it("EST-028: applies mid tier multiplier between thresholds", () => {
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: [
        createLine({
          quantity: 1,
          unit_price_ht_cents: 50_000_000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
        }),
      ],
      marginMultiplier: 1.1,
      marginMode: "tiered",
      marginTiers: getMarginTiers(),
      discountCents: 0,
      taxRateBp: 0,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.costSubtotalCents).toBe(50_000_000);
    expect(totals.appliedMarginMultiplier).toBe(1.45);
    expect(totals.saleSubtotalCents).toBe(72_500_000);
  });

  it("EST-028: applies high tier multiplier above last threshold", () => {
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: [
        createLine({
          quantity: 1,
          unit_price_ht_cents: 120_000_000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
        }),
      ],
      marginMultiplier: 1.1,
      marginMode: "tiered",
      marginTiers: getMarginTiers(),
      discountCents: 0,
      taxRateBp: 0,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.costSubtotalCents).toBe(120_000_000);
    expect(totals.appliedMarginMultiplier).toBe(1.4);
    expect(totals.saleSubtotalCents).toBe(168_000_000);
  });

  it("EST-028: value exactly at threshold resolves to that tier", () => {
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: [
        createLine({
          quantity: 1,
          unit_price_ht_cents: 10_000_000,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
        }),
      ],
      marginMultiplier: 1.1,
      marginMode: "tiered",
      marginTiers: getMarginTiers(),
      discountCents: 0,
      taxRateBp: 0,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.costSubtotalCents).toBe(10_000_000);
    expect(totals.appliedMarginMultiplier).toBe(1.45);
    expect(totals.saleSubtotalCents).toBe(14_500_000);
  });

  it("EST-028: empty estimate in tiered mode uses first tier and stays at zero", () => {
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: [],
      marginMultiplier: 1.1,
      marginMode: "tiered",
      marginTiers: getMarginTiers(),
      discountCents: 0,
      taxRateBp: 0,
      roundingMode: "none",
      roundingStepCents: 1,
    });

    expect(totals.costSubtotalCents).toBe(0);
    expect(totals.appliedMarginMultiplier).toBe(1.6);
    expect(totals.saleSubtotalCents).toBe(0);
    expect(totals.saleTotalCents).toBe(0);
    expect(totals.roundedTtcCents).toBe(0);
  });

  it("EST-121: returns zero totals for an empty section", () => {
    const sectionId = "section-empty";
    const otherSectionId = "section-other";
    const items: EstimateItemRecord[] = [
      createSectionRecord({ id: sectionId, parent_id: null, position: 1 }),
      createSectionRecord({ id: otherSectionId, parent_id: null, position: 2 }),
      createItemRecord({
        id: "line-other",
        parent_id: otherSectionId,
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        tax_rate_bp: 2000,
        labor_role_id: null,
      }),
    ];

    const totals = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items,
      sectionId,
      marginMultiplier: 1.5,
      taxRateBp: 2000,
      discountCents: 300,
      laborRateById: new Map(),
    });

    expect(totals).toEqual({
      foTotalCents: 0,
      moTotalCents: 0,
      moAtelierTotalCents: 0,
      moChantierTotalCents: 0,
      totalHtCents: 0,
      totalTtcCents: 0,
      supplyTypeFoTotalsCents: {},
    });
  });

  it("EST-121: computes FO/MO/HT/TTC with proportional discount", () => {
    const sectionId = "section-target";
    const items: EstimateItemRecord[] = [
      createSectionRecord({ id: sectionId, parent_id: null, position: 1 }),
      createSectionRecord({ id: "section-other", parent_id: null, position: 2 }),
      createItemRecord({
        id: "line-target",
        parent_id: sectionId,
        position: 1,
        quantity: 2,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 3,
        k_mo: 1,
        labor_role_id: "role-a",
      }),
      createItemRecord({
        id: "line-other",
        parent_id: "section-other",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1500,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
    ];

    const totals = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items,
      sectionId,
      marginMultiplier: 2,
      taxRateBp: 2000,
      discountCents: 1000,
      laborRateById: new Map([["role-a", 500]]),
    });

    expect(totals).toEqual({
      foTotalCents: 3600,
      moTotalCents: 2700,
      moAtelierTotalCents: 0,
      moChantierTotalCents: 2700,
      totalHtCents: 6300,
      totalTtcCents: 7560,
      supplyTypeFoTotalsCents: {
        [UNASSIGNED_SUPPLY_TYPE_KEY]: 3600,
      },
    });
  });

  it("keeps the MO subtotal unchanged when K FO changes", () => {
    const sectionId = "section-k-fo-isolation";
    const computeWithKFo = (kFo: number) =>
      computeSectionTotals({
        marginMode: "fixed",
        marginTiers: [],
        globalCoefficient: 1,
        discountMode: "simple",
        discountStepsBp: [],
        calcEngineVersion: 1,
        isLaborSplitEnabled: false,
        items: [
          createSectionRecord({ id: sectionId, parent_id: null, position: 1 }),
          createItemRecord({
            id: `line-k-fo-${kFo}`,
            parent_id: sectionId,
            position: 1,
            quantity: 1,
            unit_price_ht_cents: 1,
            k_fo: kFo,
            h_mo: 1,
            k_mo: 1,
            labor_role_id: "role-k-fo-isolation",
          }),
        ],
        sectionId,
        marginMultiplier: 1.1,
        taxRateBp: 0,
        discountCents: 0,
        laborRateById: new Map([["role-k-fo-isolation", 3]]),
      });

    const initialTotals = computeWithKFo(1);
    const updatedTotals = computeWithKFo(2);

    expect(initialTotals.moTotalCents).toBe(3);
    expect(updatedTotals.moTotalCents).toBe(initialTotals.moTotalCents);
    expect(updatedTotals.moChantierTotalCents).toBe(
      initialTotals.moChantierTotalCents
    );
    expect(updatedTotals.foTotalCents).not.toBe(initialTotals.foTotalCents);
  });

  it("EST-031: split global actif conserve MO legacy quand la ligne n'est pas split", () => {
    const sectionId = "section-legacy-mo";
    const items: EstimateItemRecord[] = [
      createSectionRecord({ id: sectionId, parent_id: null, position: 1 }),
      createItemRecord({
        id: "line-legacy-mo",
        parent_id: sectionId,
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 2,
        k_mo: 1,
        labor_role_id: "role-legacy",
        h_mo_atelier: null,
        k_mo_atelier: 1,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: 1,
        labor_role_chantier_id: null,
      }),
    ];

    const totals = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      items,
      sectionId,
      marginMultiplier: 1,
      taxRateBp: 2000,
      discountCents: 0,
      laborRateById: new Map([["role-legacy", 500]]),
      isLaborSplitEnabled: true,
    });

    expect(totals).toEqual({
      foTotalCents: 1000,
      moTotalCents: 1000,
      moAtelierTotalCents: 0,
      moChantierTotalCents: 1000,
      totalHtCents: 2000,
      totalTtcCents: 2400,
      supplyTypeFoTotalsCents: {
        [UNASSIGNED_SUPPLY_TYPE_KEY]: 1000,
      },
    });
  });

  it("EST-121: parent section includes nested subsection lines", () => {
    const parentSectionId = "section-parent";
    const childSectionId = "section-child";
    const items: EstimateItemRecord[] = [
      createSectionRecord({ id: parentSectionId, parent_id: null, position: 1 }),
      createSectionRecord({ id: childSectionId, parent_id: parentSectionId, position: 1 }),
      createItemRecord({
        id: "line-parent",
        parent_id: parentSectionId,
        position: 2,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
      createItemRecord({
        id: "line-child",
        parent_id: childSectionId,
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 500,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
    ];

    const totals = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items,
      sectionId: parentSectionId,
      marginMultiplier: 1,
      taxRateBp: 2000,
      discountCents: 0,
      laborRateById: new Map(),
    });

    expect(totals).toEqual({
      foTotalCents: 1500,
      moTotalCents: 0,
      moAtelierTotalCents: 0,
      moChantierTotalCents: 0,
      totalHtCents: 1500,
      totalTtcCents: 1800,
      supplyTypeFoTotalsCents: {
        [UNASSIGNED_SUPPLY_TYPE_KEY]: 1500,
      },
    });
  });

  it("EST-125: mixed node subtotal adds direct lines and subsection totals once", () => {
    const parentSectionId = "section-a";
    const childSectionId = "section-b";
    const items: EstimateItemRecord[] = [
      createSectionRecord({ id: parentSectionId, parent_id: null, position: 1 }),
      createSectionRecord({ id: childSectionId, parent_id: parentSectionId, position: 2 }),
      createItemRecord({
        id: "line-a-direct",
        parent_id: parentSectionId,
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 100,
        tax_rate_bp: 0,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
      createItemRecord({
        id: "line-b-1",
        parent_id: childSectionId,
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 150,
        tax_rate_bp: 0,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
      createItemRecord({
        id: "line-b-2",
        parent_id: childSectionId,
        position: 2,
        quantity: 1,
        unit_price_ht_cents: 50,
        tax_rate_bp: 0,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
    ];

    const totals = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items,
      sectionId: parentSectionId,
      marginMultiplier: 1,
      taxRateBp: 0,
      discountCents: 0,
      laborRateById: new Map(),
    });

    expect(totals).toEqual({
      foTotalCents: 300,
      moTotalCents: 0,
      moAtelierTotalCents: 0,
      moChantierTotalCents: 0,
      totalHtCents: 300,
      totalTtcCents: 300,
      supplyTypeFoTotalsCents: {
        [UNASSIGNED_SUPPLY_TYPE_KEY]: 300,
      },
    });
  });

  it("computeAllSectionTotals matches computeSectionTotals on nested sections", () => {
    const parentSectionId = "section-parent";
    const childSectionId = "section-child";
    const siblingSectionId = "section-sibling";
    const items: EstimateItemRecord[] = [
      createSectionRecord({ id: parentSectionId, parent_id: null, position: 1 }),
      createSectionRecord({ id: childSectionId, parent_id: parentSectionId, position: 1 }),
      createSectionRecord({ id: siblingSectionId, parent_id: null, position: 2 }),
      createItemRecord({
        id: "line-parent",
        parent_id: parentSectionId,
        position: 2,
        quantity: 2,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
      createItemRecord({
        id: "line-child",
        parent_id: childSectionId,
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 500,
        k_fo: 1,
        h_mo: 1,
        k_mo: 1,
        labor_role_id: "role-a",
      }),
      createItemRecord({
        id: "line-sibling",
        parent_id: siblingSectionId,
        position: 1,
        quantity: 3,
        unit_price_ht_cents: 200,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        labor_role_id: null,
      }),
    ];

    const input = {
      items,
      marginMultiplier: 1.2,
      taxRateBp: 2000,
      discountCents: 350,
      laborRateById: new Map([["role-a", 450]]),
    };

    const expectedParent = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      ...input,
      sectionId: parentSectionId,
    });
    const expectedChild = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      ...input,
      sectionId: childSectionId,
    });
    const expectedSibling = computeSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      ...input,
      sectionId: siblingSectionId,
    });

    const computed = computeAllSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      ...input,
      sectionIds: [parentSectionId, childSectionId, siblingSectionId],
    });

    expect(computed.get(parentSectionId)).toEqual(expectedParent);
    expect(computed.get(childSectionId)).toEqual(expectedChild);
    expect(computed.get(siblingSectionId)).toEqual(expectedSibling);
  });

});

describe("B5: extracted business helpers", () => {
  it("computeInitialDiscountCents converts bp to cents", () => {
    const version = { margin_multiplier: 1, tax_rate_bp: 2000, discount_bp: 500 };
    const items: EstimateItemRecord[] = [
      createItemRecord({ quantity: 1, unit_price_ht_cents: 10000, k_fo: 1, h_mo: 0, k_mo: 1 }),
    ];
    const rateById = new Map<string, number>();

    const result = computeInitialDiscountCents(version, items, rateById);

    // saleSubtotal = 10000 (margin=1), discount = round(10000 * 500 / 10000) = 500
    expect(result).toBe(500);
  });

  it("computeStoredDiscountCents derives from stored totals", () => {
    const version = {
      margin_multiplier: 1,
      tax_rate_bp: 2000,
      discount_bp: 500,
      total_ht_cents: 9500,
    };
    const items: EstimateItemRecord[] = [
      createItemRecord({ line_total_ht_cents: 10000 }),
    ];

    const result = computeStoredDiscountCents(version, items);

    // saleSubtotal = 10000 from stored values, total_ht = 9500, discount = 500
    expect(result).toBe(500);
  });

  it("normalizeDraftItems recalculates line values", () => {
    const version = { margin_multiplier: 1.5, tax_rate_bp: 2000, discount_bp: 0 };
    const items: EstimateItemRecord[] = [
      createItemRecord({
        quantity: 2,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        pu_ht_cents: 0,
        line_total_ht_cents: 0,
        line_tax_cents: 0,
        line_total_ttc_cents: 0,
      }),
    ];
    const rateById = new Map<string, number>();

    const result = normalizeDraftItems({ isLaborSplitEnabled: false, items, version, rateById });

    expect(result[0].line_total_ht_cents).toBe(3000); // 2000 cost * 1.5 margin
    expect(result[0].line_tax_cents).toBe(600); // 3000 * 20%
    expect(result[0].line_total_ttc_cents).toBe(3600);
  });

  it("normalizeDraftItems skips sections", () => {
    const version = { margin_multiplier: 1.5, tax_rate_bp: 2000, discount_bp: 0 };
    const section = createItemRecord({ item_type: "section" });
    const items = [section];
    const rateById = new Map<string, number>();

    const result = normalizeDraftItems({ isLaborSplitEnabled: false, items, version, rateById });

    expect(result[0]).toBe(section); // unchanged reference
  });
});

describe("allocateProRata (EST-E26 phase C, étape 7)", () => {
  it("T4 : restes non divisibles, Σ === amount au centime", () => {
    // 3 lignes égales, montant 10 999 non divisible par 3 : le reliquat (+1) va
    // au premier index (égalité de reste), somme exacte 10 999.
    const parts = allocateProRata(10_999, [3_333, 3_333, 3_333]);
    expect(parts).toEqual([3_667, 3_666, 3_666]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(10_999);
    expect(parts.every((part) => part >= 0 && part <= 10_999)).toBe(true);
  });

  it("gère les cas limites (vide, montant nul, poids nuls, tout sur une part)", () => {
    expect(allocateProRata(100, [])).toEqual([]);
    expect(allocateProRata(0, [1, 2, 3])).toEqual([0, 0, 0]);
    // Poids tous nuls : répartition uniforme, somme conservée.
    expect(allocateProRata(10, [0, 0, 0])).toEqual([4, 3, 3]);
    // Tout le poids sur une seule part.
    expect(allocateProRata(100, [0, 5, 0])).toEqual([0, 100, 0]);
  });

  it("invariant property-based : Σ === amount, 0 <= part <= amount (10 000 tirages)", () => {
    for (let draw = 0; draw < 10_000; draw += 1) {
      const n = 1 + Math.floor(Math.random() * 50);
      const amount = Math.floor(Math.random() * 5_000_000);
      const weights = Array.from({ length: n }, () =>
        Math.floor(Math.random() * 100_000)
      );
      const parts = allocateProRata(amount, weights);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(amount);
      expect(parts.every((part) => part >= 0 && part <= amount)).toBe(true);
    }
  });
});

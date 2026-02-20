import { describe, expect, it } from "vitest";

import {
  computeEstimateLineValues,
  computeEstimateTotals,
  type EstimateLineLike,
} from "@/lib/estimate-calculations";

function createLine(overrides: Partial<EstimateLineLike> = {}): EstimateLineLike {
  return {
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: null,
    k_fo: 1,
    h_mo: 0,
    k_mo: 1,
    pu_ht_cents: null,
    labor_role_hourly_rate_cents: 0,
    ...overrides,
  };
}

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

  it("computeEstimateTotals with discount and taxes", () => {
    const totals = computeEstimateTotals({
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
      saleSubtotalCents: 12000,
      discountCents: 2000,
      saleTotalCents: 10000,
      taxCents: 1000,
      ttcCents: 11000,
      roundedTtcCents: 11000,
      roundingAdjustmentCents: 0,
      adjustedTaxCents: 1000,
    });
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
});

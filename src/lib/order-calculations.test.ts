import { describe, expect, it } from "vitest";

import {
  computeLineTotals,
  computeOrderTotals,
  computeTotalsFromInputs,
  OrderTotalNegativeError,
} from "@/lib/order-calculations";

describe("order calculations", () => {
  it("reconciles line and order totals in one pass", () => {
    const result = computeTotalsFromInputs([
      { quantity: 3, unitPriceHtCents: 333, taxRateBp: 2_000 },
      { quantity: 2, unitPriceHtCents: 1_250, taxRateBp: 550 },
    ]);

    expect(result).toEqual({
      lineTotals: [
        {
          lineTotalHtCents: 999,
          lineTaxCents: 200,
          lineTotalTtcCents: 1_199,
        },
        {
          lineTotalHtCents: 2_500,
          lineTaxCents: 138,
          lineTotalTtcCents: 2_638,
        },
      ],
      orderTotals: {
        totalHtCents: 3_499,
        totalTaxCents: 338,
        totalTtcCents: 3_837,
      },
    });
    expect(computeOrderTotals([])).toEqual({
      totalHtCents: 0,
      totalTaxCents: 0,
      totalTtcCents: 0,
    });
  });
});

/**
 * TI-691, delivery 3a: lines priced for a lot, shipping and discounts, as the database computes them
 * (normalize_purchase_order_item; pgTAP material-request-purchase-orders proves the same figures). Failure modes:
 *  1. an article for 1 unit (every existing line) moves by a cent;
 *  2. a price for 100 units is not divided, or its half cent rounds to even;
 *  3. a discount adds, its tax rounds towards zero, or the order total does not subtract it;
 *  4. a discount larger than the order passes, or is reported as an amount out of range.
 */
describe("order calculations for lots, shipping and discounts", () => {
  it("1 keeps every existing line to the cent", () => {
    for (const [quantity, price, tax] of [[12.5, 123, 2000], [0.125, 777, 2000], [0.001, 500, 2000], [2, 1250, 550]] as const) {
      expect(computeLineTotals({ quantity, unitPriceHtCents: price, taxRateBp: tax, pricePer: 1, kind: "article" }))
        .toEqual(computeLineTotals({ quantity, unitPriceHtCents: price, taxRateBp: tax }));
    }
    expect(computeLineTotals({ quantity: 12.5, unitPriceHtCents: 123, taxRateBp: 2000 }))
      .toEqual({ lineTotalHtCents: 1538, lineTaxCents: 308, lineTotalTtcCents: 1846 });
  });

  it("2 divides a price given for a lot and rounds its half cent away from zero", () => {
    expect(computeLineTotals({ quantity: 1500, unitPriceHtCents: 340, taxRateBp: 2000, pricePer: 100 }))
      .toEqual({ lineTotalHtCents: 5100, lineTaxCents: 1020, lineTotalTtcCents: 6120 });
    // 5 pairs at 0,05 € per 10 = 2,5 cents: 3, not 2.
    expect(computeLineTotals({ quantity: 5, unitPriceHtCents: 5, taxRateBp: 2000, pricePer: 10 }))
      .toEqual({ lineTotalHtCents: 3, lineTaxCents: 1, lineTotalTtcCents: 4 });
    expect(() => computeLineTotals({ quantity: 1, unitPriceHtCents: 1, taxRateBp: 2000, pricePer: 7 })).toThrow(RangeError);
  });

  it("3 subtracts a discount, its tax rounded away from zero, and shipping adds", () => {
    expect(computeLineTotals({ quantity: 1, unitPriceHtCents: 10, taxRateBp: 500, kind: "discount" }))
      .toEqual({ lineTotalHtCents: -10, lineTaxCents: -1, lineTotalTtcCents: -11 });
    expect(computeTotalsFromInputs([
      { quantity: 5, unitPriceHtCents: 1234, taxRateBp: 2000 },
      { quantity: 1, unitPriceHtCents: 1500, taxRateBp: 2000, kind: "shipping" },
      { quantity: 1, unitPriceHtCents: 10, taxRateBp: 500, kind: "discount" },
    ]).orderTotals).toEqual({ totalHtCents: 7660, totalTaxCents: 1533, totalTtcCents: 9193 });
  });

  it("4 refuses a discount larger than the order with its own error", () => {
    expect(() => computeTotalsFromInputs([
      { quantity: 1, unitPriceHtCents: 1000, taxRateBp: 2000 },
      { quantity: 1, unitPriceHtCents: 1001, taxRateBp: 2000, kind: "discount" },
    ])).toThrow(OrderTotalNegativeError);
    expect(() => computeTotalsFromInputs([{ quantity: 2, unitPriceHtCents: 2_000_000_000, taxRateBp: 0 }]))
      .toThrow("Le montant dépasse la capacité d'une commande.");
  });
});

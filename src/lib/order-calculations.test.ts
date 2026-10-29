import { describe, expect, it } from "vitest";

import {
  computeOrderTotals,
  computeTotalsFromInputs,
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

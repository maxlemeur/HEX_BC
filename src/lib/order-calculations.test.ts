import { describe, expect, it } from "vitest";

import {
  computeLineTotals,
  computeOrderTotals,
  computeTotalsFromInputs,
} from "@/lib/order-calculations";

describe("order calculations", () => {
  it.each([
    {
      label: "rounds fractional tax cents",
      input: { quantity: 3, unitPriceHtCents: 333, taxRateBp: 2_000 },
      expected: {
        lineTotalHtCents: 999,
        lineTaxCents: 200,
        lineTotalTtcCents: 1_199,
      },
    },
    {
      label: "keeps a zero-rated line tax free",
      input: { quantity: 2, unitPriceHtCents: 1_250, taxRateBp: 0 },
      expected: {
        lineTotalHtCents: 2_500,
        lineTaxCents: 0,
        lineTotalTtcCents: 2_500,
      },
    },
  ])("$label", ({ input, expected }) => {
    expect(computeLineTotals(input)).toEqual(expected);
  });

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

import { describe, expect, it, vi } from "vitest";

import {
  computeLineTotals,
  computeOrderTotals,
  computeTotalsFromInputs,
  recalculateOrderTotals,
} from "@/lib/order-calculations";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

type DatabaseError = { code: string; message: string };

function createSupabaseHarness(input?: {
  lineRows?: Array<{
    line_total_ht_cents: number;
    line_tax_cents: number;
    line_total_ttc_cents: number;
  }>;
  selectError?: DatabaseError | null;
  updateError?: DatabaseError | null;
}) {
  const selectEq = vi.fn().mockResolvedValue({
    data: input?.lineRows ?? [],
    error: input?.selectError ?? null,
  });
  const select = vi.fn(() => ({ eq: selectEq }));
  const updateEq = vi.fn().mockResolvedValue({
    error: input?.updateError ?? null,
  });
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn((table: string) => {
    if (table === "purchase_order_items") return { select };
    if (table === "purchase_orders") return { update };
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: { from },
    from,
    select,
    selectEq,
    update,
    updateEq,
  };
}

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

describe("recalculateOrderTotals", () => {
  it("loads the order lines and writes reconciled totals to the same order", async () => {
    const harness = createSupabaseHarness({
      lineRows: [
        {
          line_total_ht_cents: 999,
          line_tax_cents: 200,
          line_total_ttc_cents: 1_199,
        },
        {
          line_total_ht_cents: 2_500,
          line_tax_cents: 138,
          line_total_ttc_cents: 2_638,
        },
      ],
    });

    await expect(
      recalculateOrderTotals(ORDER_ID, harness.client as never)
    ).resolves.toEqual({
      totalHtCents: 3_499,
      totalTaxCents: 338,
      totalTtcCents: 3_837,
    });

    expect(harness.selectEq).toHaveBeenCalledWith("purchase_order_id", ORDER_ID);
    expect(harness.update).toHaveBeenCalledWith({
      total_ht_cents: 3_499,
      total_tax_cents: 338,
      total_ttc_cents: 3_837,
    });
    expect(harness.updateEq).toHaveBeenCalledWith("id", ORDER_ID);
  });

  it.each([
    { stage: "line loading", selectError: { code: "SELECT", message: "read failed" } },
    { stage: "header update", updateError: { code: "UPDATE", message: "write failed" } },
  ])("surfaces the database error from $stage", async (scenario) => {
    const expectedError = scenario.selectError ?? scenario.updateError;
    const harness = createSupabaseHarness(scenario);

    await expect(
      recalculateOrderTotals(ORDER_ID, harness.client as never)
    ).rejects.toBe(expectedError);

    if (scenario.selectError) {
      expect(harness.update).not.toHaveBeenCalled();
    }
  });
});

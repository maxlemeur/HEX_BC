import { describe, expect, it } from "vitest";

import { computeEstimateV3Breakdown } from "@/lib/estimates/engine-v3";
import {
  ORACLE_COST_SUM_CENTS,
  ORACLE_GROSS_SUM_CENTS,
  ORACLE_LINES,
  oracleInput,
  S5_LINE_BY_LINE_TAX,
  S5_REDUCTIONS,
  S5_TAX_BREAKDOWN,
  SCENARIOS,
} from "@/lib/estimates/engine-v3/oracle.fixtures";

// Lot 2, sous-lot 2.4 (docs/testing/estimate-engine-v3-2.4.md, F-V3-01, F-V3-04, F-V3-07).
// Isolation justifiée : le moteur v3 est inerte en 2.4 (aucune v3 ne peut être créée), aucun
// parcours E2E ne l'atteint, et les attendus sont au centime près (tolérance 0 c, §5.5).

describe("engine v3 oracle lines (§5.1)", () => {
  it.each(ORACLE_LINES.map((line, index) => [line.ref, line, index] as const))(
    "%s: PU, gross and cost at 1.30 / 1.20",
    (_ref, line, index) => {
      const result = computeEstimateV3Breakdown(oracleInput());
      const computed = result.lines[index];
      expect(computed.pu_ht_cents).toBe(line.pu130120);
      expect(computed.gross_ht_cents).toBe(line.gross130120);
      expect(computed.cost_ht_cents).toBe(line.cost);
    }
  );

  it("reproduces the workbook PU at 1.3 / 1.3 on 7 lines out of 7", () => {
    const result = computeEstimateV3Breakdown(
      oracleInput({ sale_coefficient_fo: "1.3", sale_coefficient_mo: "1.3" })
    );
    expect(result.lines.map((line) => line.pu_ht_cents)).toEqual(
      ORACLE_LINES.map((line) => line.pu130130)
    );
  });

  it("sums to 6 905 456 c gross and 5 487 177 c cost", () => {
    const result = computeEstimateV3Breakdown(oracleInput());
    expect(result.totals.gross_ht_cents).toBe(ORACLE_GROSS_SUM_CENTS);
    expect(result.totals.cost_subtotal_cents).toBe(ORACLE_COST_SUM_CENTS);
    // Coefficient réalisé dérivé des deux sommes de la conception : 6 905 456 / 5 487 177.
    expect(result.totals.realized_sale_coefficient).toBe("1.258472");
  });

  it("derives line hours from hours per unit (O1: 20 x 1.991 = 39.820 h)", () => {
    const result = computeEstimateV3Breakdown(oracleInput());
    expect(result.lines[0].h_mo).toBe("39.820");
    expect(result.lines[3].h_mo).toBe("227.800");
  });
});

describe("engine v3 scenarios (§5.2)", () => {
  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    "%s: gross, discount, rounding, net, VAT and TTC",
    (_id, scenario) => {
      const result = computeEstimateV3Breakdown(
        oracleInput(scenario.params, scenario.taxRateBpByRef ?? {})
      );
      expect(result.totals).toMatchObject({
        gross_ht_cents: scenario.gross,
        discount_applied_cents: scenario.discount,
        commercial_rounding_cents: scenario.rounding,
        total_ht_cents: scenario.net,
        total_tax_cents: scenario.tax,
        total_ttc_cents: scenario.ttc,
        rounding_adjustment_cents: 0,
      });
      const sumNets = result.lines.reduce((sum, line) => sum + line.line_total_ht_cents, 0);
      const sumTax = result.lines.reduce((sum, line) => sum + line.line_tax_cents, 0);
      expect(sumNets).toBe(scenario.net);
      expect(sumTax).toBe(scenario.tax);
    }
  );

  it("S5: allocates the 101 c as [5, 1, 2, 23, 0, 69, 1] and taxes per rate on the net base", () => {
    const s5 = SCENARIOS.find((scenario) => scenario.id === "S5");
    const result = computeEstimateV3Breakdown(oracleInput(s5?.params, s5?.taxRateBpByRef));
    expect(result.lines.map((line) => line.reduction_cents)).toEqual(S5_REDUCTIONS);
    expect(result.totals.tax_breakdown).toEqual(S5_TAX_BREAKDOWN);
    // La TVA ligne à ligne (moteur v2) donnerait 1 325 527 c : la v3 ne doit pas la reproduire.
    expect(result.totals.total_tax_cents).not.toBe(S5_LINE_BY_LINE_TAX);
  });
});

// Golden regime: arrondi commercial bankersRound vs Math.round.

import { describe, expect, it } from "vitest";

import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import { bankersRound, computeTaxCents } from "@/lib/money";
import { makeLine } from "./fixtures";

describe("Fixture I - arrondi médian bankersRound vs Math.round (§2.5) [surface 1]", () => {
  it("fige la divergence d'arrondi sur les résidus .5 AVANT unification", () => {
    // PRÉREQUIS §2.5 (handoff §4 pt 3) : computeTaxCents (money.ts:109) et les
    //   arrondis coût/vente ligne (estimate-calculations.ts:226/230) utilisent
    //   Math.round (biais systématique vers le haut sur .5), là où le reste du
    //   moteur utilise bankersRound (arrondi au pair). On FIGE l'écart AVANT
    //   l'unification de la phase C : quand ces sites passeront à bankersRound,
    //   ces valeurs basculeront de ±1 c et le diff sera explicite (sinon le
    //   ±1 c serait invisible et l'unification indétectable).
    const taxResidus = [25, 75, 125, 225].map((amountCents) => ({
      amountCents,
      exact: (amountCents * 200) / 10000,
      currentMathRound: computeTaxCents(amountCents, 200),
      bankersTarget: bankersRound((amountCents * 200) / 10000),
    }));
    // Actuel (Math.round) contre cible (bankersRound) : écart de 1 c sur 0,5 /
    // 2,5 / 4,5 (partie entière paire), nul sur 1,5.
    expect(taxResidus).toEqual([
      { amountCents: 25, exact: 0.5, currentMathRound: 1, bankersTarget: 0 },
      { amountCents: 75, exact: 1.5, currentMathRound: 2, bankersTarget: 2 },
      { amountCents: 125, exact: 2.5, currentMathRound: 3, bankersTarget: 2 },
      { amountCents: 225, exact: 4.5, currentMathRound: 5, bankersTarget: 4 },
    ]);

    // Propagation TVA ligne : 25 c @ 2 % = 0,5 c -> Math.round = 1 (bankers -> 0).
    const lineTaxResidu = computeEstimateLineValues(
      makeLine({
        quantity: 1,
        unit_price_ht_cents: 25,
        k_fo: 1,
        h_mo: 0,
        tax_rate_bp: 200,
      }),
      { marginMultiplier: 1, taxRateBp: 200, isLaborSplitEnabled: false }
    );
    expect(lineTaxResidu.taxLineCents).toBe(1);
    expect(lineTaxResidu.ttcLineCents).toBe(26);

    // Propagation coût ligne : 49 c × 0,5 = 24,5 -> Math.round = 25 (bankers -> 24).
    const lineCostResidu = computeEstimateLineValues(
      makeLine({
        quantity: 1,
        unit_price_ht_cents: 49,
        k_fo: 0.5,
        h_mo: 0,
        tax_rate_bp: 0,
      }),
      { marginMultiplier: 1, taxRateBp: 0, isLaborSplitEnabled: false }
    );
    expect(lineCostResidu.costLineCents).toBe(25);
    expect(lineCostResidu.saleLineCents).toBe(25);
  });
});

/* ---------------------------------------------------------------------------
 * Fixture J - contrat moteur v1/v2 et replay immuable du snapshot v2
 * ------------------------------------------------------------------------- */

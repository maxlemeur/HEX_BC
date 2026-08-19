// Golden regime: marge par paliers (fixture E).

import { describe, expect, it } from "vitest";

import {
  computeEstimateTotals,
  exceedsMaxCents,
  MAX_CENTS,
} from "@/lib/estimate-calculations";
import { getMarginTiers, type MarginTier } from "@/lib/estimates/margin-tiers";
import {
  makeLine,
  FIXTURE_E_ITEMS,
  TENANT_MARGIN_TIERS,
} from "./fixtures";

describe("Fixture E - marge par paliers [surface 1]", () => {
  const lineItems = FIXTURE_E_ITEMS.filter((i) => i.item_type === "line");
  const ENGINE = {
    marginMultiplier: 1.6,
    marginMode: "tiered" as const,
    // Barème injecté par le cas de test (sansBareme = [] -> repli défauts).
    marginTiers: [] as MarginTier[],
    globalCoefficient: 1,
    discountCents: 0,
    taxRateBp: 2_000,
    roundingMode: "none" as const,
    roundingStepCents: 0,
  };

  it("fige les 3 resolutions de palier sur des items identiques", () => {
    // DIVERGENCE #1 : seul server.ts:2988 charge la table margin_tiers du
    //   tenant. Les pages detail/print/portail et pdf-generator n'envoient
    //   aucun bareme -> repli sur DEFAULT_MARGIN_TIERS
    //   (estimate-calculations.ts:332 + margin-tiers.ts:9-13).
    // DIVERGENCE : marginTiers: [] ne donne PAS un multiplicateur de 1 ; le
    //   repli sur les defauts est refait plus bas (margin-tiers.ts:46).
    // DIVERGENCE : le palier est resolu sur le COUT TOTAL du devis, pas ligne
    //   a ligne, et la borne inferieure est inclusive (margin-tiers.ts:56-59).
    const sansBareme = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...ENGINE });
    const avecBaremeTenant = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems,
      ...ENGINE,
      marginTiers: TENANT_MARGIN_TIERS,
    });
    const baremeVide = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems,
      ...ENGINE,
      marginTiers: [],
    });
    expect({
      defauts: {
        appliedMarginMultiplier: sansBareme.appliedMarginMultiplier,
        saleSubtotalCents: sansBareme.saleSubtotalCents,
      },
      tenant: {
        appliedMarginMultiplier: avecBaremeTenant.appliedMarginMultiplier,
        saleSubtotalCents: avecBaremeTenant.saleSubtotalCents,
      },
      baremeVide: {
        appliedMarginMultiplier: baremeVide.appliedMarginMultiplier,
        saleSubtotalCents: baremeVide.saleSubtotalCents,
      },
      ecartAffichageVsStockeCents:
        sansBareme.saleSubtotalCents - avecBaremeTenant.saleSubtotalCents,
      defaultTiers: getMarginTiers(),
    }).toEqual({
        "baremeVide": {
          "appliedMarginMultiplier": 1.45,
          "saleSubtotalCents": 15225000,
        },
        "defaultTiers": [
          {
            "multiplier": 1.6,
            "position": 0,
            "threshold_cents": 0,
          },
          {
            "multiplier": 1.45,
            "position": 1,
            "threshold_cents": 10000000,
          },
          {
            "multiplier": 1.4,
            "position": 2,
            "threshold_cents": 100000000,
          },
        ],
        "defauts": {
          "appliedMarginMultiplier": 1.45,
          "saleSubtotalCents": 15225000,
        },
        "ecartAffichageVsStockeCents": 1050000,
        "tenant": {
          "appliedMarginMultiplier": 1.35,
          "saleSubtotalCents": 14175000,
        },
      });
  });

  it("fige les totaux complets du chemin par defaut", () => {
    expect(
      computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...ENGINE })
    ).toEqual({
        "adjustedTaxCents": 3045000,
        "appliedMarginMultiplier": 1.45,
        "costSubtotalCents": 10500000,
        "discountCents": 0,
        "discountMode": "simple",
        "discountStepTotals": [],
        "globalCoefficient": 1,
        "isCapped": false,
        "roundedTtcCents": 18270000,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 15225000,
        "saleSubtotalCents": 15225000,
        "saleTotalCents": 15225000,
        "taxCents": 3045000,
        "ttcCents": 18270000,
      });
  });

  it("fige l'ecretage silencieux au plafond de stockage (MAX_CENTS)", () => {
    // DIVERGENCE : capCents ecrete SANS erreur (estimate-calculations.ts:149).
    //   Les lignes sont ecretees en premier (estimate-calculations.ts:226 et
    //   :230), sans aucun marqueur. Consequence figee ici : isCapped vaut
    //   FALSE (estimate-calculations.ts:386 teste l'agregat, deja ecrete en
    //   amont) alors que le montant reel a bien depasse le plafond. Le devis
    //   annonce 21 474 836,47 EUR au lieu de 32 000 000,00 EUR, en silence.
    const capLine = makeLine({
      id: "cap-1",
      parent_id: "sec-1",
      position: 0,
      quantity: 1,
      unit_price_ht_cents: 2_000_000_000,
      k_fo: 1,
      h_mo: 0,
    });
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: [capLine],
      ...ENGINE,
      marginMode: "fixed",
    });
    expect({
      MAX_CENTS,
      exceedsMaxCentsBrut: exceedsMaxCents(2_000_000_000 * 1.6),
      exceedsMaxCentsSousPlafond: exceedsMaxCents(MAX_CENTS),
      isCapped: totals.isCapped,
      saleSubtotalCents: totals.saleSubtotalCents,
      saleSubtotalBeforeCoefficientCents:
        totals.saleSubtotalBeforeCoefficientCents,
    }).toEqual({
        "MAX_CENTS": 2147483647,
        "exceedsMaxCentsBrut": true,
        "exceedsMaxCentsSousPlafond": false,
        "isCapped": false,
        "saleSubtotalBeforeCoefficientCents": 2147483647,
        "saleSubtotalCents": 2147483647,
      });
  });
});

/* ---------------------------------------------------------------------------
 * Fixture F - split MO actif, 3 semantiques du flag
 * ------------------------------------------------------------------------- */

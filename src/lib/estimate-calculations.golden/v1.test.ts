// Golden regime: moteur v1 — fixtures A-D, H et surfaces editeur / pages / xlsx / PDF QR.

import { describe, expect, it } from "vitest";

import {
  computeEstimateLineValues,
  computeEstimateTotals,
  computeAllSectionTotals,
  computeSectionTotals,
  computeReadOnlyTotals,
  computeEstimateLineSaleSplit,
  computeCascadeDiscountCents,
  computeInitialDiscountCents,
  computeStoredDiscountCents,
  normalizeDraftItems,
  UNASSIGNED_SUPPLY_TYPE_KEY,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
  type EstimateTotals,
} from "@/lib/estimate-calculations";
import { type MarginTier } from "@/lib/estimates/margin-tiers";
import {
  buildLegacyDocumentBreakdown,
  DOCUMENT_CALC_ENGINE_VERSION,
  prepareEstimateDocumentData,
} from "@/components/estimate-document/prepare-estimate-document-data";
import {
  LABOR_RATES,
  LABOR_RATES_RECORD,
  GOLDEN_LAYOUT,
  asDocumentItems,
  summarizeRows,
  makeVersion,
  FIXTURE_A_ITEMS,
  FIXTURE_A_ENGINE,
  FIXTURE_B_ENGINE,
  FIXTURE_E_ITEMS,
  TENANT_MARGIN_TIERS,
  FIXTURE_F_ITEMS,
  FIXTURE_F_ENGINE,
  FIXTURE_H_ITEMS,
  FIXTURE_H_ENGINE,
} from "./fixtures";

describe("Fixture A - base coef 1 marge fixe [surfaces 1 et 3]", () => {
  const lineItems = FIXTURE_A_ITEMS.filter((i) => i.item_type === "line");

  it("fige les totaux globaux (double arrondi cout -> marge)", () => {
    // DIVERGENCE : Math.round(cout) puis Math.round(cout x marge)
    //   estimate-calculations.ts:226 et :230 -> deux arrondis en cascade.
    // DIVERGENCE : branche TVA "coefficient === 1" (test d'egalite stricte sur
    //   un float) -> somme des TVA arrondies ligne a ligne
    //   estimate-calculations.ts:429-432.
    // DIVERGENCE : branche (c) de remise, parametre absolu clampe
    //   estimate-calculations.ts:408-426.
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_A_ENGINE });
    expect(totals).toEqual({
        "adjustedTaxCents": 19576,
        "appliedMarginMultiplier": 1.6,
        "costSubtotalCents": 64299,
        "discountCents": 5000,
        "discountMode": "simple",
        "discountStepTotals": [
          {
            "cumulativeDiscountCents": 5000,
            "discountCents": 5000,
            "stepBp": null,
            "stepNumber": 1,
            "subtotalAfterCents": 97878,
            "subtotalBeforeCents": 102878,
          },
        ],
        "globalCoefficient": 1,
        "isCapped": false,
        "roundedTtcCents": 117454,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 102878,
        "saleSubtotalCents": 102878,
        "saleTotalCents": 97878,
        "taxCents": 19576,
        "ttcCents": 117454,
      });
  });

  it("fige les valeurs ligne a ligne (puHtCents non redistribue)", () => {
    // DIVERGENCE : puHtCents = bankersRound(sale / qty)
    //   estimate-calculations.ts:233-234 -> puHtCents x quantity ne
    //   reconstitue PAS saleLineCents.
    const perLine = lineItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      ...computeEstimateLineValues(item, {
        isLaborSplitEnabled: false,
        marginMultiplier: FIXTURE_A_ENGINE.marginMultiplier,
        taxRateBp: FIXTURE_A_ENGINE.taxRateBp,
      }),
    }));
    expect(perLine).toEqual([
        {
          "costLineCents": 50250,
          "id": "l1",
          "puHtCents": 26800,
          "quantity": 3,
          "saleLineCents": 80400,
          "taxLineCents": 16080,
          "ttcLineCents": 96480,
        },
        {
          "costLineCents": 14049,
          "id": "l2",
          "puHtCents": 22478,
          "quantity": 1,
          "saleLineCents": 22478,
          "taxLineCents": 4496,
          "ttcLineCents": 26974,
        },
      ]);
    const reconstructed = perLine.map(
      (line) => (line.puHtCents ?? 0) * (line.quantity ?? 0)
    );
    expect(reconstructed).toEqual([
        80400,
        22478,
      ]);
  });

  it("fige les sous-totaux de section et la ventilation par type de fourniture", () => {
    // DIVERGENCE : le residu d'arrondi de la ligne est absorbe par FO, jamais
    //   par MO -> estimate-calculations.ts:802.
    // DIVERGENCE : en mode legacy, TOUTE la MO est classee "chantier"
    //   (estimate-calculations.ts:765-767) : moAtelierTotalCents reste a 0 et
    //   moChantierTotalCents porte l'integralite de la main-d'oeuvre.
    // Les lignes n'ont pas de supply_type_id : la cle est
    //   UNASSIGNED_SUPPLY_TYPE_KEY (estimate-calculations.ts:979).
    const sectionTotals = computeAllSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items: FIXTURE_A_ITEMS,
      marginMultiplier: FIXTURE_A_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_A_ENGINE.taxRateBp,
      discountCents: FIXTURE_A_ENGINE.discountCents,
      laborRateById: LABOR_RATES,
    });
    expect(Object.fromEntries(sectionTotals)).toEqual({
        "sec-1": {
          "foTotalCents": 78013,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 19865,
          "moTotalCents": 19865,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 78013,
          },
          "totalHtCents": 97878,
          "totalTtcCents": 117454,
        },
      });
    expect(
      Object.keys(
        sectionTotals.get("sec-1")?.supplyTypeFoTotalsCents ?? {}
      )
    ).toEqual([UNASSIGNED_SUPPLY_TYPE_KEY]);
  });

  it("fige normalizeDraftItems puis computeReadOnlyTotals (isCapped absent)", () => {
    // DIVERGENCE : computeEstimateTotals renvoie isCapped
    //   (estimate-calculations.ts:462), computeReadOnlyTotals NON
    //   (estimate-calculations.ts:1294-1309) -> la cle manque dans le snapshot.
    const version = makeVersion({ discount_bp: 500 });
    const normalized = normalizeDraftItems({
      isLaborSplitEnabled: false,
      items: FIXTURE_A_ITEMS,
      version,
      rateById: LABOR_RATES,
    });
    expect(
      normalized.map((item) => ({
        id: item.id,
        item_type: item.item_type,
        tax_rate_bp: item.tax_rate_bp,
        pu_ht_cents: item.pu_ht_cents,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
      }))
    ).toEqual([
        {
          "id": "sec-1",
          "item_type": "section",
          "line_tax_cents": null,
          "line_total_ht_cents": null,
          "line_total_ttc_cents": null,
          "pu_ht_cents": null,
          "tax_rate_bp": 2000,
        },
        {
          "id": "l1",
          "item_type": "line",
          "line_tax_cents": 16080,
          "line_total_ht_cents": 80400,
          "line_total_ttc_cents": 96480,
          "pu_ht_cents": 26800,
          "tax_rate_bp": 2000,
        },
        {
          "id": "l2",
          "item_type": "line",
          "line_tax_cents": 4496,
          "line_total_ht_cents": 22478,
          "line_total_ttc_cents": 26974,
          "pu_ht_cents": 22478,
          "tax_rate_bp": 2000,
        },
      ]);

    const readOnly = computeReadOnlyTotals({
      isLaborSplitEnabled: false,
      items: normalized,
      version,
      discountCents: FIXTURE_A_ENGINE.discountCents,
      laborRateById: LABOR_RATES,
      marginTiers: [],
      roundingMode: "none" as const,
      roundingStepCents: 0,
      calcEngineVersion: 1 as const,    });
    expect(readOnly).toEqual({
        "adjustedTaxCents": 0,
        "appliedMarginMultiplier": 1.6,
        "costSubtotalCents": 64299,
        "discountCents": 5000,
        "discountMode": "simple",
        "discountStepTotals": [
          {
            "cumulativeDiscountCents": 5000,
            "discountCents": 5000,
            "stepBp": null,
            "stepNumber": 1,
            "subtotalAfterCents": 97878,
            "subtotalBeforeCents": 102878,
          },
        ],
        "globalCoefficient": 1,
        "roundedTtcCents": 97878,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 102878,
        "saleSubtotalCents": 102878,
        "saleTotalCents": 97878,
        "taxCents": 0,
        "ttcCents": 97878,
      });
    expect("isCapped" in readOnly).toBe(false);
  });

  it("fige la sortie document (surface 3, aucun mock)", () => {
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_A_ENGINE });
    const prepared = prepareEstimateDocumentData({
      items: asDocumentItems(FIXTURE_A_ITEMS),
      breakdown: buildLegacyDocumentBreakdown({
        items: asDocumentItems(FIXTURE_A_ITEMS),
        marginMultiplier: totals.appliedMarginMultiplier,
        discountCents: totals.discountCents,
        taxRateBp: FIXTURE_A_ENGINE.taxRateBp,
        isLaborSplitEnabled: false,
        laborRateById: LABOR_RATES_RECORD,
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: FIXTURE_A_ENGINE.taxRateBp,
      currency: "EUR",
      validiteJours: 30,
      layout: GOLDEN_LAYOUT,
    });
    expect({
      rows: summarizeRows(prepared.rows),
      numberingById: prepared.numberingById,
      sectionTotalsById: prepared.sectionTotalsById,
      lineSplitsById: prepared.lineSplitsById,
      taxEnabled: prepared.taxEnabled,
      discountLabel: prepared.discountLabel,
      validiteLabel: prepared.validiteLabel,
      taxLabel: prepared.taxLabel,
      qrLikeCellCount: prepared.qrLikeCells.length,
      layout: prepared.layout,
    }).toEqual({
        "discountLabel": "-50,00 €",
        "layout": {
          "conditionsPlacement": "auto",
          "density": "standard",
          "detailLevel": "lines",
          "includeTerms": false,
          "preset": "client_detailed",
          "priceMode": "unit_and_total",
          "showNumbering": true,
          "showSectionSubtotals": true,
        },
        "lineSplitsById": {
          "l1": {
            "foTotalCents": 66000,
            "moTotalCents": 14400,
            "totalHtCents": 80400,
          },
          "l2": {
            "foTotalCents": 15998,
            "moTotalCents": 6480,
            "totalHtCents": 22478,
          },
        },
        "numberingById": {
          "l1": "01.1",
          "l2": "01.2",
          "sec-1": "01",
        },
        "qrLikeCellCount": 0,
        "rows": [
          "sec-1@0",
          "l1@1",
          "l2@1",
        ],
        "sectionTotalsById": {
          "sec-1": {
            "foTotalCents": 78013,
            "moAtelierTotalCents": 0,
            "moChantierTotalCents": 19865,
            "moTotalCents": 19865,
            "supplyTypeFoTotalsCents": {
              "__unassigned__": 78013,
            },
            "totalHtCents": 97878,
            "totalTtcCents": 117454,
          },
        },
        "taxEnabled": true,
        "taxLabel": "20 %",
        "validiteLabel": "30 jours",
      });
  });
});

/* ---------------------------------------------------------------------------
 * Fixture B - coefficient global 1.10 (memes items que A)
 * ------------------------------------------------------------------------- */


describe("Fixture B - coefficient global 1.10 [surfaces 1 et 3]", () => {
  const lineItems = FIXTURE_A_ITEMS.filter((i) => i.item_type === "line");

  it("fige les totaux : le coefficient ne s'applique qu'a l'agregat", () => {
    // DIVERGENCE : le coefficient est applique sur l'AGREGAT seul
    //   (estimate-calculations.ts:381-383). La somme des saleLineCents
    //   (102 878) ne reconstitue plus saleSubtotalCents (113 166).
    // DIVERGENCE : bascule de branche TVA sur un test d'egalite stricte a 1
    //   sur un float (estimate-calculations.ts:429-432) : A passe par la somme
    //   des TVA ligne a ligne, B par computeTaxCents sur l'agregat.
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_B_ENGINE });
    expect(totals).toEqual({
        "adjustedTaxCents": 21633,
        "appliedMarginMultiplier": 1.6,
        "costSubtotalCents": 64299,
        "discountCents": 5000,
        "discountMode": "simple",
        "discountStepTotals": [
          {
            "cumulativeDiscountCents": 5000,
            "discountCents": 5000,
            "stepBp": null,
            "stepNumber": 1,
            "subtotalAfterCents": 108166,
            "subtotalBeforeCents": 113166,
          },
        ],
        "globalCoefficient": 1.1,
        "isCapped": false,
        "roundedTtcCents": 129799,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 102878,
        "saleSubtotalCents": 113166,
        "saleTotalCents": 108166,
        "taxCents": 21633,
        "ttcCents": 129799,
      });

    const sumOfLines = lineItems.reduce(
      (sum, item) =>
        sum +
        computeEstimateLineValues(item, {
          isLaborSplitEnabled: false,
          marginMultiplier: FIXTURE_B_ENGINE.marginMultiplier,
          taxRateBp: FIXTURE_B_ENGINE.taxRateBp,
        }).saleLineCents,
      0
    );
    expect(sumOfLines).toBe(102878);
    expect(sumOfLines).not.toBe(totals.saleSubtotalCents);
  });

  it("fige l'ecart section / total du a un prorata de remise biaise", () => {
    // DIVERGENCE : computeAllSectionTotals ignore totalement le coefficient
    //   global. Numerateur post-coefficient (estimate-calculations.ts:608-617)
    //   contre denominateur pre-coefficient (estimate-calculations.ts:901-912).
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_B_ENGINE });
    const sectionTotals = computeAllSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items: FIXTURE_A_ITEMS,
      marginMultiplier: FIXTURE_B_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_B_ENGINE.taxRateBp,
      discountCents: totals.discountCents,
      laborRateById: LABOR_RATES,
    });
    expect(Object.fromEntries(sectionTotals)).toEqual({
        "sec-1": {
          "foTotalCents": 78013,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 19865,
          "moTotalCents": 19865,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 78013,
          },
          "totalHtCents": 97878,
          "totalTtcCents": 117454,
        },
      });
    expect({
      saleTotalCents: totals.saleTotalCents,
      sectionHtCents: sectionTotals.get("sec-1")?.totalHtCents ?? 0,
      ecartCents:
        totals.saleTotalCents - (sectionTotals.get("sec-1")?.totalHtCents ?? 0),
    }).toEqual({
        "ecartCents": 10288,
        "saleTotalCents": 108166,
        "sectionHtCents": 97878,
      });
  });

  it("fige la sortie document sous coefficient (le document ignore le coefficient)", () => {
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_B_ENGINE });
    const prepared = prepareEstimateDocumentData({
      items: asDocumentItems(FIXTURE_A_ITEMS),
      breakdown: buildLegacyDocumentBreakdown({
        items: asDocumentItems(FIXTURE_A_ITEMS),
        marginMultiplier: totals.appliedMarginMultiplier,
        discountCents: totals.discountCents,
        taxRateBp: FIXTURE_B_ENGINE.taxRateBp,
        isLaborSplitEnabled: false,
        laborRateById: LABOR_RATES_RECORD,
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: FIXTURE_B_ENGINE.taxRateBp,
      currency: "EUR",
      validiteJours: 30,
      layout: GOLDEN_LAYOUT,
    });
    expect({
      sectionTotalsById: prepared.sectionTotalsById,
      lineSplitsById: prepared.lineSplitsById,
      discountLabel: prepared.discountLabel,
    }).toEqual({
        "discountLabel": "-50,00 €",
        "lineSplitsById": {
          "l1": {
            "foTotalCents": 66000,
            "moTotalCents": 14400,
            "totalHtCents": 80400,
          },
          "l2": {
            "foTotalCents": 15998,
            "moTotalCents": 6480,
            "totalHtCents": 22478,
          },
        },
        "sectionTotalsById": {
          "sec-1": {
            "foTotalCents": 78013,
            "moAtelierTotalCents": 0,
            "moChantierTotalCents": 19865,
            "moTotalCents": 19865,
            "supplyTypeFoTotalsCents": {
              "__unassigned__": 78013,
            },
            "totalHtCents": 97878,
            "totalTtcCents": 117454,
          },
        },
      });
  });
});

/* ---------------------------------------------------------------------------
 * Fixture C - remise cascade 3 etapes
 * ------------------------------------------------------------------------- */


describe("Fixture C - remise cascade 3 etapes [surface 1]", () => {
  const lineItems = FIXTURE_A_ITEMS.filter((i) => i.item_type === "line");
  const CASCADE_STEPS = [500, 300, 250];

  it("fige la priorite cascade > discountCents (999 999 silencieusement ignore)", () => {
    // DIVERGENCE : en mode cascade, le parametre discountCents n'est jamais lu
    //   (estimate-calculations.ts:394-400). 999 999 disparait sans avertir.
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems,
      ...FIXTURE_A_ENGINE,
      discountCents: 999_999,
      discountMode: "cascade",
      discountStepsBp: CASCADE_STEPS,
    });
    expect(totals).toEqual({
        "adjustedTaxCents": 18487,
        "appliedMarginMultiplier": 1.6,
        "costSubtotalCents": 64299,
        "discountCents": 10446,
        "discountMode": "cascade",
        "discountStepTotals": [
          {
            "cumulativeDiscountCents": 5144,
            "discountCents": 5144,
            "stepBp": 500,
            "stepNumber": 1,
            "subtotalAfterCents": 97734,
            "subtotalBeforeCents": 102878,
          },
          {
            "cumulativeDiscountCents": 8076,
            "discountCents": 2932,
            "stepBp": 300,
            "stepNumber": 2,
            "subtotalAfterCents": 94802,
            "subtotalBeforeCents": 97734,
          },
          {
            "cumulativeDiscountCents": 10446,
            "discountCents": 2370,
            "stepBp": 250,
            "stepNumber": 3,
            "subtotalAfterCents": 92432,
            "subtotalBeforeCents": 94802,
          },
        ],
        "globalCoefficient": 1,
        "isCapped": false,
        "roundedTtcCents": 110919,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 102878,
        "saleSubtotalCents": 102878,
        "saleTotalCents": 92432,
        "taxCents": 18487,
        "ttcCents": 110919,
      });
    expect(totals.discountCents).not.toBe(999_999);
  });

  it("fige computeCascadeDiscountCents etape par etape", () => {
    // DIVERGENCE : bankersRound((subtotalBefore x stepBp) / 10000) par etape,
    //   cascade sur le sous-total RESTANT -> estimate-calculations.ts:266-285.
    expect(
      computeCascadeDiscountCents(102_878, CASCADE_STEPS)
    ).toEqual({
        "discountCents": 10446,
        "steps": [
          {
            "cumulativeDiscountCents": 5144,
            "discountCents": 5144,
            "stepBp": 500,
            "stepNumber": 1,
            "subtotalAfterCents": 97734,
            "subtotalBeforeCents": 102878,
          },
          {
            "cumulativeDiscountCents": 8076,
            "discountCents": 2932,
            "stepBp": 300,
            "stepNumber": 2,
            "subtotalAfterCents": 94802,
            "subtotalBeforeCents": 97734,
          },
          {
            "cumulativeDiscountCents": 10446,
            "discountCents": 2370,
            "stepBp": 250,
            "stepNumber": 3,
            "subtotalAfterCents": 92432,
            "subtotalBeforeCents": 94802,
          },
        ],
        "subtotalAfterDiscountCents": 92432,
      });
  });

  it("fige l'ecart entre les 3 voies de calcul de la remise en cascade", () => {
    // DIVERGENCE : trois implementations distinctes de la meme remise :
    //   computeEstimateTotals (estimate-calculations.ts:394-400),
    //   computeInitialDiscountCents (estimate-calculations.ts:1073-1078),
    //   computeStoredDiscountCents (estimate-calculations.ts:1113-1118).
    const version = makeVersion({
      discount_mode: "cascade",
      discount_steps: CASCADE_STEPS,
      discount_bp: 0,
    });
    const storedItems = FIXTURE_A_ITEMS.map((item) =>
      item.item_type === "line"
        ? { ...item, line_total_ht_cents: item.id === "l1" ? 80_400 : 22_478 }
        : item
    );
    expect({
      engine: computeEstimateTotals({
        isLaborSplitEnabled: false,
        lineItems,
        ...FIXTURE_A_ENGINE,
        discountCents: 999_999,
        discountMode: "cascade",
        discountStepsBp: CASCADE_STEPS,
      }).discountCents,
      initial: computeInitialDiscountCents(version, FIXTURE_A_ITEMS, LABOR_RATES, false),
      stored: computeStoredDiscountCents(version, storedItems),
    }).toEqual({
        "engine": 10446,
        "initial": 10446,
        "stored": 10446,
      });
  });
});

/* ---------------------------------------------------------------------------
 * Fixture D - remise simple avec steps residuels
 * ------------------------------------------------------------------------- */


describe("Fixture D - remise simple steps residuels [surface 1]", () => {
  const lineItems = FIXTURE_A_ITEMS.filter((i) => i.item_type === "line");
  const RESIDUAL_STEPS = [750, 400, 200];

  it("fige la perte silencieuse des etapes 2..n en mode simple", () => {
    // DIVERGENCE : en mode "simple" avec plusieurs etapes, seule
    //   discountStepsBp[0] est utilisee ; les etapes 2 et 3 sont perdues sans
    //   aucun avertissement -> estimate-calculations.ts:401-407.
    // DIVERGENCE : discountCents (12 345) est ignore des qu'un step existe.
    const totals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems,
      ...FIXTURE_A_ENGINE,
      discountCents: 12_345,
      discountMode: "simple",
      discountStepsBp: RESIDUAL_STEPS,
    });
    expect(totals).toEqual({
        "adjustedTaxCents": 19033,
        "appliedMarginMultiplier": 1.6,
        "costSubtotalCents": 64299,
        "discountCents": 7716,
        "discountMode": "simple",
        "discountStepTotals": [
          {
            "cumulativeDiscountCents": 7716,
            "discountCents": 7716,
            "stepBp": 750,
            "stepNumber": 1,
            "subtotalAfterCents": 95162,
            "subtotalBeforeCents": 102878,
          },
        ],
        "globalCoefficient": 1,
        "isCapped": false,
        "roundedTtcCents": 114195,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 102878,
        "saleSubtotalCents": 102878,
        "saleTotalCents": 95162,
        "taxCents": 19033,
        "ttcCents": 114195,
      });
    expect(totals.discountCents).not.toBe(12_345);
    expect(totals.discountStepTotals).toHaveLength(1);
  });

  it("fige les 3 voies de calcul de la meme remise en pourcentage", () => {
    // DIVERGENCE STRUCTURELLE : la meme remise en pourcentage est arrondie par
    //   bankersRound dans la voie "steps" (estimate-calculations.ts:268) et par
    //   Math.round dans la voie discount_bp (:1084 et :1132).
    // ATTENTION — sur CETTE fixture les 3 voies coincident (7716) : la base a
    //   un residu de .85, sur lequel bankersRound et Math.round rendent la meme
    //   valeur. Ce test fige donc l'EGALITE actuelle des 3 voies, pas l'ecart
    //   d'arrondi. Il ne detecterait PAS une unification des deux arrondis ;
    //   separer les voies exigerait une base a residu .5 exact.
    const stepsVersion = makeVersion({
      discount_mode: "simple",
      discount_steps: RESIDUAL_STEPS,
      discount_bp: 750,
    });
    const bpVersion = makeVersion({
      discount_mode: "simple",
      discount_steps: null,
      discount_bp: 750,
    });
    expect({
      viaSteps: computeInitialDiscountCents(
        stepsVersion,
        FIXTURE_A_ITEMS,
        LABOR_RATES,
        false
      ),
      viaDiscountBp: computeInitialDiscountCents(
        bpVersion,
        FIXTURE_A_ITEMS,
        LABOR_RATES,
        false
      ),
      viaEngine: computeEstimateTotals({
        isLaborSplitEnabled: false,
        lineItems,
        ...FIXTURE_A_ENGINE,
        discountCents: 12_345,
        discountMode: "simple",
        discountStepsBp: RESIDUAL_STEPS,
      }).discountCents,
    }).toEqual({
        "viaDiscountBp": 7716,
        "viaEngine": 7716,
        "viaSteps": 7716,
      });
  });
});

/* ---------------------------------------------------------------------------
 * Fixture E - marge par paliers
 * ------------------------------------------------------------------------- */


// La regle d'export citee ici est RE-IMPLEMENTEE dans le test pour montrer
// l'inversion item/version du taux de TVA : le code d'export-stream.ts n'est
// PAS execute. Voir le describe "Surface exports XLSX (COUVERTURE PARTIELLE)".
describe("Fixture H - ligne racine + multi-TVA [surfaces 1 et 3]", () => {
  const lineItems = FIXTURE_H_ITEMS.filter((i) => i.item_type === "line");

  it("fige la remise perdue : la ligne racine gonfle le denominateur", () => {
    // DIVERGENCE : le denominateur de l'allocation de remise inclut la ligne
    //   racine (estimate-calculations.ts:901-912), qui n'apparait dans aucun
    //   numerateur de section (estimate-calculations.ts:608-617). Resultat :
    //   une partie de la remise n'est allouee a aucune section.
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_H_ENGINE });
    const sections = computeAllSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items: FIXTURE_H_ITEMS,
      marginMultiplier: FIXTURE_H_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_H_ENGINE.taxRateBp,
      discountCents: totals.discountCents,
      laborRateById: LABOR_RATES,
    });
    const splitsParLigne = lineItems.map((item) => ({
      id: item.id,
      saleLineCents: computeEstimateLineSaleSplit(item, {
        marginMultiplier: FIXTURE_H_ENGINE.marginMultiplier,
        taxRateBp: FIXTURE_H_ENGINE.taxRateBp,
        laborRateById: LABOR_RATES,
        isLaborSplitEnabled: false,
        laborRateAtelierById: LABOR_RATES,
        laborRateChantierById: LABOR_RATES,
      }).saleLineCents,
    }));
    const denominateurCents = splitsParLigne.reduce(
      (sum, line) => sum + line.saleLineCents,
      0
    );
    // Numerateurs : uniquement les lignes rattachees a une section.
    const numerateursCents = splitsParLigne
      .filter((line) => line.id !== "h3")
      .reduce((sum, line) => sum + line.saleLineCents, 0);
    const sectionsHtCents = Array.from(sections.values()).reduce(
      (sum, section) => sum + section.totalHtCents,
      0
    );
    expect(Object.fromEntries(sections)).toEqual({
        "sec-1": {
          "foTotalCents": 29778,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 0,
          "moTotalCents": 0,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 29778,
          },
          "totalHtCents": 29778,
          "totalTtcCents": 35734,
        },
        "sec-2": {
          "foTotalCents": 29778,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 0,
          "moTotalCents": 0,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 29778,
          },
          "totalHtCents": 29778,
          "totalTtcCents": 35734,
        },
      });
    expect({
      splitsParLigne,
      denominateurCents,
      numerateursCents,
      remiseTotaleCents: totals.discountCents,
      remiseAlloueeAuxSectionsCents: numerateursCents - sectionsHtCents,
      remisePerdueCents:
        totals.discountCents - (numerateursCents - sectionsHtCents),
    }).toEqual({
        "denominateurCents": 144000,
        "numerateursCents": 64000,
        "remiseAlloueeAuxSectionsCents": 4444,
        "remisePerdueCents": 5556,
        "remiseTotaleCents": 10000,
        "splitsParLigne": [
          {
            "id": "h1",
            "saleLineCents": 32000,
          },
          {
            "id": "h2",
            "saleLineCents": 32000,
          },
          {
            "id": "h3",
            "saleLineCents": 80000,
          },
        ],
      });
  });

  it("fige computeSectionTotals (voie unitaire) et une section inconnue", () => {
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_H_ENGINE });
    const base = {
      items: FIXTURE_H_ITEMS,
      marginMultiplier: FIXTURE_H_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_H_ENGINE.taxRateBp,
      discountCents: totals.discountCents,
      laborRateById: LABOR_RATES,
    };
    expect({
      sec1: computeSectionTotals({ marginMode: "fixed", marginTiers: [], globalCoefficient: 1, discountMode: "simple", discountStepsBp: [], calcEngineVersion: 1, isLaborSplitEnabled: false, ...base, sectionId: "sec-1" }),
      inconnue: computeSectionTotals({ marginMode: "fixed", marginTiers: [], globalCoefficient: 1, discountMode: "simple", discountStepsBp: [], calcEngineVersion: 1, isLaborSplitEnabled: false, ...base, sectionId: "sec-inexistante" }),
    }).toEqual({
        "inconnue": {
          "foTotalCents": 0,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 0,
          "moTotalCents": 0,
          "supplyTypeFoTotalsCents": {},
          "totalHtCents": 0,
          "totalTtcCents": 0,
        },
        "sec1": {
          "foTotalCents": 29778,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 0,
          "moTotalCents": 0,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 29778,
          },
          "totalHtCents": 29778,
          "totalTtcCents": 35734,
        },
      });
  });

  it("fige l'ecrasement du taux de TVA de ligne par celui de la version", () => {
    // DIVERGENCE : computeEstimateTotals ignore item.tax_rate_bp et applique un
    //   taux uniforme issu des options (estimate-calculations.ts:341 et :367-370).
    // DIVERGENCE : normalizeDraftItems fait `version.tax_rate_bp ?? item.tax_rate_bp`
    //   (estimate-calculations.ts:1163), alors que export-stream.ts:216 fait
    //   l'inverse : `item.tax_rate_bp ?? version.tax_rate_bp`.
    const version = makeVersion({ tax_rate_bp: 2_000 });
    const normalized = normalizeDraftItems({
      isLaborSplitEnabled: false,
      items: FIXTURE_H_ITEMS,
      version,
      rateById: LABOR_RATES,
    });
    const regleExportStream = lineItems.map((item) => ({
      id: item.id,
      taxRateBpUtilise: item.tax_rate_bp ?? version.tax_rate_bp ?? 0,
      ...computeEstimateLineValues(item, {
        isLaborSplitEnabled: false,
        marginMultiplier: version.margin_multiplier,
        taxRateBp: item.tax_rate_bp ?? version.tax_rate_bp ?? 0,
      }),
    }));
    expect({
      normalizeDraftItems: normalized
        .filter((item) => item.item_type === "line")
        .map((item) => ({
          id: item.id,
          tax_rate_bp: item.tax_rate_bp,
          line_total_ht_cents: item.line_total_ht_cents,
          line_tax_cents: item.line_tax_cents,
        })),
      regleExportStream,
    }).toEqual({
        "normalizeDraftItems": [
          {
            "id": "h1",
            "line_tax_cents": 6400,
            "line_total_ht_cents": 32000,
            "tax_rate_bp": 2000,
          },
          {
            "id": "h2",
            "line_tax_cents": 6400,
            "line_total_ht_cents": 32000,
            "tax_rate_bp": 2000,
          },
          {
            "id": "h3",
            "line_tax_cents": 16000,
            "line_total_ht_cents": 80000,
            "tax_rate_bp": 2000,
          },
        ],
        "regleExportStream": [
          {
            "costLineCents": 20000,
            "id": "h1",
            "puHtCents": 16000,
            "saleLineCents": 32000,
            "taxLineCents": 6400,
            "taxRateBpUtilise": 2000,
            "ttcLineCents": 38400,
          },
          {
            "costLineCents": 20000,
            "id": "h2",
            "puHtCents": 32000,
            "saleLineCents": 32000,
            "taxLineCents": 3200,
            "taxRateBpUtilise": 1000,
            "ttcLineCents": 35200,
          },
          {
            "costLineCents": 50000,
            "id": "h3",
            "puHtCents": 80000,
            "saleLineCents": 80000,
            "taxLineCents": 4400,
            "taxRateBpUtilise": 550,
            "ttcLineCents": 84400,
          },
        ],
      });
  });

  it("fige la sortie document : ligne racine rendue, storedTotal prioritaire", () => {
    // DIVERGENCE : prepareEstimateDocumentData:280-282 fait primer
    //   item.line_total_ht_cents (31 000) sur le recalcul (32 000).
    // DIVERGENCE : lignes BRUTES contre sections NETTES - lineSplitsById ne
    //   porte aucune remise alors que sectionTotalsById en porte une.
    // DIVERGENCE : la ligne racine h3 est rendue a depth 0, au meme niveau que
    //   les sections (prepare-estimate-document-data.ts:174-194).
    const totals = computeEstimateTotals({ isLaborSplitEnabled: false, lineItems, ...FIXTURE_H_ENGINE });
    const prepared = prepareEstimateDocumentData({
      items: asDocumentItems(FIXTURE_H_ITEMS),
      breakdown: buildLegacyDocumentBreakdown({
        items: asDocumentItems(FIXTURE_H_ITEMS),
        marginMultiplier: totals.appliedMarginMultiplier,
        discountCents: totals.discountCents,
        taxRateBp: FIXTURE_H_ENGINE.taxRateBp,
        isLaborSplitEnabled: false,
        laborRateById: LABOR_RATES_RECORD,
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: FIXTURE_H_ENGINE.taxRateBp,
      currency: "EUR",
      validiteJours: 30,
      layout: GOLDEN_LAYOUT,
    });
    expect({
      rows: summarizeRows(prepared.rows),
      numberingById: prepared.numberingById,
      sectionTotalsById: prepared.sectionTotalsById,
      lineSplitsById: prepared.lineSplitsById,
    }).toEqual({
        "lineSplitsById": {
          "h1": {
            "foTotalCents": 31000,
            "moTotalCents": 0,
            "totalHtCents": 31000,
          },
          "h2": {
            "foTotalCents": 32000,
            "moTotalCents": 0,
            "totalHtCents": 32000,
          },
          "h3": {
            "foTotalCents": 80000,
            "moTotalCents": 0,
            "totalHtCents": 80000,
          },
        },
        "numberingById": {
          "h1": "01.1",
          "h2": "02.1",
          "h3": "03",
          "sec-1": "01",
          "sec-2": "02",
        },
        "rows": [
          "sec-1@0",
          "h1@1",
          "sec-2@0",
          "h2@1",
          "h3@0",
        ],
        "sectionTotalsById": {
          "sec-1": {
            "foTotalCents": 29778,
            "moAtelierTotalCents": 0,
            "moChantierTotalCents": 0,
            "moTotalCents": 0,
            "supplyTypeFoTotalsCents": {
              "__unassigned__": 29778,
            },
            "totalHtCents": 29778,
            "totalTtcCents": 35734,
          },
          "sec-2": {
            "foTotalCents": 29778,
            "moAtelierTotalCents": 0,
            "moChantierTotalCents": 0,
            "moTotalCents": 0,
            "supplyTypeFoTotalsCents": {
              "__unassigned__": 29778,
            },
            "totalHtCents": 29778,
            "totalTtcCents": 35734,
          },
        },
      });
    expect(prepared.lineSplitsById.h1.totalHtCents).toBe(31_000);
  });
});

/* ---------------------------------------------------------------------------
 * Surface 2 - editeur
 * ------------------------------------------------------------------------- */


// ---------------------------------------------------------------------------
// COUVERTURE PARTIELLE — surface "editeur".
// useEstimateEditorState n'est pas montable sans next/navigation + UserContext
// + 15 controllers reseau. On rejoue ici la SEULE chaine de calcul, adaptee de
// useEstimateEditorState.impl.tsx:959-1019 (buildLineCalculationInput) puis
// :1075-1092 (filtre item_type === "line" + computeEstimateTotals).
//
// COPIE REDUITE, PAS COPIE CONFORME : buildEditorLineInput ci-dessous omet le
// spread `...readLaborSplitFields(item)` et la resolution des taux
// labor_role_atelier/chantier_hourly_rate_cents du hook reel. C'est inerte
// AUJOURD'HUI, parce que le hook cable isLaborSplitEnabled = false (:290) et
// que computeEstimateLineValues ne lit ces champs que si le split est actif
// (estimate-calculations.ts:215-219). Le jour ou EST_031_LABOR_SPLIT passera a
// true cote editeur, cette recomposition devra etre reprise.
//
// SONT COUVERTS : l'arithmetique de la chaine, le flag isLaborSplitEnabled tel
// qu'il arrive au moteur (cable en dur a false, :290), la derivation
// discount_bp = Math.round(discountCents / saleSubtotalCents * 10000)
// (:1281-1286) et l'aplatissement discount_steps -> [] (:1292-1293) /
// global_coefficient -> 1 (:1309-1310) en mode simple.
//
// NE SONT PAS COUVERTS : le cycle de vie React, totalsOutOfSync,
// persistedTotals, grandTotals (src/components/estimates/EstimateEditorTable.tsx:1981,
// non exporte), le filtre rapide quickFilteredItems (meme fichier, :850, non
// exporte), les 15 controllers et leurs fetch au montage. Aujourd'hui aucun
// test n'execute le corps du hook : EstimateEditorPage.test.tsx le remplace
// integralement par un vi.fn().
//
// NOTE : la surface "sous-totaux de section visibles" (useEstimateVisibility)
// est testable sans mock via renderHook, mais dans le projet vitest JSDOM.
// Elle n'a donc rien a faire ici et n'y est pas forcee.
// ---------------------------------------------------------------------------
function buildEditorLineInput(
  item: EstimateItemRecord,
  laborRateById: Map<string, number>
): EstimateItemRecord {
  return {
    ...item,
    tax_rate_bp: item.tax_rate_bp ?? 0,
    k_fo: item.k_fo ?? 1,
    h_mo: item.h_mo ?? 0,
    h_mo_majoration: item.h_mo_majoration ?? 1,
    k_mo: item.k_mo ?? 1,
    labor_role_hourly_rate_cents: item.labor_role_id
      ? (laborRateById.get(item.labor_role_id) ?? 0)
      : 0,
  };
}

describe("Surface editeur (COUVERTURE PARTIELLE) [surface 2]", () => {
  function runEditorTotals(
    items: EstimateItemRecord[],
    engine: Omit<
      Parameters<typeof computeEstimateTotals>[0],
      "lineItems" | "isLaborSplitEnabled"
    >
  ): EstimateTotals {
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => buildEditorLineInput(item, LABOR_RATES));
    return computeEstimateTotals({
      ...engine,
      lineItems,
      // POST-ETAPE 5 (EST-E26) : l'editeur derive isLaborSplitEnabled du flag
      // tenant reel (useEstimateEditorState.impl.tsx:290, desormais
      // useFeatureFlag). Ce harnais fige le cas flag OFF.
      isLaborSplitEnabled: false,
    });
  }

  it("fige la chaine editeur sur la fixture A", () => {
    expect(runEditorTotals(FIXTURE_A_ITEMS, FIXTURE_A_ENGINE)).toEqual({
        "adjustedTaxCents": 19576,
        "appliedMarginMultiplier": 1.6,
        "costSubtotalCents": 64299,
        "discountCents": 5000,
        "discountMode": "simple",
        "discountStepTotals": [
          {
            "cumulativeDiscountCents": 5000,
            "discountCents": 5000,
            "stepBp": null,
            "stepNumber": 1,
            "subtotalAfterCents": 97878,
            "subtotalBeforeCents": 102878,
          },
        ],
        "globalCoefficient": 1,
        "isCapped": false,
        "roundedTtcCents": 117454,
        "roundingAdjustmentCents": 0,
        "saleSubtotalBeforeCoefficientCents": 102878,
        "saleSubtotalCents": 102878,
        "saleTotalCents": 97878,
        "taxCents": 19576,
        "ttcCents": 117454,
      });
  });

  it("fige la coincidence editeur / moteur sur un item a payload de split", () => {
    // POST-ETAPE 5 (EST-E26) : l'appel nu a computeEstimateTotals ne peut plus
    //   auto-detecter le payload (isLaborSplitEnabled est requis). Avec le meme
    //   flag OFF que l'editeur, editeur et moteur coincident (9 600 c) : ecart 0.
    //   Avant : editeur 9 600 (force false) vs moteur 93 824 (auto-detection),
    //   ecart 84 224.
    const editeur = runEditorTotals(FIXTURE_F_ITEMS, FIXTURE_F_ENGINE);
    const moteurNu = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: FIXTURE_F_ITEMS.filter((i) => i.item_type === "line"),
      ...FIXTURE_F_ENGINE,
    });
    expect({
      editeurSaleSubtotalCents: editeur.saleSubtotalCents,
      moteurNuSaleSubtotalCents: moteurNu.saleSubtotalCents,
      ecartCents: moteurNu.saleSubtotalCents - editeur.saleSubtotalCents,
    }).toEqual({
        "ecartCents": 0,
        "editeurSaleSubtotalCents": 9600,
        "moteurNuSaleSubtotalCents": 9600,
      });
  });

  it("fige la derivation discount_bp et l'aplatissement du payload persiste", () => {
    // DIVERGENCE : discount_bp est derive par Math.round sur un ratio
    //   (useEstimateEditorState.impl.tsx:1281-1286), alors que le moteur
    //   recalcule la remise par bankersRound (estimate-calculations.ts:268).
    //   La base du ratio est saleSubtotalCents, donc POST-coefficient.
    // DIVERGENCE : en mode "simple", discount_steps est ecrase par []
    //   (useEstimateEditorState.impl.tsx:1292-1293) et global_coefficient par 1
    //   (:1309-1310) : le coefficient reellement utilise pour le calcul n'est
    //   pas persiste.
    const totals = runEditorTotals(FIXTURE_A_ITEMS, FIXTURE_B_ENGINE);
    const discountBase = totals.saleSubtotalCents;
    const discountBp =
      discountBase > 0
        ? Math.round((totals.discountCents / discountBase) * 10000)
        : 0;
    expect({
      saleSubtotalCents: totals.saleSubtotalCents,
      discountCents: totals.discountCents,
      discountBp,
      remiseReconstruiteDepuisBp: Math.round(
        (totals.saleSubtotalCents * discountBp) / 10000
      ),
      // Payload persiste en mode "simple" : discount_steps ecrase par [] et
      // global_coefficient ecrase par 1, alors que la fixture B calcule bien
      // avec un coefficient de 1.1 (useEstimateEditorState.impl.tsx:1292-1293
      // et :1309-1310).
      payloadPersiste: {
        discount_bp: discountBp,
        discount_mode: "simple",
        discount_steps: [] as number[],
        global_coefficient: 1,
        coefficientReellementCalcule: FIXTURE_B_ENGINE.globalCoefficient,
        margin_multiplier: totals.appliedMarginMultiplier,
        total_ht_cents: totals.saleTotalCents,
        total_tax_cents: totals.adjustedTaxCents,
      },
    }).toEqual({
        "discountBp": 442,
        "discountCents": 5000,
        "payloadPersiste": {
          "coefficientReellementCalcule": 1.1,
          "discount_bp": 442,
          "discount_mode": "simple",
          "discount_steps": [],
          "global_coefficient": 1,
          "margin_multiplier": 1.6,
          "total_ht_cents": 108166,
          "total_tax_cents": 21633,
        },
        "remiseReconstruiteDepuisBp": 5002,
        "saleSubtotalCents": 113166,
      });
  });
});

/* ---------------------------------------------------------------------------
 * Surface 4 - pages serveur (detail / print / portail)
 * ------------------------------------------------------------------------- */


// ---------------------------------------------------------------------------
// COUVERTURE PARTIELLE — surface "pages serveur".
// Les 3 pages sont des Server Components : createSupabaseServerClient() depend
// de cookies() de next/headers, le portail passe par createServiceRoleClient()
// et le flag par isFeatureEnabled (1 aller-retour Supabase). Rien de tout cela
// n'est montable ici, et un vi.mock contaminerait tout le fichier.
//
// SONT COUVERTS : la chaine arithmetique litterale commune aux 3 pages
// (baseTotals discountCents: 0 -> fallbackDiscountCents = Math.round(
// saleSubtotalCents * discount_bp / 10000) -> computedTotals), telle qu'elle
// est ecrite en dashboard/estimates/[versionId]/page.tsx:244 et :260,
// .../print/page.tsx:192 et :208, portal/[token]/page.tsx:154 et :174 —
// c'est-a-dire SANS marginTiers et SANS isLaborSplitEnabled ; plus l'ecart
// avec la voie serveur (computeInitialDiscountCents, server.ts:2997).
//
// NE SONT PAS COUVERTS : les SELECT (les 3 pages ne lisent pas les memes
// colonnes), les filtres tenant_id / user_id sur labor_roles (server.ts:2972-2973
// est le seul site a filtrer sur project.user_id), la gestion d'erreur
// divergente (notFound() contre silence), ni le bug estimateReference non
// selectionne.
//
// SIMPLIFICATION ASSUMEE : runServerPageChain cable roundingMode "none" /
// roundingStepCents 0, la ou les 3 pages passent version.rounding_mode et
// version.rounding_step_cents. Les valeurs sont neutres (aucun chiffre fige
// n'en depend), mais l'arrondi TTC final n'est donc pas couvert ici.
// ---------------------------------------------------------------------------
describe("Surface pages serveur (COUVERTURE PARTIELLE) [surface 4]", () => {
  function runServerPageChain(
    items: EstimateItemRecord[],
    version: EstimateVersionForCalc
  ) {
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => ({
        ...item,
        labor_role_hourly_rate_cents: item.labor_role_id
          ? (LABOR_RATES.get(item.labor_role_id) ?? 0)
          : 0,
      }));
    const commonInput = {
      lineItems,
      marginMultiplier: version.margin_multiplier,
      marginMode: version.margin_mode ?? "fixed",
      // Simulation : les pages omettaient tout barème (-> repli défauts). Depuis
      // l'étape 6 les VRAIES pages chargent le barème tenant (loadMarginTiersForTotals) ;
      // on conserve ici le chemin `[]` pour figer le repli de resolveMarginMultiplier.
      marginTiers: [] as MarginTier[],
      discountMode: version.discount_mode,
      discountStepsBp: version.discount_steps,
      globalCoefficient: version.global_coefficient,
      taxRateBp: version.tax_rate_bp,
      roundingMode: "none" as const,
      roundingStepCents: 0,
    };
    const baseTotals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      ...commonInput,
      discountCents: 0,
    });
    const fallbackDiscountCents =
      baseTotals.saleSubtotalCents > 0
        ? Math.round(
            (baseTotals.saleSubtotalCents * version.discount_bp) / 10000
          )
        : 0;
    const computedTotals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      ...commonInput,
      discountCents: fallbackDiscountCents,
    });
    return { baseTotals, fallbackDiscountCents, computedTotals };
  }

  it("fige la chaine des pages sur la fixture A", () => {
    const version = makeVersion({ discount_bp: 500 });
    const { fallbackDiscountCents, computedTotals } = runServerPageChain(
      FIXTURE_A_ITEMS,
      version
    );
    expect({ fallbackDiscountCents, computedTotals }).toEqual({
        "computedTotals": {
          "adjustedTaxCents": 19547,
          "appliedMarginMultiplier": 1.6,
          "costSubtotalCents": 64299,
          "discountCents": 5144,
          "discountMode": "simple",
          "discountStepTotals": [
            {
              "cumulativeDiscountCents": 5144,
              "discountCents": 5144,
              "stepBp": null,
              "stepNumber": 1,
              "subtotalAfterCents": 97734,
              "subtotalBeforeCents": 102878,
            },
          ],
          "globalCoefficient": 1,
          "isCapped": false,
          "roundedTtcCents": 117281,
          "roundingAdjustmentCents": 0,
          "saleSubtotalBeforeCoefficientCents": 102878,
          "saleSubtotalCents": 102878,
          "saleTotalCents": 97734,
          "taxCents": 19547,
          "ttcCents": 117281,
        },
        "fallbackDiscountCents": 5144,
      });
  });

  it("fige la DIVERGENCE #1 : bareme du tenant contre bareme par defaut", () => {
    // DIVERGENCE #1 : les pages n'envoient pas marginTiers -> repli sur
    //   DEFAULT_MARGIN_TIERS (estimate-calculations.ts:332). Seul
    //   server.ts:2988-2994 charge la table margin_tiers du tenant (via
    //   loadMarginTiersForTotals, server.ts:2878), et uniquement quand
    //   margin_mode vaut "tiered". Les totaux affiches et les totaux stockes
    //   divergent sur les memes items.
    const version = makeVersion({
      margin_mode: "tiered",
      discount_bp: 500,
    });
    const pages = runServerPageChain(FIXTURE_E_ITEMS, version);
    const lineItems = FIXTURE_E_ITEMS.filter((i) => i.item_type === "line").map(
      (item) => ({
        ...item,
        labor_role_hourly_rate_cents: item.labor_role_id
          ? (LABOR_RATES.get(item.labor_role_id) ?? 0)
          : 0,
      })
    );
    const serveur = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems,
      marginMultiplier: version.margin_multiplier,
      marginMode: version.margin_mode ?? "fixed",
      marginTiers: TENANT_MARGIN_TIERS,
      discountCents: 0,
      discountMode: version.discount_mode,
      discountStepsBp: version.discount_steps,
      globalCoefficient: version.global_coefficient,
      taxRateBp: version.tax_rate_bp,
      roundingMode: "none",
      roundingStepCents: 0,
    });
    expect({
      pagesAppliedMarginMultiplier:
        pages.computedTotals.appliedMarginMultiplier,
      pagesSaleSubtotalCents: pages.computedTotals.saleSubtotalCents,
      pagesFallbackDiscountCents: pages.fallbackDiscountCents,
      serveurAppliedMarginMultiplier: serveur.appliedMarginMultiplier,
      serveurSaleSubtotalCents: serveur.saleSubtotalCents,
      ecartSaleSubtotalCents:
        pages.computedTotals.saleSubtotalCents - serveur.saleSubtotalCents,
    }).toEqual({
        "ecartSaleSubtotalCents": 1050000,
        "pagesAppliedMarginMultiplier": 1.45,
        "pagesFallbackDiscountCents": 761250,
        "pagesSaleSubtotalCents": 15225000,
        "serveurAppliedMarginMultiplier": 1.35,
        "serveurSaleSubtotalCents": 14175000,
      });
  });

  it("fige l'ecart entre la remise des pages et computeInitialDiscountCents", () => {
    // DIVERGENCE : computeInitialDiscountCents (appele en server.ts:2997)
    //   ignore totalement margin_mode et utilise version.margin_multiplier brut
    //   (estimate-calculations.ts:1047-1056). Les pages, elles, resolvent un
    //   palier. Sur un devis en mode "tiered", les deux remises different.
    const version = makeVersion({ margin_mode: "tiered", discount_bp: 500 });
    const pages = runServerPageChain(FIXTURE_E_ITEMS, version);
    expect({
      pagesFallbackDiscountCents: pages.fallbackDiscountCents,
      serveurInitialDiscountCents: computeInitialDiscountCents(
        version,
        FIXTURE_E_ITEMS,
        LABOR_RATES,
        false
      ),
    }).toEqual({
        "pagesFallbackDiscountCents": 761250,
        "serveurInitialDiscountCents": 840000,
      });
  });
});

/* ---------------------------------------------------------------------------
 * Surface 5 - exports XLSX
 * ------------------------------------------------------------------------- */


// ---------------------------------------------------------------------------
// COUVERTURE PARTIELLE — surface "exports XLSX".
// streamEstimateVersionXlsx / ...BdcV11Xlsx / ...DpgfXlsx exigent
// vi.mock("@/lib/estimates/server") AU NIVEAU MODULE, un harnais WorkbookWriter
// maison et la consommation d'un ReadableStream. Un vi.mock de module
// contaminerait tout ce fichier : le streaming reste donc dehors. Il est deja
// couvert par export-stream.test.ts, bdc-export.test.ts, dpgf-export.test.ts
// et editor-export.test.ts.
//
// SONT COUVERTS, parce que T6 va y toucher : (a) resolveStoredDiscountCents
// recompose a l'identique depuis export-stream.ts:156-171 (remise reconstruite
// par soustraction, 0 quand total_ht_cents n'est pas fini), (b)
// computeReadOnlyTotals SANS isLaborSplitEnabled, qui produit la feuille
// "Resume", et la non-additivite entre la feuille "Devis" (somme des
// line_total_ht_cents) et la feuille "Resume" (total_ht_cents stocke).
//
// NE SONT PAS COUVERTS : la serialisation exceljs, les 31 colonnes du BDC, les
// 19 du DPGF, les numFmt / couleurs / notes, ni les lots de 200 comparaisons
// fournisseurs.
// ---------------------------------------------------------------------------
describe("Surface exports XLSX (COUVERTURE PARTIELLE) [surface 5]", () => {
  // Copie litterale de export-stream.ts:156-171.
  function resolveStoredDiscountCents(
    version: EstimateVersionForCalc,
    items: EstimateItemRecord[]
  ) {
    const lineSubtotalCents = items.reduce((sum, item) => {
      if (item.item_type !== "line") return sum;
      return sum + (item.line_total_ht_cents ?? 0);
    }, 0);
    const storedHt = version.total_ht_cents;
    if (Number.isFinite(storedHt ?? NaN)) {
      return Math.max(lineSubtotalCents - (storedHt ?? 0), 0);
    }
    return 0;
  }

  // Fixture H figee dans son etat "envoye" : les line_total_ht_cents sont
  // stockes, h1 restant volontairement divergent (31 000 au lieu de 32 000).
  const STORED_ITEMS: EstimateItemRecord[] = FIXTURE_H_ITEMS.map((item) => {
    if (item.item_type !== "line") return item;
    if (item.id === "h1") return { ...item, line_total_ht_cents: 31_000 };
    if (item.id === "h2") return { ...item, line_total_ht_cents: 32_000 };
    return { ...item, line_total_ht_cents: 80_000 };
  });

  it("fige la remise reconstruite par soustraction et la feuille Resume", () => {
    // DIVERGENCE : la remise n'est pas relue, elle est RECONSTRUITE par
    //   soustraction (export-stream.ts:164-167). Toute derive entre la somme
    //   des lignes et total_ht_cents devient une "remise".
    // DIVERGENCE : la somme des lignes de la feuille "Devis" (143 000) ne
    //   reconstitue pas le total HT de la feuille "Resume" (134 000).
    const version = makeVersion({
      status: "sent",
      total_ht_cents: 134_000,
      total_tax_cents: 26_800,
      total_ttc_cents: 160_800,
    });
    const discountCents = resolveStoredDiscountCents(version, STORED_ITEMS);
    const resume = computeReadOnlyTotals({
      isLaborSplitEnabled: false,
      items: STORED_ITEMS,
      version,
      discountCents,
      laborRateById: LABOR_RATES,
      marginTiers: [],
      roundingMode: "none" as const,
      roundingStepCents: 0,
      calcEngineVersion: 1 as const,    });
    expect({
      sommeDesLignesCents: STORED_ITEMS.reduce(
        (sum, item) =>
          item.item_type === "line"
            ? sum + (item.line_total_ht_cents ?? 0)
            : sum,
        0
      ),
      discountCents,
      resume,
    }).toEqual({
        "discountCents": 9000,
        "resume": {
          "adjustedTaxCents": 26800,
          "appliedMarginMultiplier": 1.6,
          "costSubtotalCents": 90000,
          "discountCents": 9000,
          "discountMode": "simple",
          "discountStepTotals": [
            {
              "cumulativeDiscountCents": 9000,
              "discountCents": 9000,
              "stepBp": null,
              "stepNumber": 1,
              "subtotalAfterCents": 134000,
              "subtotalBeforeCents": 143000,
            },
          ],
          "globalCoefficient": 1,
          "roundedTtcCents": 160800,
          "roundingAdjustmentCents": 0,
          "saleSubtotalBeforeCoefficientCents": 143000,
          "saleSubtotalCents": 143000,
          "saleTotalCents": 134000,
          "taxCents": 26800,
          "ttcCents": 160800,
        },
        "sommeDesLignesCents": 143000,
      });
  });

  it("fige la divergence resolveStoredDiscountCents / computeStoredDiscountCents", () => {
    // DIVERGENCE : sans total_ht_cents, export-stream.ts:170 renvoie 0 alors
    //   que computeStoredDiscountCents replie sur discount_bp
    //   (estimate-calculations.ts:1132-1134). Meme devis, deux remises.
    // DIVERGENCE : resolveStoredDiscountCents ignore global_coefficient, que
    //   computeStoredDiscountCents applique (estimate-calculations.ts:1102-1108).
    const sansTotalStocke = makeVersion({
      status: "sent",
      total_ht_cents: null,
      discount_bp: 500,
    });
    const avecCoefficient = makeVersion({
      status: "sent",
      total_ht_cents: 134_000,
      discount_bp: 500,
      global_coefficient: 1.1,
    });
    expect({
      sansTotalStocke: {
        exportStream: resolveStoredDiscountCents(sansTotalStocke, STORED_ITEMS),
        moteur: computeStoredDiscountCents(sansTotalStocke, STORED_ITEMS),
      },
      avecCoefficient: {
        exportStream: resolveStoredDiscountCents(avecCoefficient, STORED_ITEMS),
        moteur: computeStoredDiscountCents(avecCoefficient, STORED_ITEMS),
      },
    }).toEqual({
        "avecCoefficient": {
          "exportStream": 9000,
          "moteur": 23300,
        },
        "sansTotalStocke": {
          "exportStream": 0,
          "moteur": 7150,
        },
      });
  });
});

/* ---------------------------------------------------------------------------
 * Surface 6 - PDF
 * ------------------------------------------------------------------------- */


describe("Surface PDF QR (COUVERTURE PARTIELLE) [surface 6]", () => {
  it("fige le QR pseudo-aleatoire (deterministe, sans Math.random ni Date)", () => {
    const prepared = prepareEstimateDocumentData({
      items: asDocumentItems(FIXTURE_A_ITEMS),
      breakdown: buildLegacyDocumentBreakdown({
        items: asDocumentItems(FIXTURE_A_ITEMS),
        marginMultiplier: 1.6,
        discountCents: 5_000,
        taxRateBp: 2_000,
        isLaborSplitEnabled: false,
        laborRateById: LABOR_RATES_RECORD,
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: 2_000,
      currency: "EUR",
      validiteJours: 30,
      portalUrl: "https://example.test/portal/tok",
      layout: GOLDEN_LAYOUT,
    });
    expect({
      total: prepared.qrLikeCells.length,
      actives: prepared.qrLikeCells.filter((cell) => cell.enabled).length,
      douzePremieres: prepared.qrLikeCells.slice(0, 12),
    }).toEqual({
        "actives": 226,
        "douzePremieres": [
          {
            "enabled": true,
            "id": "0-0",
          },
          {
            "enabled": true,
            "id": "1-0",
          },
          {
            "enabled": true,
            "id": "2-0",
          },
          {
            "enabled": true,
            "id": "3-0",
          },
          {
            "enabled": true,
            "id": "4-0",
          },
          {
            "enabled": true,
            "id": "5-0",
          },
          {
            "enabled": true,
            "id": "6-0",
          },
          {
            "enabled": false,
            "id": "7-0",
          },
          {
            "enabled": false,
            "id": "8-0",
          },
          {
            "enabled": false,
            "id": "9-0",
          },
          {
            "enabled": true,
            "id": "10-0",
          },
          {
            "enabled": true,
            "id": "11-0",
          },
        ],
        "total": 441,
      });
  });
});

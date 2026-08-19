// Golden regime: sous-traitance / split main-d'oeuvre (fixtures F, G + PDF FO/MO).

import { describe, expect, it } from "vitest";

import {
  computeEstimateTotals,
  computeAllSectionTotals,
  computeEstimateLineSaleSplit,
  computeEstimateLineValues,
  hasActiveLaborSplitPayload,
} from "@/lib/estimate-calculations";
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
  FIXTURE_F_ITEMS,
  FIXTURE_F_ENGINE,
  FIXTURE_G_ITEM,
} from "./fixtures";

describe("Fixture F - split MO actif / 3 semantiques du flag [surface 1]", () => {
  const lineItems = FIXTURE_F_ITEMS.filter((i) => i.item_type === "line");

  it("fige la semantique unique du flag (pied === section)", () => {
    // POST-ETAPE 5 (EST-E26) : le flag isLaborSplitEnabled est requis et porte
    //   UNE seule semantique -> `isLaborSplitEnabled && hasActiveLaborSplitPayload`.
    //   Plus d'auto-detection implicite (`?? hasSplitPayload`) ni de defaut
    //   `= false` divergent. Le « sans flag » (desormais explicitement `false`)
    //   coincide avec `flagFalse`, et le pied (9 600 c) egale enfin la section
    //   (9 600 c) : ecart 0.
    //   Avant : pied 93 824 c (auto-detection) vs section 9 600 c, ecart 84 224.
    const totauxSansFlag = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems,
      ...FIXTURE_F_ENGINE,
    });
    const totauxFlagFalse = computeEstimateTotals({
      lineItems,
      ...FIXTURE_F_ENGINE,
      isLaborSplitEnabled: false,
    });
    const totauxFlagTrue = computeEstimateTotals({
      lineItems,
      ...FIXTURE_F_ENGINE,
      isLaborSplitEnabled: true,
    });
    const sectionsSansFlag = computeAllSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      isLaborSplitEnabled: false,
      items: FIXTURE_F_ITEMS,
      marginMultiplier: FIXTURE_F_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
      discountCents: 0,
      laborRateById: LABOR_RATES,
    });
    expect({
      totauxSansFlagSaleSubtotalCents: totauxSansFlag.saleSubtotalCents,
      totauxFlagFalseSaleSubtotalCents: totauxFlagFalse.saleSubtotalCents,
      totauxFlagTrueSaleSubtotalCents: totauxFlagTrue.saleSubtotalCents,
      sectionSansFlag: sectionsSansFlag.get("sec-1"),
      ecartGlobalVsSectionCents:
        totauxSansFlag.saleSubtotalCents -
        (sectionsSansFlag.get("sec-1")?.totalHtCents ?? 0),
    }).toEqual({
        "ecartGlobalVsSectionCents": 0,
        "sectionSansFlag": {
          "foTotalCents": 9600,
          "moAtelierTotalCents": 0,
          "moChantierTotalCents": 0,
          "moTotalCents": 0,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 9600,
          },
          "totalHtCents": 9600,
          "totalTtcCents": 11520,
        },
        "totauxFlagFalseSaleSubtotalCents": 9600,
        "totauxFlagTrueSaleSubtotalCents": 93824,
        "totauxSansFlagSaleSubtotalCents": 9600,
      });
  });

  it("fige computeEstimateLineSaleSplit dans les deux etats du flag", () => {
    // DIVERGENCE : `isLaborSplitEnabled && hasActiveLaborSplitPayload(item)`
    //   (estimate-calculations.ts:758-759). Flag OFF, la MO du payload de
    //   split (84 224 c) disparait entierement : le moteur retombe sur la voie
    //   legacy `h_mo x taux x k_mo` (estimate-calculations.ts:767), or h_mo
    //   vaut 0 sur cet item. La ligne ne facture plus que la fourniture.
    const splitOff = computeEstimateLineSaleSplit(lineItems[0], {
      marginMultiplier: FIXTURE_F_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
      laborRateById: LABOR_RATES,
      isLaborSplitEnabled: false,
      laborRateAtelierById: LABOR_RATES,
      laborRateChantierById: LABOR_RATES,
    });
    const splitOn = computeEstimateLineSaleSplit(lineItems[0], {
      marginMultiplier: FIXTURE_F_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
      laborRateById: LABOR_RATES,
      isLaborSplitEnabled: true,
      laborRateAtelierById: LABOR_RATES,
      laborRateChantierById: LABOR_RATES,
    });
    expect({ splitOff, splitOn }).toEqual({
        "splitOff": {
          "foSaleLineCents": 9600,
          "moAtelierSaleLineCents": 0,
          "moChantierSaleLineCents": 0,
          "moSaleLineCents": 0,
          "saleLineCents": 9600,
          "taxLineCents": 1920,
        },
        "splitOn": {
          "foSaleLineCents": 9600,
          "moAtelierSaleLineCents": 24320,
          "moChantierSaleLineCents": 59904,
          "moSaleLineCents": 84224,
          "saleLineCents": 93824,
          "taxLineCents": 18765,
        },
      });
  });

  it("fige les sous-totaux de section flag ON contre flag OFF", () => {
    const sectionsOn = computeAllSectionTotals({
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountStepsBp: [],
      calcEngineVersion: 1,
      items: FIXTURE_F_ITEMS,
      marginMultiplier: FIXTURE_F_ENGINE.marginMultiplier,
      taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
      discountCents: 0,
      laborRateById: LABOR_RATES,
      isLaborSplitEnabled: true,
    });
    expect(Object.fromEntries(sectionsOn)).toEqual({
        "sec-1": {
          "foTotalCents": 9600,
          "moAtelierTotalCents": 24320,
          "moChantierTotalCents": 59904,
          "moTotalCents": 84224,
          "supplyTypeFoTotalsCents": {
            "__unassigned__": 9600,
          },
          "totalHtCents": 93824,
          "totalTtcCents": 112589,
        },
      });
  });
});

/* ---------------------------------------------------------------------------
 * Fixture G - payload de split residuel
 * ------------------------------------------------------------------------- */

describe("Fixture G - payload split residuel [surface 1]", () => {
  it("fige la detection de payload : chaine vide et k_mo_atelier = 0 l'activent", () => {
    // DIVERGENCE : la detection teste `!== null && !== undefined`, pas la
    //   truthiness -> une chaine VIDE active le split
    //   (estimate-calculations.ts:138-142).
    // DIVERGENCE : `(k_mo_atelier ?? 1) !== 1` -> la valeur 0 active le split
    //   (estimate-calculations.ts:143-144).
    expect({
      item: hasActiveLaborSplitPayload(FIXTURE_G_ITEM),
      chaineVide: hasActiveLaborSplitPayload({
        h_mo_atelier: null,
        k_mo_atelier: null,
        labor_role_atelier_id: "",
        h_mo_chantier: null,
        k_mo_chantier: null,
        labor_role_chantier_id: null,
      }),
      kMoAtelierZero: hasActiveLaborSplitPayload({
        h_mo_atelier: null,
        k_mo_atelier: 0,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: null,
        labor_role_chantier_id: null,
      }),
      vide: hasActiveLaborSplitPayload({
        h_mo_atelier: null,
        k_mo_atelier: null,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: null,
        labor_role_chantier_id: null,
      }),
    }).toEqual({
        "chaineVide": true,
        "item": true,
        "kMoAtelierZero": true,
        "vide": false,
      });
  });

  it("fige la semantique unique de computeEstimateLineValues sur le meme item", () => {
    // POST-ETAPE 5 (EST-E26) : l'auto-detection a disparu. Le flag est requis ;
    //   sans split (`false`) on retombe sur le legacy (la MO 3 h x 45,00 EUR est
    //   facturee : 18 500 c), et seul le flag `true` active le payload residuel
    //   (5 000 c). `sansFlag` (flag omis, desormais explicitement `false`)
    //   coincide donc avec `flagFalse` : c'est la reconciliation recherchee.
    const options = { marginMultiplier: 1.6, taxRateBp: 2_000 };
    expect({
      sansFlag: computeEstimateLineValues(FIXTURE_G_ITEM, {
        ...options,
        isLaborSplitEnabled: false,
      }),
      flagFalse: computeEstimateLineValues(FIXTURE_G_ITEM, {
        ...options,
        isLaborSplitEnabled: false,
      }),
      flagTrue: computeEstimateLineValues(FIXTURE_G_ITEM, {
        ...options,
        isLaborSplitEnabled: true,
      }),
    }).toEqual({
        "flagFalse": {
          "costLineCents": 18500,
          "puHtCents": 29600,
          "saleLineCents": 29600,
          "taxLineCents": 5920,
          "ttcLineCents": 35520,
        },
        "flagTrue": {
          "costLineCents": 5000,
          "puHtCents": 8000,
          "saleLineCents": 8000,
          "taxLineCents": 1600,
          "ttcLineCents": 9600,
        },
        "sansFlag": {
          "costLineCents": 18500,
          "puHtCents": 29600,
          "saleLineCents": 29600,
          "taxLineCents": 5920,
          "ttcLineCents": 35520,
        },
      });
  });

  it("fige la 4e regle de detection du repo (editor-items.readLaborSplitFields)", () => {
    // DIVERGENCE : editor-items.ts:80-87 utilise `(h ?? 0) > 0`, la ou
    //   estimate-calculations.ts:136-145 utilise `!== null`. Consequence :
    //   h_mo_atelier = 0 est "split actif" pour hasActiveLaborSplitPayload et
    //   "split inactif" pour readLaborSplitFields (donc pour editor-export).
    // La regle d'editor-items est recopiee ici : l'importer ferait entrer
    //   @/lib/estimates/editor-items dans le graphe du golden.
    const readLaborSplitFieldsRule = (item: {
      h_mo_atelier: number | null;
      k_mo_atelier: number | null;
      labor_role_atelier_id: string | null;
    }) => {
      const laborRoleAtelierId =
        typeof item.labor_role_atelier_id === "string" &&
        item.labor_role_atelier_id.trim().length > 0
          ? item.labor_role_atelier_id
          : null;
      return (
        (item.h_mo_atelier ?? 0) > 0 ||
        laborRoleAtelierId !== null ||
        (item.k_mo_atelier ?? 1) !== 1
      );
    };
    const probe = {
      h_mo_atelier: 0,
      k_mo_atelier: null,
      labor_role_atelier_id: "",
    };
    expect({
      moteur: hasActiveLaborSplitPayload({
        ...probe,
        h_mo_chantier: null,
        k_mo_chantier: null,
        labor_role_chantier_id: null,
      }),
      editorItems: readLaborSplitFieldsRule(probe),
    }).toEqual({
        "editorItems": false,
        "moteur": true,
      });
  });
});

// COUVERTURE PARTIELLE — surface "PDF".
// generateEstimatePdfNow n'est pas testable : auth + 6 requetes Supabase +
// readFile + renderToBuffer + upload storage. buildEstimatePdfDocument exige
// vi.mock("@react-pdf/renderer") au niveau module (StyleSheet.create s'evalue
// a l'import, pdf-generator.tsx:193), ce qui contaminerait tout ce fichier.
// On fige donc l'ENTREE du rendu PDF (prepareEstimateDocumentData appelee avec
// les arguments exacts de pdf-generator.tsx:1747-1757) et non sa sortie.
// Aucun octet de PDF n'est produit ici : ne pas lire ce describe comme une
// couverture du rendu.
//
// SONT COUVERTS : isLaborSplitEnabled cable en dur a false cote PDF, l'absence
// de portalUrl (donc de QR), et le split FO/MO effectivement livre au PDF,
// compares au meme appel cote HTML (EstimateDocument.tsx:206-217, flag reel +
// portalUrl).
//
// NE SONT PAS COUVERTS : la reutilisation du PDF deja genere, decidee sur le
// seul file_path (pdf-generator.tsx:1592-1604), sans layout ni hash de contenu ;
// l'absence de toute ligne "Remise" dans l'encart de totaux (:1451-1466 — le
// mot "Remise" n'apparait nulle part dans pdf-generator.tsx, alors que
// prepared.discountLabel existe) ; les libelles reconstruits en dur
// (`{input.version.validite_jours} jours`, :1437, au lieu de
// prepared.validiteLabel) ; la primaute des access.version.total_*_cents
// (:1740-1745).
// ---------------------------------------------------------------------------
describe("Surface PDF (COUVERTURE PARTIELLE) [surface 6]", () => {
  it("fige l'entree PDF contre l'entree HTML sur les memes items", () => {
    // DIVERGENCE : pdf-generator.tsx:1753 cable isLaborSplitEnabled: false en
    //   dur, quel que soit l'etat reel du flag EST_031_LABOR_SPLIT. Sur des
    //   items a payload de split, le PDF et l'ecran ne montrent pas les memes
    //   montants FO/MO ni les memes sous-totaux de section.
    const computedTotals = computeEstimateTotals({
      isLaborSplitEnabled: false,
      lineItems: FIXTURE_F_ITEMS.filter((i) => i.item_type === "line"),
      ...FIXTURE_F_ENGINE,
    });

    // Call-site PDF : pdf-generator.tsx:1747-1757.
    const pdfPrepared = prepareEstimateDocumentData({
      items: asDocumentItems(FIXTURE_F_ITEMS),
      breakdown: buildLegacyDocumentBreakdown({
        items: asDocumentItems(FIXTURE_F_ITEMS),
        marginMultiplier: computedTotals.appliedMarginMultiplier,
        discountCents: computedTotals.discountCents,
        taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
        isLaborSplitEnabled: false,
        laborRateById: LABOR_RATES_RECORD,
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
      currency: "EUR",
      validiteJours: 30,
      layout: GOLDEN_LAYOUT,
    });

    // Call-site HTML : EstimateDocument.tsx:206-217 (flag reel + portalUrl).
    const htmlPrepared = prepareEstimateDocumentData({
      items: asDocumentItems(FIXTURE_F_ITEMS),
      breakdown: buildLegacyDocumentBreakdown({
        items: asDocumentItems(FIXTURE_F_ITEMS),
        marginMultiplier: computedTotals.appliedMarginMultiplier,
        discountCents: computedTotals.discountCents,
        taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
        isLaborSplitEnabled: true,
        laborRateById: LABOR_RATES_RECORD,
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: FIXTURE_F_ENGINE.taxRateBp,
      currency: "EUR",
      validiteJours: 30,
      portalUrl: "https://example.test/portal/tok",
      layout: GOLDEN_LAYOUT,
    });

    expect({
      pdf: {
        sectionTotalsById: pdfPrepared.sectionTotalsById,
        lineSplitsById: pdfPrepared.lineSplitsById,
      },
      html: {
        sectionTotalsById: htmlPrepared.sectionTotalsById,
        lineSplitsById: htmlPrepared.lineSplitsById,
      },
    }).toEqual({
        "html": {
          "lineSplitsById": {
            "s1": {
              "foTotalCents": 9600,
              "moTotalCents": 84224,
              "totalHtCents": 93824,
            },
          },
          "sectionTotalsById": {
            "sec-1": {
              "foTotalCents": 9600,
              "moAtelierTotalCents": 24320,
              "moChantierTotalCents": 59904,
              "moTotalCents": 84224,
              "supplyTypeFoTotalsCents": {
                "__unassigned__": 9600,
              },
              "totalHtCents": 93824,
              "totalTtcCents": 112589,
            },
          },
        },
        "pdf": {
          "lineSplitsById": {
            "s1": {
              "foTotalCents": 9600,
              "moTotalCents": 0,
              "totalHtCents": 9600,
            },
          },
          "sectionTotalsById": {
            "sec-1": {
              "foTotalCents": 9600,
              "moAtelierTotalCents": 0,
              "moChantierTotalCents": 0,
              "moTotalCents": 0,
              "supplyTypeFoTotalsCents": {
                "__unassigned__": 9600,
              },
              "totalHtCents": 9600,
              "totalTtcCents": 11520,
            },
          },
        },
      });

    expect(pdfPrepared.qrLikeCells).toHaveLength(0);
    expect(htmlPrepared.qrLikeCells).toHaveLength(441);
  });

});

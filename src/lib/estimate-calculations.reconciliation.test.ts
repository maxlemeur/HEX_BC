// =============================================================================
// T6 phase C - tests de réconciliation du moteur unifié (computeEstimateBreakdown).
//
// EST-E26 §5 : l'invariant « Σ lignes === Σ sections === pied » doit être vrai
// AU CENTIME en version 2 (opt-in). La version 1 délègue au chemin historique
// (comportement inchangé, matchesFooter = false).
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  computeAllSectionTotals,
  computeEstimateBreakdown,
  computeEstimateTotals,
  computeReadOnlyTotals,
  type EstimateComputationInput,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import {
  buildLegacyDocumentBreakdown,
  DOCUMENT_CALC_ENGINE_VERSION,
  prepareEstimateDocumentData,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";

function makeLine(overrides: Partial<EstimateItemRecord> = {}): EstimateItemRecord {
  return {
    id: "line-1",
    item_type: "line",
    parent_id: null,
    title: "Ligne",
    description: null,
    position: 0,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2_000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    labor_role_hourly_rate_cents: 0,
    labor_role_atelier_hourly_rate_cents: 0,
    labor_role_chantier_hourly_rate_cents: 0,
    pu_ht_cents: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    ...overrides,
  };
}

function makeSection(overrides: Partial<EstimateItemRecord> = {}): EstimateItemRecord {
  return makeLine({ id: "sec-1", item_type: "section", title: "Lot", ...overrides });
}

function makeInput(
  items: EstimateItemRecord[],
  overrides: Partial<EstimateComputationInput> = {}
): EstimateComputationInput {
  return {
    items,
    marginMultiplier: 1,
    marginMode: "fixed",
    marginTiers: [],
    globalCoefficient: 1,
    discountMode: "simple",
    discountCents: 0,
    discountStepsBp: [],
    taxRateBp: 2_000,
    roundingMode: "none",
    roundingStepCents: 0,
    isLaborSplitEnabled: false,
    laborRateById: new Map(),
    laborRateAtelierById: new Map(),
    laborRateChantierById: new Map(),
    calcEngineVersion: 2,
    ...overrides,
  };
}

describe("computeEstimateBreakdown - réconciliation (EST-E26 §5)", () => {
  it("T2 : le coefficient global entre dans les sections", () => {
    // 1 section, 1 ligne coût 100 000 c, marge 1,5, coefficient 1,10, remise 0.
    const items = [
      makeSection({ id: "sec-1", parent_id: null, position: 0 }),
      makeLine({ id: "l1", parent_id: "sec-1", position: 1, unit_price_ht_cents: 100_000 }),
    ];
    const bd = computeEstimateBreakdown(
      makeInput(items, { marginMultiplier: 1.5, globalCoefficient: 1.1 })
    );
    expect(bd.totals.saleTotalCents).toBe(165_000);
    expect(bd.sectionById.get("sec-1")?.totalHtCents).toBe(165_000);
    expect(bd.invariants.matchesFooter).toBe(true);
  });

  it("T3 : remise sur base post-coefficient, allocation exacte aux sections", () => {
    // 2 sections A/B, 1 ligne chacune à 100 000 c de vente, marge 1, coefficient
    // 1,20, cascade 10 %.
    const items = [
      makeSection({ id: "secA", parent_id: null, position: 0, title: "A" }),
      makeLine({ id: "a1", parent_id: "secA", position: 1, unit_price_ht_cents: 100_000 }),
      makeSection({ id: "secB", parent_id: null, position: 2, title: "B" }),
      makeLine({ id: "b1", parent_id: "secB", position: 3, unit_price_ht_cents: 100_000 }),
    ];
    const bd = computeEstimateBreakdown(
      makeInput(items, {
        marginMultiplier: 1,
        globalCoefficient: 1.2,
        discountMode: "cascade",
        discountStepsBp: [1_000],
      })
    );
    expect(bd.totals.saleSubtotalCents).toBe(240_000);
    expect(bd.totals.discountCents).toBe(24_000);
    expect(bd.totals.saleTotalCents).toBe(216_000);
    expect(bd.sectionById.get("secA")?.totalHtCents).toBe(108_000);
    expect(bd.sectionById.get("secB")?.totalHtCents).toBe(108_000);
    expect(bd.invariants.matchesFooter).toBe(true);
  });

  it("T4 : allocation avec restes non divisibles, Σ === pied", () => {
    // 3 lignes racine à 3 333 c de vente, coefficient 1,10, remise 0.
    const items = [
      makeLine({ id: "r1", parent_id: null, position: 0, unit_price_ht_cents: 3_333 }),
      makeLine({ id: "r2", parent_id: null, position: 1, unit_price_ht_cents: 3_333 }),
      makeLine({ id: "r3", parent_id: null, position: 2, unit_price_ht_cents: 3_333 }),
    ];
    const bd = computeEstimateBreakdown(
      makeInput(items, { marginMultiplier: 1, globalCoefficient: 1.1 })
    );
    expect(bd.totals.saleSubtotalCents).toBe(10_999);
    expect([
      bd.lineById.get("r1")?.saleNetHtCents,
      bd.lineById.get("r2")?.saleNetHtCents,
      bd.lineById.get("r3")?.saleNetHtCents,
    ]).toEqual([3_667, 3_666, 3_666]);
    expect(bd.invariants.matchesFooter).toBe(true);
  });

  it("T7 : TVA multi-taux, pied === Σ TVA par ligne", () => {
    // 2 lignes à 100 000 c de vente, ligne A à 2000 bp, ligne B à 1000 bp,
    // version à 2000 bp, coefficient 1.
    const items = [
      makeLine({ id: "a", parent_id: null, position: 0, unit_price_ht_cents: 100_000, tax_rate_bp: 2_000 }),
      makeLine({ id: "b", parent_id: null, position: 1, unit_price_ht_cents: 100_000, tax_rate_bp: 1_000 }),
    ];
    const bd = computeEstimateBreakdown(makeInput(items, { taxRateBp: 2_000 }));
    expect(bd.lineById.get("a")?.taxCents).toBe(20_000);
    expect(bd.lineById.get("b")?.taxCents).toBe(10_000);
    expect(bd.totals.taxCents).toBe(30_000);
  });

  it("T8 : lignes racine + sections somment au pied", () => {
    // 1 section « Lot 1 » à 80 000 c + 1 ligne racine à 20 000 c, remise 10 000,
    // coefficient 1.
    const items = [
      makeSection({ id: "lot1", parent_id: null, position: 0, title: "Lot 1" }),
      makeLine({ id: "l1", parent_id: "lot1", position: 1, unit_price_ht_cents: 80_000 }),
      makeLine({ id: "root", parent_id: null, position: 2, unit_price_ht_cents: 20_000 }),
    ];
    const bd = computeEstimateBreakdown(
      makeInput(items, { discountCents: 10_000 })
    );
    expect(bd.totals.saleTotalCents).toBe(90_000);
    const sectionHt = bd.sectionById.get("lot1")?.totalHtCents ?? 0;
    const rootHt = bd.rootLineIds.reduce(
      (sum, id) => sum + (bd.lineById.get(id)?.saleNetHtCents ?? 0),
      0
    );
    expect(sectionHt + rootHt).toBe(90_000);
    expect(bd.rootLineIds).toEqual(["root"]);
  });

  it("garde-fou calcEngineVersion : v1 (historique) vs v2 (réconcilié)", () => {
    const items = [
      makeSection({ id: "sec-1", parent_id: null, position: 0 }),
      makeLine({ id: "l1", parent_id: "sec-1", position: 1, unit_price_ht_cents: 100_000 }),
    ];
    const base = { marginMultiplier: 1.5, globalCoefficient: 1.1 } as const;
    const v2 = computeEstimateBreakdown(makeInput(items, { ...base, calcEngineVersion: 2 }));
    const v1 = computeEstimateBreakdown(makeInput(items, { ...base, calcEngineVersion: 1 }));

    // v2 réconcilie : section === pied === 165 000.
    expect(v2.sectionById.get("sec-1")?.totalHtCents).toBe(165_000);
    expect(v2.totals.saleTotalCents).toBe(165_000);
    expect(v2.invariants.matchesFooter).toBe(true);

    // v1 : la section ignore le coefficient (divergence historique) -> 150 000,
    // le pied reste 165 000 ; matchesFooter false. Comportement inchangé.
    expect(v1.sectionById.get("sec-1")?.totalHtCents).toBe(150_000);
    expect(v1.totals.saleTotalCents).toBe(165_000);
    expect(v1.invariants.matchesFooter).toBe(false);
  });

  it("T1 : invariant universel (property-based, 300 devis v2)", () => {
    const taxRates = [0, 550, 1_000, 2_000];
    for (let draw = 0; draw < 300; draw += 1) {
      const items: EstimateItemRecord[] = [];
      let position = 0;
      const sectionCount = 1 + Math.floor(Math.random() * 3);
      for (let s = 0; s < sectionCount; s += 1) {
        const sectionId = `sec-${s}`;
        items.push(makeSection({ id: sectionId, parent_id: null, position: position++ }));
        const lineCount = Math.floor(Math.random() * 5);
        for (let l = 0; l < lineCount; l += 1) {
          items.push(
            makeLine({
              id: `l-${s}-${l}`,
              parent_id: sectionId,
              position: position++,
              unit_price_ht_cents: Math.floor(Math.random() * 500_000),
              tax_rate_bp: taxRates[Math.floor(Math.random() * taxRates.length)],
            })
          );
        }
      }
      const rootCount = Math.floor(Math.random() * 3);
      for (let r = 0; r < rootCount; r += 1) {
        items.push(
          makeLine({
            id: `root-${r}`,
            parent_id: null,
            position: position++,
            unit_price_ht_cents: Math.floor(Math.random() * 500_000),
            tax_rate_bp: taxRates[Math.floor(Math.random() * taxRates.length)],
          })
        );
      }

      const cascade = Math.random() < 0.5;
      const bd = computeEstimateBreakdown(
        makeInput(items, {
          marginMultiplier: 0.5 + Math.random() * 1.5,
          globalCoefficient: 0.5 + Math.random() * 1.5,
          discountMode: cascade ? "cascade" : "simple",
          discountStepsBp: cascade ? [Math.floor(Math.random() * 3_000)] : [],
          discountCents: Math.floor(Math.random() * 50_000),
        })
      );

      const lines = Array.from(bd.lineById.values());
      const sumNet = lines.reduce((sum, line) => sum + line.saleNetHtCents, 0);
      // Σ lignes === pied, au centime.
      expect(sumNet).toBe(bd.totals.saleTotalCents);
      // aucune part nette négative.
      expect(lines.every((line) => line.saleNetHtCents >= 0)).toBe(true);
      // Σ sections racine + Σ lignes racine === pied.
      const topSectionHt = items
        .filter((item) => item.item_type === "section" && !item.parent_id)
        .reduce((sum, section) => sum + (bd.sectionById.get(section.id)?.totalHtCents ?? 0), 0);
      const rootHt = bd.rootLineIds.reduce(
        (sum, id) => sum + (bd.lineById.get(id)?.saleNetHtCents ?? 0),
        0
      );
      expect(topSectionHt + rootHt).toBe(bd.totals.saleTotalCents);
      // Σ TVA lignes === TVA pied.
      const sumTax = lines.reduce((sum, line) => sum + line.taxCents, 0);
      expect(sumTax).toBe(bd.totals.taxCents);
      expect(bd.invariants.matchesFooter).toBe(true);
    }
  });
});

// Référence : le pied de computeEstimateBreakdown reste celui de
// computeEstimateTotals (même valeur de saleTotalCents) — le breakdown n'invente
// pas de total, il l'alloue.
describe("computeEstimateBreakdown - cohérence du pied avec computeEstimateTotals", () => {
  it("le saleTotalCents du breakdown égale celui de computeEstimateTotals", () => {
    const items = [
      makeSection({ id: "sec-1", parent_id: null, position: 0 }),
      makeLine({ id: "l1", parent_id: "sec-1", position: 1, unit_price_ht_cents: 123_456 }),
      makeLine({ id: "l2", parent_id: "sec-1", position: 2, unit_price_ht_cents: 78_910 }),
    ];
    const bd = computeEstimateBreakdown(
      makeInput(items, { marginMultiplier: 1.6, globalCoefficient: 1.1, discountCents: 5_000 })
    );
    const footer = computeEstimateTotals({
      lineItems: [
        { ...makeLine({ id: "l1", unit_price_ht_cents: 123_456 }), labor_role_hourly_rate_cents: 0 },
        { ...makeLine({ id: "l2", unit_price_ht_cents: 78_910 }), labor_role_hourly_rate_cents: 0 },
      ],
      marginMultiplier: 1.6,
      marginMode: "fixed",
      marginTiers: [],
      discountCents: 5_000,
      globalCoefficient: 1.1,
      taxRateBp: 2_000,
      roundingMode: "none",
      roundingStepCents: 0,
      isLaborSplitEnabled: false,
    });
    expect(bd.totals.saleTotalCents).toBe(footer.saleTotalCents);
  });
});

// Étape 9 : computeAllSectionTotals devient un wrapper gaté du breakdown.
describe("computeAllSectionTotals - gate calcEngineVersion (étape 9)", () => {
  it("v2 dérive du breakdown réconcilié ; v1 garde le chemin historique", () => {
    const items = [
      makeSection({ id: "sec-1", parent_id: null, position: 0 }),
      makeLine({ id: "l1", parent_id: "sec-1", position: 1, unit_price_ht_cents: 100_000 }),
    ];
    const base = {
      items,
      marginMultiplier: 1.5,
      marginMode: "fixed" as const,
      marginTiers: [],
      globalCoefficient: 1.1,
      discountMode: "simple" as const,
      discountCents: 0,
      discountStepsBp: [],
      taxRateBp: 2_000,
      laborRateById: new Map<string, number>(),
      isLaborSplitEnabled: false,
    };
    // v2 : le coefficient global entre dans la section (réconcilié).
    const v2 = computeAllSectionTotals({ ...base, calcEngineVersion: 2 });
    expect(v2.get("sec-1")?.totalHtCents).toBe(165_000);
    // v1 : chemin historique, la section ignore le coefficient.
    const v1 = computeAllSectionTotals({ ...base, calcEngineVersion: 1 });
    expect(v1.get("sec-1")?.totalHtCents).toBe(150_000);
  });
});

// Étape 12 : le document dérive du breakdown (phase D).
describe("prepareEstimateDocumentData - dérivation du breakdown (étape 12)", () => {
  const documentItems = (items: EstimateItemRecord[]) =>
    items as unknown as EstimateItem[];

  function prepareWithRate(hourlyRateCents: number) {
    const items = [
      makeSection({ id: "sec-1", parent_id: null, position: 0 }),
      makeLine({
        id: "l1",
        parent_id: "sec-1",
        position: 1,
        h_mo: 100,
        labor_role_id: "role-a",
        // Valeur PERSISTÉE au moment du chiffrage (100 h x 45,00 EUR x 1,30).
        line_total_ht_cents: 585_000,
      }),
    ];
    return prepareEstimateDocumentData({
      items: documentItems(items),
      breakdown: buildLegacyDocumentBreakdown({
        items: documentItems(items),
        marginMultiplier: 1.3,
        discountCents: 0,
        taxRateBp: 2_000,
        isLaborSplitEnabled: false,
        laborRateById: { "role-a": hourlyRateCents },
      }),
      calcEngineVersion: DOCUMENT_CALC_ENGINE_VERSION,
      taxRateBp: 2_000,
      currency: "EUR",
      validiteJours: 30,
    });
  }

  it("T13 : le taux horaire courant ne réécrit pas une ligne déjà chiffrée", () => {
    // Ligne 100 h @ 45,00 EUR/h, marge 1,30 => line_total_ht_cents = 585 000.
    // On passe le rôle à 50,00 EUR/h SANS toucher au devis : la valeur affichée
    // doit rester celle du devis (585 000), pas le recalcul au taux courant
    // (650 000). C'est l'écart documenté de 650,00 EUR de l'export XLSX ;
    // l'assertion complète côté classeur est la phase E (étape 17).
    expect(prepareWithRate(4_500).lineSplitsById["l1"].totalHtCents).toBe(585_000);
    expect(prepareWithRate(5_000).lineSplitsById["l1"].totalHtCents).toBe(585_000);
  });

  it("les sections et les lignes proviennent du même breakdown", () => {
    const prepared = prepareWithRate(4_500);
    // La section agrège le moteur ; la ligne porte la valeur persistée. En v1 le
    // shim de compatibilité assume l'écart (le moteur historique ne redescend ni
    // coefficient ni remise) — il disparaît à la bascule v2.
    expect(prepared.sectionTotalsById["sec-1"].totalHtCents).toBe(585_000);
    expect(prepared.lineSplitsById["l1"].totalHtCents).toBe(585_000);
  });
});

describe("computeReadOnlyTotals - garde-fou calcEngineVersion (EST-E26 étape 9)", () => {
  // Version en lecture seule dont les colonnes STOCKÉES sont volontairement
  // fausses (total figé à 1 000 c) alors que les lignes valent 100 000 c avec
  // un coefficient 1,1. C'est ce qui distingue les deux moteurs :
  //  - v1 fait autorité sur le stocké  -> 1 000 c ;
  //  - v2 recalcule via le breakdown   -> 110 000 c.
  const items = [
    makeSection({ id: "sec-1", parent_id: null, position: 0 }),
    makeLine({
      id: "l1",
      parent_id: "sec-1",
      position: 1,
      unit_price_ht_cents: 100_000,
      line_total_ht_cents: 100_000,
    }),
  ];
  const version = {
    margin_multiplier: 1,
    margin_mode: "fixed" as const,
    tax_rate_bp: 2_000,
    discount_bp: 0,
    discount_mode: "simple" as const,
    discount_steps: [],
    global_coefficient: 1.1,
    total_ht_cents: 1_000,
    total_tax_cents: 200,
    total_ttc_cents: 1_200,
  };
  const base = {
    items,
    version,
    discountCents: 0,
    laborRateById: new Map<string, number>(),
    isLaborSplitEnabled: false,
    marginTiers: [],
    roundingMode: "none" as const,
    roundingStepCents: 0,
  };

  it("v1 : le pied reste dérivé des colonnes stockées (comportement inchangé)", () => {
    const totals = computeReadOnlyTotals({ ...base, calcEngineVersion: 1 });
    expect(totals.saleTotalCents).toBe(1_000);
    expect(totals.taxCents).toBe(200);
    expect(totals.roundedTtcCents).toBe(1_200);
  });

  it("v2 : le pied cesse de renvoyer les colonnes figées et dérive du breakdown", () => {
    const totals = computeReadOnlyTotals({ ...base, calcEngineVersion: 2 });
    expect(totals.saleTotalCents).toBe(110_000);
    expect(totals.saleSubtotalBeforeCoefficientCents).toBe(100_000);
    expect(totals.globalCoefficient).toBe(1.1);
  });
});

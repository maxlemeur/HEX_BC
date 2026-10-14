/**
 * Audit indépendant 2026-10-14 — tests de caractérisation du moteur de calcul.
 *
 * Exécutés contre la copie figée de l'archive (base ce5874f5 + travail non commité capturé à 13 h 19).
 * Chaque test ASSERTE LE COMPORTEMENT DU CODE (il passe quand l'écart existe) et journalise la valeur
 * attendue selon une lecture métier. Un test qui échoue signifie que le constat n'est pas reproduit.
 * Aucun appel réseau, aucune base : fonctions pures uniquement.
 */
import { describe, expect, it } from "vitest";

import { parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import {
  computeEstimateBreakdown,
  computeEstimateLineValues,
  computeEstimateTotals,
  computeInitialDiscountCents,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import { getMarginTiers, resolveMarginMultiplier } from "@/lib/estimates/margin-tiers";
import { computeTaxCents } from "@/lib/money";

const log = (label: string, value: unknown) =>
  console.log(`[AUDIT] ${label}: ${JSON.stringify(value)}`);

function line(id: string, costCents: number, quantity = 1): EstimateItemRecord {
  return {
    id,
    item_type: "line",
    parent_id: null,
    title: `Ligne ${id}`,
    description: "u",
    position: 0,
    labor_role_id: null,
    category_id: null,
    quantity,
    unit_price_ht_cents: costCents,
    tax_rate_bp: null,
    k_fo: 1,
    h_mo: 0,
    k_mo: 1,
    pu_ht_cents: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
  };
}

function totals(items: EstimateItemRecord[], margin: number, discountCents: number) {
  return computeEstimateTotals({
    lineItems: items,
    marginMultiplier: margin,
    marginMode: "fixed",
    marginTiers: [],
    discountCents,
    discountMode: "simple",
    discountStepsBp: [],
    globalCoefficient: 1,
    taxRateBp: 2000,
    roundingMode: "none",
    roundingStepCents: 0,
    isLaborSplitEnabled: false,
  });
}

/** Réplique littérale de src/hooks/useEstimateEditorState.impl.tsx:1441-1446 (copie figée). */
function bpPersistedOnSave(discountCents: number, saleSubtotalCents: number) {
  return saleSubtotalCents > 0
    ? Math.round((discountCents / saleSubtotalCents) * 10000)
    : 0;
}

function version(over: Partial<EstimateVersionForCalc>): EstimateVersionForCalc {
  return {
    margin_multiplier: 1,
    margin_mode: "fixed",
    tax_rate_bp: 2000,
    discount_bp: 0,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    ...over,
  };
}

describe("A-01 EU01 : remise saisie en euros, sauvegardée en points de base", () => {
  it("1,01 € sur une assiette de 19 954,50 € devient 2,00 € après sauvegarde et relecture", () => {
    const items = [line("a", 1_995_450)];
    const session = totals(items, 1, 101);
    expect(session.saleTotalCents).toBe(1_995_349); // ce que l'utilisateur voit avant sauvegarde

    const storedBp = bpPersistedOnSave(session.discountCents, session.saleSubtotalCents);
    expect(storedBp).toBe(1); // 0,506 pb arrondi à 1 pb

    const reloaded = computeInitialDiscountCents(
      version({ discount_bp: storedBp }),
      items,
      new Map(),
      false
    );
    expect(reloaded).toBe(200);
    const afterReload = totals(items, 1, reloaded);
    expect(afterReload.saleTotalCents).toBe(1_995_250); // = pied observé par EU01
    log("EU01", {
      saisi: 101,
      bpStocke: storedBp,
      remiseApresRelecture: reloaded,
      htAttendu: 1_995_349,
      htObtenu: afterReload.saleTotalCents,
    });
  });

  it("une remise en euros n'est représentable qu'au pas de 1/10 000 de l'assiette", () => {
    const items = [line("a", 1_995_450)];
    const representable = [50, 101, 150, 250, 299, 301].map((cents) => {
      const bp = bpPersistedOnSave(cents, 1_995_450);
      return {
        saisi: cents,
        relu: computeInitialDiscountCents(version({ discount_bp: bp }), items, new Map(), false),
      };
    });
    log("EU01 pas de représentation (assiette 19 954,50 €)", representable);
    expect(representable.find((r) => r.saisi === 50)?.relu).toBe(0); // 0,50 € disparaît
    expect(representable.find((r) => r.saisi === 299)?.relu).toBe(200); // 2,99 € saisi → 2,00 €
    expect(representable.find((r) => r.saisi === 301)?.relu).toBe(399); // 3,01 € saisi → 3,99 €
  });
});

describe("A-02 EUHIST : remise historique en % transformée en montant fixe par un changement de marge", () => {
  it("10 % historique, marge ×1 → ×2 : HT 3,80 € au lieu de 3,60 €, puis 5 % stocké", () => {
    const items = [line("a", 200)];
    const historic = version({ discount_bp: 1000, margin_multiplier: 1 });
    // L'éditeur charge la remise en CENTIMES dans son état (discount_cents).
    const loadedCents = computeInitialDiscountCents(historic, items, new Map(), false);
    expect(loadedCents).toBe(20);
    // L'utilisateur change seulement la marge ; l'état garde 20 c (montant fixe).
    const draft = totals(items, 2, loadedCents);
    expect(draft.saleSubtotalCents).toBe(400);
    expect(draft.saleTotalCents).toBe(380);
    expect(draft.taxCents).toBe(76);
    const storedBp = bpPersistedOnSave(draft.discountCents, draft.saleSubtotalCents);
    expect(storedBp).toBe(500);
    const expectedIfPercentKept = totals(items, 2, 40);
    log("EUHIST", {
      piedObtenu: [draft.saleTotalCents, draft.taxCents, draft.ttcCents],
      piedAttenduSiPourcentageConserve: [
        expectedIfPercentKept.saleTotalCents,
        expectedIfPercentKept.taxCents,
        expectedIfPercentKept.ttcCents,
      ],
      bpHistorique: 1000,
      bpStockeApresSauvegarde: storedBp,
    });
  });
});

describe("A-03 Paliers de marge appliqués au devis entier (marche d'escalier)", () => {
  const tieredSale = (costCents: number, tiers = getMarginTiers()) =>
    computeEstimateTotals({
      lineItems: [line("a", costCents)],
      marginMultiplier: 1,
      marginMode: "tiered",
      marginTiers: tiers,
      discountCents: 0,
      discountMode: "simple",
      discountStepsBp: [],
      globalCoefficient: 1,
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 0,
      isLaborSplitEnabled: false,
    }).saleTotalCents;

  it("barème par défaut : 0,01 € de coût en plus fait perdre 14 999,98 € de prix de vente", () => {
    const below = tieredSale(9_999_999);
    const above = tieredSale(10_000_000);
    expect(below).toBe(15_999_998);
    expect(above).toBe(14_500_000);
    expect(below - above).toBe(1_499_998);
    log("Paliers par défaut", { cout99999_99: below, cout100000_00: above });
  });

  it("le prix de vente reste inférieur jusqu’à un coût d’environ 110 350 €", () => {
    const below = tieredSale(9_999_999);
    let cost = 10_000_000;
    while (tieredSale(cost) < below) cost += 1_000;
    log("Coût à partir duquel le prix redevient ≥ 159 999,98 €", cost);
    expect(cost).toBeGreaterThan(11_000_000);
  });

  it("même avec la grille cible à 5 tranches du devis vierge, l'effet de seuil subsiste", () => {
    const ownerGrid = [
      { threshold_cents: 0, multiplier: 1.6, position: 0 },
      { threshold_cents: 10_000_000, multiplier: 1.55, position: 1 },
      { threshold_cents: 25_000_000, multiplier: 1.5, position: 2 },
      { threshold_cents: 50_000_000, multiplier: 1.45, position: 3 },
      { threshold_cents: 100_000_000, multiplier: 1.4, position: 4 },
    ];
    const below = tieredSale(9_999_999, ownerGrid);
    const above = tieredSale(10_000_000, ownerGrid);
    expect(below).toBeGreaterThan(above);
    log("Grille 5 tranches", { below, above, ecart: below - above });
  });

  it("un barème vide retombe silencieusement sur le barème codé en dur", () => {
    expect(resolveMarginMultiplier(5_000_000, [])).toBe(1.6);
  });
});

describe("A-04 Deux sens du mot « marge »", () => {
  it("k = 1,6 s'affiche 60 % dans le panneau (k−1) et vaut 37,5 % en taux de marque (1−1/k)", () => {
    const k = 1.6;
    const panel = Math.round((k - 1) * 100);
    const markupBp = Math.round((1 - 1 / k) * 10_000);
    expect(panel).toBe(60);
    expect(markupBp).toBe(3750);
    log("Marge", { panneauPourcent: panel, tauxDeMarqueBp: markupBp });
  });
});

describe("A-05 Arithmétique visible sur le document", () => {
  it("PU arrondi × quantité ≠ total de ligne", () => {
    const values = computeEstimateLineValues(line("a", 999, 7), {
      marginMultiplier: 1.6,
      taxRateBp: 2000,
      isLaborSplitEnabled: false,
    });
    expect(values.saleLineCents).toBe(11_189);
    expect(values.puHtCents).toBe(1_598);
    expect(values.puHtCents * 7).toBe(11_186);
    log("PU × Q", { pu: values.puHtCents, quantite: 7, puFoisQ: values.puHtCents * 7, totalLigne: values.saleLineCents });
  });
});

describe("A-06 TVA v2 par ligne sur le net : la remise peut ne pas réduire la TVA", () => {
  const run = (items: EstimateItemRecord[], discountCents: number, engine: 1 | 2) =>
    computeEstimateBreakdown({
      items,
      marginMultiplier: 1,
      marginMode: "fixed",
      marginTiers: [],
      globalCoefficient: 1,
      discountMode: "simple",
      discountCents,
      discountStepsBp: [],
      taxRateBp: 2000,
      roundingMode: "none",
      roundingStepCents: 0,
      isLaborSplitEnabled: false,
      laborRateById: new Map(),
      laborRateAtelierById: new Map(),
      laborRateChantierById: new Map(),
      calcEngineVersion: engine,
    }).totals;

  it("montants quelconques : la remise de 2,00 € réduit la TVA de 0,40 € (pas d'écart)", () => {
    const items = Array.from({ length: 1004 }, (_, i) => line(`l${i}`, 1_901 + ((i * 37) % 200)));
    const before = run(items, 0, 2);
    const after = run(items, 200, 2);
    log("TVA v2 montants quelconques", { delta: before.taxCents - after.taxCents, htFoisTaux: computeTaxCents(after.saleTotalCents, 2000), tva: after.taxCents });
    expect(before.taxCents - after.taxCents).toBe(40);
  });

  it("montants ronds (multiples de 5 c) : la remise de 2,00 € HT ne réduit pas la TVA en v2", () => {
    const items = Array.from({ length: 1004 }, (_, i) => line(`l${i}`, 1_900 + 5 * ((i * 7) % 40)));
    const v2Before = run(items, 0, 2);
    const v2After = run(items, 200, 2);
    const v1After = run(items, 200, 1);
    const taxOnTotal = computeTaxCents(v2After.saleTotalCents, 2000);
    log("TVA v2 montants ronds", {
      ht: v2After.saleTotalCents,
      tvaSansRemise: v2Before.taxCents,
      tvaAvecRemiseV2: v2After.taxCents,
      tvaAvecRemiseV1: v1After.taxCents,
      htFoisTaux: taxOnTotal,
    });
    expect(v2Before.taxCents - v2After.taxCents).toBe(0);
    expect(v2After.taxCents - taxOnTotal).toBe(40);
    expect(v1After.taxCents).toBe(taxOnTotal);
  });
});

describe("A-07 Saisie numérique française dans les champs remise et marge", () => {
  it("« 1 000 » est lu 1 ; « 1.234,56 » est lu 1,234", () => {
    expect(parseLocalizedNumberInput("1 000")).toBe(1);
    expect(parseLocalizedNumberInput("1.234,56")).toBe(1.234);
    expect(parseLocalizedNumberInput("12,5")).toBe(12.5);
  });
});

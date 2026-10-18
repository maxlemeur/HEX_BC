import { describe, expect, it } from "vitest";

import * as documentData from "@/components/estimate-document/prepare-estimate-document-data";
import type { EstimateDocumentPreparedData, EstimateItem } from "@/components/estimate-document/prepare-estimate-document-data";
import {
  computeEstimateV3Breakdown,
  EstimateV3Error,
  projectEstimateV3Snapshot,
  type EstimateV3Params,
  type EstimateV3PricingStatus,
  type StoredEstimateV3Version,
} from "@/lib/estimates/engine-v3";
import { fixtureLineId, ORACLE_LINES, oracleItems, v3Line, v3Params } from "@/lib/estimates/engine-v3/oracle.fixtures";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";

// Lot 2, sous-lot 2.7 (docs/testing/estimate-engine-v3-2.7.md §11, F27-D01 à F27-D06).
// Isolation justifiée (intégrité du document émis) : le parcours `engine-v3-emission` lit le texte
// du PDF sur S2 et S5 ; il ne peut ni énumérer chaque ligne imprimée (PT = ⌈Q × PU⌋ sur 100 %
// des lignes), ni prouver que le tableau de TVA vient du contexte figé et pas d'un recalcul, ni
// fabriquer un gel incohérent pour vérifier que le document le refuse au lieu de l'imprimer.
// La branche v3 n'existe pas encore : l'entrée v3 ci-dessous recopie le contrat attendu et passe
// par une variable typée, pour que le build de production (qui vérifie aussi les tests) reste
// vert et que le rouge porte sur la branche absente.

type DocumentV3Line = {
  unitCode: string | null;
  /** Symbole du référentiel d'unités (`units.json`), nul sans unité. */
  unitLabel: string | null;
  pricingStatus: EstimateV3PricingStatus;
  taxRateBp: number;
  /** PU brut publié (`pu_ht_cents`), nul si la ligne n'est pas chiffrée. */
  unitSaleHtCents: number | null;
  /** Brut de ligne (`snapshot_gross_ht_cents`) = ⌈Q × PU⌋. */
  saleHtCents: number;
  foSaleHtCents: number;
  moSaleHtCents: number;
};
type DocumentV3Totals = {
  grossHtCents: number;
  discount: { kind: "none" | "amount" | "rate"; rateBp: number | null; appliedCents: number };
  commercialRoundingCents: number;
  netHtCents: number;
  taxByRate: Array<{ rateBp: number; baseHtCents: number; taxCents: number }>;
  taxCents: number;
  payableTtcCents: number;
  reverseCharge: boolean;
};
type PrepareV3Input = {
  calcEngineVersion: 3;
  items: EstimateItem[];
  version: StoredEstimateV3Version & { discount_bp: number; discount_amount_cents: number | null; tax_rate_bp: number };
  currency: string;
  validiteJours: number;
  portalUrl?: string | null;
  maxVisibleSectionLevel?: number | null;
  layout?: EstimatePdfLayoutOptions;
};
type PreparedV3 = EstimateDocumentPreparedData & {
  v3: { linesById: Record<string, DocumentV3Line>; totals: DocumentV3Totals };
};
const prepareV3 = documentData.prepareEstimateDocumentData as unknown as (input: PrepareV3Input) => PreparedV3;

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ROLE_ID = "88888888-8888-4888-8888-888888888888";
const SECTION = {
  a: "a0000000-0000-4000-8000-00000000000a",
  b: "b0000000-0000-4000-8000-00000000000b",
  b1: "b1000000-0000-4000-8000-0000000000b1",
};
const UNIT_CODES = ["ml", "u", "m2", "ml", "u", "ml", "ml"];
/** Arbre : A ⊃ O1, O2, O3, O8 (pour mémoire) ; B ⊃ B1 ⊃ O4, O5 ; B ⊃ O6 ; O7 à la racine. */
const PLACEMENT: Record<number, [string | null, number]> = {
  1: [SECTION.a, 0], 2: [SECTION.a, 1], 3: [SECTION.a, 2], 8: [SECTION.a, 3],
  4: [SECTION.b1, 0], 5: [SECTION.b1, 1], 6: [SECTION.b, 1], 7: [null, 2],
};
const O8 = fixtureLineId(8);

function row(overrides: Partial<EstimateItem>): EstimateItem {
  return {
    id: fixtureLineId(1), created_at: "2026-10-17T08:00:00.000Z", updated_at: "2026-10-17T08:00:00.000Z",
    tenant_id: TENANT_ID, version_id: VERSION_ID, parent_id: null, item_type: "line", line_nature: "supply_and_labor",
    position: 0, title: "Ligne", description: null, quantity: null, unit_price_ht_cents: null, tax_rate_bp: 2000,
    k_fo: 1, h_mo: null, h_mo_majoration: 1, k_mo: 1, h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
    h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null, pu_ht_cents: null, labor_role_id: null,
    category_id: null, supply_type_id: null, selected_supplier_price_id: null, source_provider: null, source_job_id: null,
    source_file_name: null, source_page: null, source_metadata: {}, snapshot_pu_ht_cents: null, snapshot_fo_ht_cents: null,
    snapshot_mo_ht_cents: null, snapshot_mo_atelier_ht_cents: null, snapshot_mo_chantier_ht_cents: null,
    line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null, unit_code: null, pricing_status: "priced",
    h_mo_per_unit: null, h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null, snapshot_gross_ht_cents: null,
    snapshot_gross_fo_ht_cents: null,
    ...overrides,
  };
}

/** Une v3 figée par le moteur pur (§5.1, §5.2), avec une ligne « pour mémoire » à 5,5 %. */
function frozen(params: Partial<EstimateV3Params>, taxRateBpByRef: Parameters<typeof oracleItems>[0] = {}, reverseCharge = false) {
  const oracle = oracleItems(taxRateBpByRef).map((item, index) => ({ ...item, unit_code: UNIT_CODES[index] }));
  const forMemory = v3Line(8, { unit_price_ht_cents: 50_000, pricing_status: "for_memory", tax_rate_bp: 550 });
  const resolvedParams = v3Params({ sale_coefficient_fo: "1.30", sale_coefficient_mo: "1.20", reverse_charge: reverseCharge, ...params });
  const breakdown = computeEstimateV3Breakdown({ params: resolvedParams, items: [...oracle, forMemory] });
  const projection = projectEstimateV3Snapshot(breakdown);
  const sections = [
    row({ id: SECTION.a, item_type: "section", line_nature: null, position: 0, title: "ARMY réseaux", tax_rate_bp: null }),
    row({ id: SECTION.b, item_type: "section", line_nature: null, position: 1, title: "ARMY sanitaires", tax_rate_bp: null }),
    row({ id: SECTION.b1, item_type: "section", line_nature: null, parent_id: SECTION.b, position: 0, title: "ARMY sous-lot", tax_rate_bp: null }),
  ];
  const lines = [...oracle, forMemory].map((input, index) => {
    const snapshot = projection.items[index];
    const line = breakdown.lines[index];
    const n = index < 7 ? index + 1 : 8;
    const [parentId, position] = PLACEMENT[n];
    return row({
      id: input.id, parent_id: parentId, position, title: n === 8 ? "ARMY pour mémoire" : `ARMY ${ORACLE_LINES[index].ref}`,
      quantity: Number(input.quantity), unit_price_ht_cents: Number(input.unit_price_ht_cents),
      h_mo_per_unit: input.h_mo_per_unit === null ? null : Number(input.h_mo_per_unit), labor_role_id: n === 8 ? null : ROLE_ID,
      h_mo: snapshot.h_mo === null ? null : Number(snapshot.h_mo), unit_code: input.unit_code, pricing_status: line.pricing_status,
      tax_rate_bp: line.tax_rate_bp, pu_ht_cents: snapshot.pu_ht_cents, snapshot_pu_ht_cents: snapshot.snapshot_pu_ht_cents,
      snapshot_gross_ht_cents: snapshot.snapshot_gross_ht_cents, snapshot_gross_fo_ht_cents: snapshot.snapshot_gross_fo_ht_cents,
      line_total_ht_cents: snapshot.line_total_ht_cents, line_tax_cents: snapshot.line_tax_cents,
      line_total_ttc_cents: snapshot.line_total_ttc_cents, snapshot_fo_ht_cents: snapshot.snapshot_fo_ht_cents,
      snapshot_mo_ht_cents: snapshot.snapshot_mo_ht_cents, snapshot_mo_atelier_ht_cents: snapshot.snapshot_mo_atelier_ht_cents,
      snapshot_mo_chantier_ht_cents: snapshot.snapshot_mo_chantier_ht_cents,
    });
  });
  const input: PrepareV3Input = {
    calcEngineVersion: 3,
    items: [...sections, ...lines],
    version: {
      contractor_role: reverseCharge ? "subcontractor" : "principal",
      gross_ht_cents: projection.version.gross_ht_cents, discount_applied_cents: projection.version.discount_applied_cents,
      commercial_rounding_cents: projection.version.commercial_rounding_cents, total_ht_cents: projection.version.total_ht_cents,
      total_tax_cents: projection.version.total_tax_cents, total_ttc_cents: projection.version.total_ttc_cents,
      rounding_adjustment_cents: 0, calc_snapshot_context: structuredClone(projection.context),
      discount_bp: projection.version.discount_bp, discount_amount_cents: projection.version.discount_amount_cents, tax_rate_bp: 2000,
    },
    currency: "EUR",
    validiteJours: 30,
  };
  return { input, projection };
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
}
/** ⌈Q × PU⌋ en décimal exact (Q a au plus 3 décimales). */
function grossOf(quantity: number, unitSaleHtCents: number): number {
  const [whole, fraction = ""] = String(quantity).split(".");
  const thousandths = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  return Number(halfUp(thousandths * BigInt(unitSaleHtCents), BigInt(1000)));
}
function thrown(run: () => unknown): unknown {
  try { run(); } catch (error) { return error; }
  return undefined;
}
const S5_RATES = { O1: 1000, O2: 1000, O3: 1000 };

describe("prepareEstimateDocumentData, branche v3 (sous-lot 2.7, D7, D8, D14)", () => {
  it("F27-D01 chaque ligne imprimée vérifie PT = ⌈Q × PU⌋, sur le brut figé (O1, O4 : valeurs du parcours)", () => {
    const { input } = frozen({ discount_amount_cents: 101 });
    const prepared = prepareV3(input);
    const priced = input.items.filter((item) => item.item_type === "line" && item.pricing_status === "priced");
    expect(priced).toHaveLength(7);
    for (const item of priced) {
      const line = prepared.v3.linesById[item.id];
      expect(line.unitSaleHtCents).toBe(item.pu_ht_cents);
      expect(line.saleHtCents).toBe(item.snapshot_gross_ht_cents);
      expect(line.saleHtCents).toBe(grossOf(item.quantity!, line.unitSaleHtCents!));
      expect(prepared.lineUnitPriceHtById[item.id]).toBe(line.unitSaleHtCents);
      expect(prepared.lineSplitsById[item.id]).toEqual({
        foTotalCents: line.foSaleHtCents, moTotalCents: line.moSaleHtCents, totalHtCents: line.saleHtCents,
      });
      expect(line.foSaleHtCents).toBe(item.snapshot_gross_fo_ht_cents);
      expect(line.foSaleHtCents + line.moSaleHtCents).toBe(line.saleHtCents);
    }
    expect(prepared.v3.linesById[fixtureLineId(1)]).toEqual({
      unitCode: "ml", unitLabel: "ml", pricingStatus: "priced", taxRateBp: 2000, unitSaleHtCents: 16_663,
      saleHtCents: 333_260, foSaleHtCents: 142_119, moSaleHtCents: 191_141,
    });
    expect(prepared.v3.linesById[fixtureLineId(4)]).toMatchObject({ unitLabel: "ml", unitSaleHtCents: 1353, saleHtCents: 1_541_067 });
  });

  it("F27-D02 unité et statut : symbole du référentiel ; ligne non chiffrée à 0, sans PU", () => {
    const { input } = frozen({ discount_amount_cents: 101 });
    const prepared = prepareV3(input);
    const symbol = (code: string) => MEASUREMENT_UNITS.find((unit) => unit.code === code)!.symbol;
    expect(prepared.v3.linesById[fixtureLineId(3)]).toMatchObject({ unitCode: "m2", unitLabel: symbol("m2") });
    expect(symbol("m2")).toBe("m²");
    expect(prepared.v3.linesById[O8]).toEqual({
      unitCode: null, unitLabel: null, pricingStatus: "for_memory", taxRateBp: 550, unitSaleHtCents: null,
      saleHtCents: 0, foSaleHtCents: 0, moSaleHtCents: 0,
    });
    expect(prepared.lineSplitsById[O8]).toEqual({ foTotalCents: 0, moTotalCents: 0, totalHtCents: 0 });
  });

  it("F27-D03 Σ sous-totaux de premier niveau + lignes racine = HT brut ; sections imbriquées en brut", () => {
    const { input } = frozen({ discount_amount_cents: 101 });
    const prepared = prepareV3(input);
    const totals = prepared.sectionTotalsById;
    expect(totals[SECTION.a]).toMatchObject({ totalHtCents: 555_461, foTotalCents: 339_120, moTotalCents: 216_341 });
    expect(totals[SECTION.b1]).toMatchObject({ totalHtCents: 1_572_467, foTotalCents: 449_904, moTotalCents: 1_122_563 });
    expect(totals[SECTION.b]).toMatchObject({ totalHtCents: 6_290_891, foTotalCents: 3_817_451, moTotalCents: 2_473_440 });
    const rootLine = prepared.lineSplitsById[fixtureLineId(7)].totalHtCents;
    expect(rootLine).toBe(59_104);
    expect(totals[SECTION.a].totalHtCents + totals[SECTION.b].totalHtCents + rootLine).toBe(6_905_456);
    expect(prepared.v3.totals.grossHtCents).toBe(6_905_456);
  });

  it("F27-D04 pied S2 : ligne de remise, HT net, TVA 20 % du contexte figé, TTC", () => {
    const { input, projection } = frozen({ discount_amount_cents: 101 });
    const prepared = prepareV3(input);
    expect(prepared.v3.totals).toEqual({
      grossHtCents: 6_905_456, discount: { kind: "amount", rateBp: null, appliedCents: 101 }, commercialRoundingCents: 0,
      netHtCents: 6_905_355, taxByRate: [{ rateBp: 2000, baseHtCents: 6_905_355, taxCents: 1_381_071 }],
      taxCents: 1_381_071, payableTtcCents: 8_286_426, reverseCharge: false,
    });
    expect(prepared.v3.totals.taxByRate).toEqual(projection.context.tax_breakdown.map((entry) => ({
      rateBp: entry.rate_bp, baseHtCents: entry.base_cents, taxCents: entry.tax_cents,
    })));
    expect(prepared.taxEnabled).toBe(true);
    expect(prepared.vatReverseCharge).toBe(false);
  });

  it("F27-D04 pied S5 : un récapitulatif par taux (10 % puis 20 %), TTC 82 308,80 €", () => {
    const { input } = frozen({ discount_amount_cents: 101 }, S5_RATES);
    const prepared = prepareV3(input);
    expect(prepared.v3.totals.taxByRate).toEqual([
      { rateBp: 1000, baseHtCents: 555_453, taxCents: 55_545 },
      { rateBp: 2000, baseHtCents: 6_349_902, taxCents: 1_269_980 },
    ]);
    expect(prepared.v3.totals).toMatchObject({ netHtCents: 6_905_355, taxCents: 1_325_525, payableTtcCents: 8_230_880 });
    expect(prepared.v3.linesById[O8].taxRateBp).toBe(550);
  });

  it.each([
    ["S1 sans remise", {}, { kind: "none", rateBp: null, appliedCents: 0 }, 0, 6_905_456],
    ["S3 remise de 10 %", { discount_bp: 1000 }, { kind: "rate", rateBp: 1000, appliedCents: 690_546 }, 0, 6_214_910],
    ["S4 arrondi au pas de 100 € inférieur", { discount_amount_cents: 101, rounding_mode: "down", rounding_step_cents: 10_000 },
      { kind: "amount", rateBp: null, appliedCents: 101 }, 5355, 6_900_000],
  ] as const)("F27-D05 %s : intention de remise et arrondi commercial lus sur le gel", (_name, params, discount, rounding, net) => {
    const prepared = prepareV3(frozen(params as Partial<EstimateV3Params>).input);
    expect(prepared.v3.totals.discount).toEqual(discount);
    expect(prepared.v3.totals.commercialRoundingCents).toBe(rounding);
    expect(prepared.v3.totals.netHtCents).toBe(net);
    expect(prepared.v3.totals.grossHtCents - discount.appliedCents - rounding).toBe(net);
  });

  it("F27-D05 autoliquidation : TVA nulle par taux, aucun taux affiché", () => {
    const prepared = prepareV3(frozen({ discount_amount_cents: 101 }, {}, true).input);
    expect(prepared.v3.totals).toMatchObject({
      reverseCharge: true, taxCents: 0, payableTtcCents: 6_905_355,
      taxByRate: [{ rateBp: 2000, baseHtCents: 6_905_355, taxCents: 0 }],
    });
    expect(prepared.taxEnabled).toBe(false);
    expect(prepared.vatReverseCharge).toBe(true);
  });

  it("F27-D06 refuse d'imprimer un gel incohérent au lieu de le recalculer ou de le réparer", () => {
    const expectIncoherent = (mutate: (input: PrepareV3Input) => void) => {
      const { input } = frozen({ discount_amount_cents: 101 });
      mutate(input);
      const error = thrown(() => prepareV3(input));
      expect(error).toBeInstanceOf(EstimateV3Error);
      expect(error).toMatchObject({ code: "ESTIMATE_V3_STORED_INCOHERENT" });
    };
    const line = (input: PrepareV3Input, n: number) => input.items.find((item) => item.id === fixtureLineId(n))!;
    // TVA du contexte décalée d'1 c : le tableau imprimé ne doit pas différer du gel validé.
    expectIncoherent((input) => {
      const context = input.version.calc_snapshot_context as { tax_breakdown: Array<{ tax_cents: number }> };
      context.tax_breakdown[0].tax_cents += 1;
    });
    // PU publié décalé d'1 c, brut inchangé : PT ≠ ⌈Q × PU⌋ sur une ligne imprimée.
    expectIncoherent((input) => {
      const o1 = line(input, 1);
      o1.pu_ht_cents! += 1; o1.snapshot_pu_ht_cents! += 1;
    });
    // Contexte v3 absent.
    expectIncoherent((input) => { input.version.calc_snapshot_context = null; });
    // Brut de ligne décalé d'1 c avec le brut de version : Σ cohérente, PT faux.
    expectIncoherent((input) => {
      const o4 = line(input, 4);
      o4.snapshot_gross_ht_cents! += 1; o4.snapshot_gross_fo_ht_cents! += 1;
      input.version.gross_ht_cents! += 1; input.version.discount_applied_cents! += 1;
    });
  });
});

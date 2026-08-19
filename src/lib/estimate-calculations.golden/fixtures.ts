// Shared factories and fixtures for estimate-calculations golden regimes.
// Numeric outcomes are asserted in sibling *.test.ts files.

import {
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import { type MarginTier } from "@/lib/estimates/margin-tiers";
import {
  prepareEstimateDocumentData,
} from "@/components/estimate-document/prepare-estimate-document-data";

/* ---------------------------------------------------------------------------
 * Fabriques
 * ------------------------------------------------------------------------- */

export const LABOR_RATES = new Map<string, number>([
  ["role-mo", 4_500], // 45,00 EUR/h - voie legacy (labor_role_id)
  ["role-atelier", 3_800],
  ["role-chantier", 5_200],
]);

export const LABOR_RATES_RECORD: Record<string, number> =
  Object.fromEntries(LABOR_RATES);

export function makeLine(overrides: Partial<EstimateItemRecord> = {}): EstimateItemRecord {
  return {
    id: "line-1",
    item_type: "line",
    parent_id: "sec-1",
    title: "Ligne",
    description: null,
    position: 0,
    labor_role_id: "role-mo",
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
    labor_role_hourly_rate_cents: 4_500,
    labor_role_atelier_hourly_rate_cents: 3_800,
    labor_role_chantier_hourly_rate_cents: 5_200,
    pu_ht_cents: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    ...overrides,
  };
}

export function makeSection(o: Partial<EstimateItemRecord> = {}): EstimateItemRecord {
  return makeLine({
    id: "sec-1",
    item_type: "section",
    parent_id: null,
    title: "Lot",
    ...o,
  });
}

export function makeVersion(
  overrides: Partial<EstimateVersionForCalc> = {}
): EstimateVersionForCalc {
  return {
    margin_multiplier: 1.6,
    margin_mode: "fixed",
    tax_rate_bp: 2_000,
    discount_bp: 0,
    discount_mode: "simple",
    discount_steps: null,
    global_coefficient: 1,
    status: "draft",
    total_ht_cents: null,
    total_tax_cents: null,
    total_ttc_cents: null,
    ...overrides,
  };
}

// Le type d'entree de prepareEstimateDocumentData n'est pas exporte
// (prepare-estimate-document-data.ts:31).
export type PrepareInput = Parameters<typeof prepareEstimateDocumentData>[0];

// Layout explicite : sans lui le golden dependrait de
// DEFAULT_ESTIMATE_PDF_LAYOUT (pdf-layout.ts:82) et casserait au moindre
// changement de preset.
export const GOLDEN_LAYOUT: NonNullable<PrepareInput["layout"]> = {
  preset: "client_detailed",
  detailLevel: "lines",
  priceMode: "unit_and_total",
  density: "standard",
  showNumbering: true,
  showSectionSubtotals: true,
  conditionsPlacement: "auto",
  includeTerms: false,
};

/**
 * prepareEstimateDocumentData attend
 * Database["public"]["Tables"]["estimate_items"]["Row"][], pas
 * EstimateItemRecord[]. La fonction ne lit que le sous-ensemble commun
 * (id / item_type / parent_id / position / title / description /
 * supply_type_id / line_total_ht_cents + les champs de calcul), d'ou le cast.
 */
export function asDocumentItems(items: EstimateItemRecord[]): PrepareInput["items"] {
  return items as unknown as PrepareInput["items"];
}

export function summarizeRows(rows: { item: { id: string }; depth: number }[]) {
  return rows.map(({ item, depth }) => `${item.id}@${depth}`);
}

/* ---------------------------------------------------------------------------
 * Fixture A - base : coefficient 1, marge fixe, remise absolue, split OFF
 * ------------------------------------------------------------------------- */

export const FIXTURE_A_ITEMS: EstimateItemRecord[] = [
  makeSection({ id: "sec-1", position: 0 }),
  makeLine({
    id: "l1",
    parent_id: "sec-1",
    position: 0,
    quantity: 3,
    unit_price_ht_cents: 12_500,
    k_fo: 1.1,
    h_mo: 2,
    k_mo: 1,
    h_mo_majoration: 1,
    labor_role_id: "role-mo",
  }),
  makeLine({
    id: "l2",
    parent_id: "sec-1",
    position: 1,
    quantity: 1,
    unit_price_ht_cents: 9_999,
    k_fo: 1,
    h_mo: 0.75,
    k_mo: 1.2,
    labor_role_id: "role-mo",
  }),
];

export const FIXTURE_A_ENGINE = {
  marginMultiplier: 1.6,
  marginMode: "fixed" as const,
  marginTiers: [] as MarginTier[],
  globalCoefficient: 1,
  discountCents: 5_000,
  taxRateBp: 2_000,
  roundingMode: "none" as const,
  roundingStepCents: 0,
};

export const FIXTURE_B_ENGINE = { ...FIXTURE_A_ENGINE, globalCoefficient: 1.1 };

export const FIXTURE_E_ITEMS: EstimateItemRecord[] = [
  makeSection({ id: "sec-1", position: 0 }),
  makeLine({
    id: "b1",
    parent_id: "sec-1",
    position: 0,
    quantity: 1,
    unit_price_ht_cents: 6_000_000,
    k_fo: 1,
    h_mo: 0,
  }),
  makeLine({
    id: "b2",
    parent_id: "sec-1",
    position: 1,
    quantity: 1,
    unit_price_ht_cents: 4_500_000,
    k_fo: 1,
    h_mo: 0,
  }),
];

export const TENANT_MARGIN_TIERS: MarginTier[] = [
  { threshold_cents: 0, multiplier: 1.25, position: 0 },
  { threshold_cents: 5_000_000, multiplier: 1.35, position: 1 },
];

export const FIXTURE_F_ITEMS: EstimateItemRecord[] = [
  makeSection({ id: "sec-1", position: 0 }),
  makeLine({
    id: "s1",
    parent_id: "sec-1",
    position: 0,
    quantity: 2,
    unit_price_ht_cents: 3_000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    h_mo_atelier: 4,
    k_mo_atelier: 1,
    labor_role_atelier_id: "role-atelier",
    h_mo_chantier: 6,
    k_mo_chantier: 1.2,
    labor_role_chantier_id: "role-chantier",
  }),
];

export const FIXTURE_F_ENGINE = {
  marginMultiplier: 1.6,
  marginMode: "fixed" as const,
  marginTiers: [] as MarginTier[],
  globalCoefficient: 1,
  discountCents: 0,
  taxRateBp: 2_000,
  roundingMode: "none" as const,
  roundingStepCents: 0,
};

export const FIXTURE_G_ITEM = makeLine({
  id: "g1",
  parent_id: "sec-1",
  position: 0,
  quantity: 1,
  unit_price_ht_cents: 5_000,
  h_mo: 3,
  k_mo: 1,
  labor_role_id: "role-mo",
  labor_role_atelier_id: "", // chaine vide : ni null ni undefined
  h_mo_atelier: null,
  k_mo_atelier: 0,
});

export const FIXTURE_H_ITEMS: EstimateItemRecord[] = [
  makeSection({ id: "sec-1", position: 0 }),
  makeSection({ id: "sec-2", position: 1, title: "Lot 2" }),
  makeLine({
    id: "h1",
    parent_id: "sec-1",
    position: 0,
    quantity: 2,
    unit_price_ht_cents: 10_000,
    k_fo: 1,
    h_mo: 0,
    tax_rate_bp: 2_000,
    line_total_ht_cents: 31_000, // stocke != 32 000 recalcule
  }),
  makeLine({
    id: "h2",
    parent_id: "sec-2",
    position: 0,
    quantity: 1,
    unit_price_ht_cents: 20_000,
    k_fo: 1,
    h_mo: 0,
    tax_rate_bp: 1_000,
  }),
  makeLine({
    id: "h3",
    parent_id: null, // ligne racine, hors de toute section
    position: 2,
    quantity: 1,
    unit_price_ht_cents: 50_000,
    k_fo: 1,
    h_mo: 0,
    tax_rate_bp: 550,
  }),
];

export const FIXTURE_H_ENGINE = {
  marginMultiplier: 1.6,
  marginMode: "fixed" as const,
  marginTiers: [] as MarginTier[],
  globalCoefficient: 1,
  discountCents: 10_000,
  taxRateBp: 2_000,
  roundingMode: "none" as const,
  roundingStepCents: 0,
};

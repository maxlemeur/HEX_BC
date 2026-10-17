/**
 * Lot 2, sous-lot 2.4 - projection d'un calcul v3 vers les colonnes figées et le contexte
 * (conception D5 à D8, §6.2, §6.5). Pure : l'écriture (gel v3) arrive en 2.5.
 *
 * Les colonnes historiques gardent leur sens (D7) : `line_total_ht_cents`, `line_tax_cents`,
 * `line_total_ttc_cents` et `snapshot_fo/mo*` sont nettes, Σ lignes = `total_ht_cents`. Le brut
 * publié est figé à part (`snapshot_gross_ht_cents`, `snapshot_gross_fo_ht_cents`) ; `pu_ht_cents`
 * et `snapshot_pu_ht_cents` portent le PU publié (brut en v3). L'intention de remise est rendue
 * telle quelle : la v3 ne dérive jamais un taux d'un montant (D6).
 */
import type {
  EstimateV3Breakdown,
  EstimateV3CommercialRoundingSummary,
  EstimateV3DiscountSummary,
  EstimateV3TaxBreakdownRow,
} from "@/lib/estimates/engine-v3/types";

export type EstimateV3SnapshotItem = {
  id: string;
  pu_ht_cents: number | null;
  snapshot_pu_ht_cents: number | null;
  snapshot_gross_ht_cents: number;
  snapshot_gross_fo_ht_cents: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
  snapshot_fo_ht_cents: number;
  snapshot_mo_ht_cents: number;
  snapshot_mo_atelier_ht_cents: number;
  snapshot_mo_chantier_ht_cents: number;
  h_mo: string | null;
  h_mo_atelier: string | null;
  h_mo_chantier: string | null;
};

export type EstimateV3SnapshotVersion = {
  sale_coefficient_fo: string;
  sale_coefficient_mo: string;
  discount_amount_cents: number | null;
  discount_bp: number;
  gross_ht_cents: number;
  discount_applied_cents: number;
  commercial_rounding_cents: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  rounding_adjustment_cents: 0;
};

/** Contexte figé v3 (`calc_snapshot_context`, §6.5) : ni barème ni multiplicateur de marge. */
export type EstimateV3SnapshotContext = {
  engine: 3;
  labor_split_enabled: boolean;
  labor_roles: unknown[];
  sale_coefficients: { fo: number; mo: number };
  discount: EstimateV3DiscountSummary;
  commercial_rounding: EstimateV3CommercialRoundingSummary;
  cost_subtotal_cents: number;
  realized_sale_coefficient: number | null;
  tax_breakdown: EstimateV3TaxBreakdownRow[];
};

export type EstimateV3SnapshotProjection = {
  items: EstimateV3SnapshotItem[];
  version: EstimateV3SnapshotVersion;
  context: EstimateV3SnapshotContext;
};

export function projectEstimateV3Snapshot(
  breakdown: EstimateV3Breakdown,
  options: { laborRoles?: unknown[] } = {}
): EstimateV3SnapshotProjection {
  const { params, totals } = breakdown;
  return {
    items: breakdown.lines.map((line) => ({
      id: line.id,
      pu_ht_cents: line.pu_ht_cents,
      snapshot_pu_ht_cents: line.pu_ht_cents,
      snapshot_gross_ht_cents: line.gross_ht_cents,
      snapshot_gross_fo_ht_cents: line.gross_fo_ht_cents,
      line_total_ht_cents: line.line_total_ht_cents,
      line_tax_cents: line.line_tax_cents,
      line_total_ttc_cents: line.line_total_ttc_cents,
      snapshot_fo_ht_cents: line.snapshot_fo_ht_cents,
      snapshot_mo_ht_cents: line.snapshot_mo_ht_cents,
      snapshot_mo_atelier_ht_cents: line.snapshot_mo_atelier_ht_cents,
      snapshot_mo_chantier_ht_cents: line.snapshot_mo_chantier_ht_cents,
      h_mo: line.h_mo,
      h_mo_atelier: line.h_mo_atelier,
      h_mo_chantier: line.h_mo_chantier,
    })),
    version: {
      sale_coefficient_fo: params.sale_coefficient_fo,
      sale_coefficient_mo: params.sale_coefficient_mo,
      discount_amount_cents: params.discount_amount_cents,
      discount_bp: params.discount_bp,
      gross_ht_cents: totals.gross_ht_cents,
      discount_applied_cents: totals.discount_applied_cents,
      commercial_rounding_cents: totals.commercial_rounding_cents,
      total_ht_cents: totals.total_ht_cents,
      total_tax_cents: totals.total_tax_cents,
      total_ttc_cents: totals.total_ttc_cents,
      rounding_adjustment_cents: 0,
    },
    context: {
      engine: 3,
      labor_split_enabled: params.labor_split_enabled,
      labor_roles: options.laborRoles ?? [],
      sale_coefficients: {
        fo: Number(params.sale_coefficient_fo),
        mo: Number(params.sale_coefficient_mo),
      },
      discount: { ...breakdown.discount },
      commercial_rounding: { ...breakdown.commercial_rounding },
      cost_subtotal_cents: totals.cost_subtotal_cents,
      realized_sale_coefficient:
        totals.realized_sale_coefficient === null ? null : Number(totals.realized_sale_coefficient),
      tax_breakdown: totals.tax_breakdown.map((row) => ({ ...row })),
    },
  };
}

/**
 * Marque nette v3 en points de base : ⌈(N − Σ D) × 10 000 / N⌋ (demi vers +∞), nulle si N = 0
 * (indéterminée, jamais 0 : F20). La règle `min_margin` qui la consomme arrive en 2.5.
 */
export function computeEstimateV3NetMarginBp(totals: {
  total_ht_cents: number;
  cost_subtotal_cents: number;
}): number | null {
  const net = BigInt(totals.total_ht_cents);
  if (net === BigInt(0)) return null;
  const numerator = BigInt(2) * (net - BigInt(totals.cost_subtotal_cents)) * BigInt(10000) + net;
  const denominator = BigInt(2) * net;
  // Division entière vers −∞ (BigInt tronque vers 0).
  let quotient = numerator / denominator;
  if (numerator % denominator !== BigInt(0) && numerator < BigInt(0)) quotient -= BigInt(1);
  return Number(quotient);
}

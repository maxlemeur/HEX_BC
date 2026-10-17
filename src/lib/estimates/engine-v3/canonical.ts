/**
 * Lot 2, sous-lot 2.4 - adaptateur JSON canonique du moteur v3 (parité TS/SQL, conception D12).
 *
 * Entrée : `{ params, items }` (objet ou texte JSON) ; sortie : `{ lines, totals }`, clés dans
 * l'ordre du contrat, entiers en nombres JSON, décimaux (`h_mo*`, coefficient réalisé) en
 * chaînes à échelle fixe, lignes dans l'ordre d'entrée, sections omises. Même forme que
 * `private.estimate_v3_compute_items(jsonb, jsonb)` du jumeau SQL.
 */
import { computeEstimateV3BreakdownFromUnknown } from "@/lib/estimates/engine-v3/breakdown";
import { invalidInput } from "@/lib/estimates/engine-v3/errors";
import type { EstimateV3CanonicalOutput } from "@/lib/estimates/engine-v3/types";

export function computeEstimateV3Canonical(input: unknown): EstimateV3CanonicalOutput {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input) as unknown;
    } catch {
      throw invalidInput("input", "JSON illisible");
    }
  }
  const breakdown = computeEstimateV3BreakdownFromUnknown(raw);
  return {
    lines: breakdown.lines.map((line) => ({
      id: line.id,
      pu_ht_cents: line.pu_ht_cents,
      gross_ht_cents: line.gross_ht_cents,
      gross_fo_ht_cents: line.gross_fo_ht_cents,
      gross_mo_ht_cents: line.gross_mo_ht_cents,
      gross_mo_atelier_ht_cents: line.gross_mo_atelier_ht_cents,
      gross_mo_chantier_ht_cents: line.gross_mo_chantier_ht_cents,
      cost_ht_cents: line.cost_ht_cents,
      reduction_cents: line.reduction_cents,
      line_total_ht_cents: line.line_total_ht_cents,
      snapshot_fo_ht_cents: line.snapshot_fo_ht_cents,
      snapshot_mo_ht_cents: line.snapshot_mo_ht_cents,
      snapshot_mo_atelier_ht_cents: line.snapshot_mo_atelier_ht_cents,
      snapshot_mo_chantier_ht_cents: line.snapshot_mo_chantier_ht_cents,
      line_tax_cents: line.line_tax_cents,
      line_total_ttc_cents: line.line_total_ttc_cents,
      h_mo: line.h_mo,
      h_mo_atelier: line.h_mo_atelier,
      h_mo_chantier: line.h_mo_chantier,
    })),
    totals: {
      gross_ht_cents: breakdown.totals.gross_ht_cents,
      discount_applied_cents: breakdown.totals.discount_applied_cents,
      commercial_rounding_cents: breakdown.totals.commercial_rounding_cents,
      total_ht_cents: breakdown.totals.total_ht_cents,
      total_tax_cents: breakdown.totals.total_tax_cents,
      total_ttc_cents: breakdown.totals.total_ttc_cents,
      rounding_adjustment_cents: breakdown.totals.rounding_adjustment_cents,
      cost_subtotal_cents: breakdown.totals.cost_subtotal_cents,
      realized_sale_coefficient: breakdown.totals.realized_sale_coefficient,
      tax_breakdown: breakdown.totals.tax_breakdown.map((row) => ({
        rate_bp: row.rate_bp,
        base_cents: row.base_cents,
        tax_cents: row.tax_cents,
      })),
    },
  };
}

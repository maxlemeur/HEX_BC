import { z } from "zod";

import { estimateLinePricingStatusSchema } from "@/lib/estimates/v3-schemas";

/**
 * Lot 2, sous-lot 2.5 - champs de réponse du moteur 3 (conception §6.2, §6.5). Les colonnes v3
 * sont nulles sur une v1/v2 ; PostgREST peut rendre un `numeric` en nombre.
 */
const nullableNumber = z.number().nullable().optional();
const nullableCents = z.number().int().nullable().optional();

export const estimateVersionV3ResponseFields = {
  sale_coefficient_fo: nullableNumber.describe("Moteur 3 : coefficient de vente fourniture ; nul en v1/v2."),
  sale_coefficient_mo: nullableNumber.describe("Moteur 3 : coefficient de vente main-d'oeuvre ; nul en v1/v2."),
  gross_ht_cents: nullableCents.describe("Moteur 3 : HT brut G = Σ Q × PU ; nul en v1/v2."),
  discount_applied_cents: nullableCents.describe("Moteur 3 : remise appliquée R ; nulle en v1/v2."),
  commercial_rounding_cents: nullableCents.describe("Moteur 3 : arrondi commercial A (remise HT) ; nul en v1/v2."),
  rounding_adjustment_cents: nullableCents,
  content_revision: z.number().int().optional(),
  calc_snapshot_content_revision: nullableCents,
  calc_snapshot_context: z.unknown().optional().describe(
    "Contexte de calcul figé. Moteur 3 : engine, labor_split_enabled, labor_roles, sale_coefficients, discount, commercial_rounding, cost_subtotal_cents, realized_sale_coefficient, tax_breakdown."
  ),
  approval_status: z.string().optional(),
  contractor_role: z.string().optional(),
} as const;

export const estimateItemV3ResponseFields = {
  unit_code: z.string().nullable().optional().describe("Moteur 3 : code d'unité du référentiel ; nul en v1/v2."),
  pricing_status: estimateLinePricingStatusSchema.optional(),
  h_mo_per_unit: nullableNumber.describe("Moteur 3 : heures par unité ; h_mo en est le total dérivé."),
  h_mo_atelier_per_unit: nullableNumber,
  h_mo_chantier_per_unit: nullableNumber,
  snapshot_pu_ht_cents: nullableCents,
  snapshot_gross_ht_cents: nullableCents.describe("Moteur 3 : brut de ligne figé au gel."),
  snapshot_gross_fo_ht_cents: nullableCents.describe("Moteur 3 : brut fourniture de ligne figé au gel."),
  snapshot_fo_ht_cents: nullableCents,
  snapshot_mo_ht_cents: nullableCents,
} as const;

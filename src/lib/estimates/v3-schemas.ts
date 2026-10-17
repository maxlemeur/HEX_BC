import { z } from "zod";

import { ESTIMATE_LINE_PRICING_STATUSES } from "@/lib/units/normalize";

/**
 * Lot 2, sous-lot 2.5 - champs d'API du moteur 3 (conception D3 à D9, §6.2), partagés par
 * `schemas.ts` (création de version, réglages, lignes, lot) et par le registre OpenAPI. Un champ
 * absent du schéma Zod serait retiré en silence (V3P-04) : chaque colonne de saisie v3 est ici.
 */

function hasAtMostDecimals(value: number, scale: number) {
  const scaled = value * 10 ** scale;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Moteur que le client attend pour ses projections (D3) ; absent = 2. */
export const expectedCalcEngineVersionSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3)])
  .describe(
    "Moteur de calcul attendu par le client (absent = 2). S'il diffère de la politique de l'entreprise, la création est refusée en 409 CONTEXT_CHANGED sans rien écrire."
  );

/** Coefficient de vente `numeric(8,4)` dans ]0 ; 10] (D5). */
export const saleCoefficientSchema = z
  .number()
  .finite("Nombre invalide.")
  .gt(0, "Doit être > 0.")
  .max(10, "Doit être <= 10.")
  .refine((value) => hasAtMostDecimals(value, 4), "4 décimales au plus.");

/** Heures par unité `numeric(12,4)`, ≥ 0 (D4). */
const hoursPerUnitSchema = z
  .number()
  .finite("Nombre invalide.")
  .min(0, "Doit être >= 0.")
  .max(99_999_999.9999, "Valeur trop grande.")
  .refine((value) => hasAtMostDecimals(value, 4), "4 décimales au plus.");

export const estimateLinePricingStatusSchema = z.enum(ESTIMATE_LINE_PRICING_STATUSES);

/** Colonnes de saisie d'une ligne v3 : refusées sur une v1/v2 et sur une section (M4). */
export const v3LineItemFields = {
  unit_code: z.union([z.string().trim().max(64, "Unité trop longue."), z.null()]).optional(),
  pricing_status: estimateLinePricingStatusSchema.optional(),
  h_mo_per_unit: z.union([hoursPerUnitSchema, z.null()]).optional(),
  h_mo_atelier_per_unit: z.union([hoursPerUnitSchema, z.null()]).optional(),
  h_mo_chantier_per_unit: z.union([hoursPerUnitSchema, z.null()]).optional(),
} as const;

/**
 * Coefficients de vente d'une v3 (D5), à la création comme aux réglages. À la création : absents = défauts de
 * la politique, lus par la RPC sous verrou ; refusés sur une v2 (`ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`).
 */
export const v3SaleCoefficientFields = {
  sale_coefficient_fo: saleCoefficientSchema.optional(),
  sale_coefficient_mo: saleCoefficientSchema.optional(),
} as const;

/** Réglages de version v3 (D5, D8). */
export const v3VersionSettingsFields = {
  ...v3SaleCoefficientFields,
  apply_tax_rate_to_lines: z
    .boolean()
    .optional()
    .describe("Moteur 3 : applique le taux de TVA de la version à toutes les lignes, dans la même sauvegarde."),
} as const;

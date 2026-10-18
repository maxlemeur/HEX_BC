import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readImportWorkbookParameters, type ImportFlowMappedRowInput } from "@/lib/affaires/import-flow";
import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import type { Database } from "@/types/database";

/**
 * Lot 2, sous-lot 2.8 (D16, E4), partagé depuis 2.10a (A2, A3) : moteur et coefficients de vente de la version
 * qu'un import crée. Repris de l'action d'application de l'import de l'affaire, pour que la création rapide d'une
 * affaire depuis un import et la source DPGF liée de l'assistant normalisent leurs lignes comme elle.
 */

/** Sale coefficients of the v3 an import creates (2.8, E4): the workbook's, the policy's, or a choice. */
export type ImportSaleCoefficients = { fo: number; mo: number; source: "workbook" | "policy" | "choice" };

function isSaleCoefficient(value: number | null | undefined): value is number {
  return typeof value === "number" && value > 0 && value <= 10;
}

/**
 * Under a policy at engine 3, the import creates a v3: its sale coefficients are those chosen (both, or one
 * completed by the next source), else the workbook parameter row's (FO and MO), else the policy's defaults.
 * Null: v1/v2.
 */
export async function resolveImportSaleCoefficients(input: {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  rows: ImportFlowMappedRowInput[];
  requested: { fo?: number; mo?: number } | undefined;
}): Promise<ImportSaleCoefficients | null> {
  const policy = await readTenantCalcPolicy(input.supabase, input.tenantId);
  if (!usesSaleCoefficients(policy.engine)) return null;
  const requestedFo = input.requested?.fo;
  const requestedMo = input.requested?.mo;
  if (requestedFo !== undefined && requestedMo !== undefined) return { fo: requestedFo, mo: requestedMo, source: "choice" };
  let fallback: ImportSaleCoefficients;
  const workbook = readImportWorkbookParameters(input.rows);
  if (isSaleCoefficient(workbook?.coeffFo) && isSaleCoefficient(workbook?.coeffMo)) {
    fallback = { fo: workbook.coeffFo, mo: workbook.coeffMo, source: "workbook" };
  } else if (isSaleCoefficient(policy.defaultSaleCoefficientFo) && isSaleCoefficient(policy.defaultSaleCoefficientMo)) {
    fallback = { fo: policy.defaultSaleCoefficientFo, mo: policy.defaultSaleCoefficientMo, source: "policy" };
  } else {
    throw new Error("La politique de calcul de l’entreprise n’a pas de coefficients de vente par défaut.");
  }
  if (requestedFo === undefined && requestedMo === undefined) return fallback;
  return { fo: requestedFo ?? fallback.fo, mo: requestedMo ?? fallback.mo, source: "choice" };
}

/** Line context of the import normalization for a v3 (hours per unit, unit referential, v3 PU), empty otherwise. */
export function v3LineContext(saleCoefficients: ImportSaleCoefficients | null) {
  return saleCoefficients
    ? { engine: 3, saleCoefficientFo: saleCoefficients.fo, saleCoefficientMo: saleCoefficients.mo }
    : {};
}

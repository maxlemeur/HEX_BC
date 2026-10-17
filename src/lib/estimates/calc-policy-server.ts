import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { conflict, internalError, mapSupabaseError, type SupabaseErrorLike } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

/**
 * Lot 2, sous-lot 2.5 - politique de calcul de l'entreprise (conception D3, §6.3, P-13).
 *
 * La politique dit quel moteur reçoivent les nouvelles versions ; elle n'est écrite que par
 * `public.set_tenant_calc_policy` (service_role, lot 2) et lue ici avec le client de l'utilisateur
 * (RLS : lecture par les membres). Une politique absente vaut moteur 2 jusqu'à la bascule (2.10).
 * La décision finale appartient à `persist_estimate_creation_atomic`, qui relit la politique
 * `FOR SHARE` : la lecture TS ne sert qu'à échouer tôt et à connaître les coefficients par défaut.
 */

type Supabase = SupabaseClient<Database>;

/** Moteur des nouvelles versions : 2 (historique) ou 3 (CHECK de `tenant_calc_policies`). */
export type NewEstimateEngine = 2 | 3;

export type TenantCalcPolicy = {
  engine: NewEstimateEngine;
  defaultSaleCoefficientFo: number | null;
  defaultSaleCoefficientMo: number | null;
  allowedTaxRatesBp: readonly number[];
};

/** Taux de la proposition validée pour le développement (D8, P-07), défaut de la colonne. */
export const DEFAULT_ALLOWED_TAX_RATES_BP: readonly number[] = [2000, 1000, 550, 210];

/** Politique absente : moteur 2, sans coefficients (D3). */
export const ABSENT_TENANT_CALC_POLICY: TenantCalcPolicy = {
  engine: 2,
  defaultSaleCoefficientFo: null,
  defaultSaleCoefficientMo: null,
  allowedTaxRatesBp: DEFAULT_ALLOWED_TAX_RATES_BP,
};

/** Code SQL levé par la création quand le moteur attendu diffère de la politique verrouillée. */
export const ESTIMATE_CALC_POLICY_CONTEXT_CHANGED = "ESTIMATE_CALC_POLICY_CONTEXT_CHANGED";

const CONTEXT_CHANGED_MESSAGE =
  "Le moteur de calcul des nouvelles versions de l'entreprise a changé. Rechargez la page avant de créer la version.";

function toNewEstimateEngine(value: unknown): NewEstimateEngine {
  switch (value) {
    case 2:
    case 3:
      return value;
    default:
      throw internalError("Politique de calcul de l'entreprise illisible.");
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw internalError("Politique de calcul de l'entreprise illisible.");
  return parsed;
}

export async function readTenantCalcPolicy(supabase: Supabase, tenantId: string): Promise<TenantCalcPolicy> {
  const { data, error } = await supabase
    .from("tenant_calc_policies")
    .select("tenant_id, new_estimate_calc_engine, default_sale_coefficient_fo, default_sale_coefficient_mo, allowed_tax_rates_bp")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la politique de calcul de l'entreprise.");
  if (!data) return ABSENT_TENANT_CALC_POLICY;
  return {
    engine: toNewEstimateEngine(data.new_estimate_calc_engine),
    defaultSaleCoefficientFo: toNullableNumber(data.default_sale_coefficient_fo),
    defaultSaleCoefficientMo: toNullableNumber(data.default_sale_coefficient_mo),
    allowedTaxRatesBp: Array.isArray(data.allowed_tax_rates_bp)
      ? data.allowed_tax_rates_bp.map((rate) => Number(rate))
      : DEFAULT_ALLOWED_TAX_RATES_BP,
  };
}

/** Refus nommé d'une création dont le moteur attendu n'est plus celui de l'entreprise (HTTP 409). */
export function calcPolicyContextChanged() {
  return conflict(CONTEXT_CHANGED_MESSAGE, undefined, "CONTEXT_CHANGED");
}

export function isCalcPolicyContextChangedError(error: SupabaseErrorLike | null | undefined) {
  return error?.code === "40001" && (error.message ?? "").includes(ESTIMATE_CALC_POLICY_CONTEXT_CHANGED);
}

/**
 * Moteur de la nouvelle version : celui de la politique, à condition que le client l'attende.
 * Un client sans attente est traité comme attendant 2 (D3) : un ancien bundle échoue fermé chez
 * une entreprise passée au moteur 3, et une attente 3 sans politique 3 ne crée jamais une v2.
 */
export function resolveNewEstimateEngine(input: {
  policy: TenantCalcPolicy;
  expectedEngine?: number | null;
}): NewEstimateEngine {
  const expected = input.expectedEngine ?? 2;
  if (expected !== input.policy.engine) throw calcPolicyContextChanged();
  return input.policy.engine;
}

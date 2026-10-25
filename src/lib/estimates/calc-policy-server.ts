import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NEW_ESTIMATE_CALC_ENGINE_VERSION } from "@/lib/estimates/calc-engine-version";
import type { TenantCalcDefaultsValues } from "@/lib/estimates/calc-policy-defaults";
import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  type SupabaseErrorLike,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

/**
 * Lot 2, sous-lot 2.5 - politique de calcul de l'entreprise (conception D3, §6.3, P-13).
 *
 * La politique dit quel moteur reçoivent les nouvelles versions ; elle n'est écrite que par
 * `public.set_tenant_calc_policy` (service_role, lot 2), dont `public.set_tenant_calc_defaults` (administrateur, lot 3.2)
 * n'ouvre que les coefficients et les taux, et lue ici avec le client de l'utilisateur
 * (RLS : lecture par les membres). Depuis la bascule (sous-lot 2.10b, M8), une politique absente vaut le
 * moteur 3 aux coefficients 1,30 / 1,20 ; une ligne de politique 2 explicite garde le moteur 2.
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

/**
 * Politique absente (D3, P-02, P-07) : moteur 3, coefficients de vente 1,30 (FO) et 1,20 (MO), quatre taux.
 * Seul défaut TS ; il doit rester égal aux replis de `persist_estimate_creation_atomic` posés par M8
 * (`supabase/migrations/*_estimate_engine_v3_default.sql`), que la base applique seule sous verrou.
 */
export const ABSENT_TENANT_CALC_POLICY: TenantCalcPolicy = {
  engine: NEW_ESTIMATE_CALC_ENGINE_VERSION,
  defaultSaleCoefficientFo: 1.3,
  defaultSaleCoefficientMo: 1.2,
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

type TenantCalcPolicyRow = Pick<
  Database["public"]["Tables"]["tenant_calc_policies"]["Row"],
  "new_estimate_calc_engine" | "default_sale_coefficient_fo" | "default_sale_coefficient_mo" | "allowed_tax_rates_bp"
>;

function toTenantCalcPolicy(data: TenantCalcPolicyRow): TenantCalcPolicy {
  return {
    engine: toNewEstimateEngine(data.new_estimate_calc_engine),
    defaultSaleCoefficientFo: toNullableNumber(data.default_sale_coefficient_fo),
    defaultSaleCoefficientMo: toNullableNumber(data.default_sale_coefficient_mo),
    allowedTaxRatesBp: Array.isArray(data.allowed_tax_rates_bp)
      ? data.allowed_tax_rates_bp.map((rate) => Number(rate))
      : DEFAULT_ALLOWED_TAX_RATES_BP,
  };
}

export async function readTenantCalcPolicy(supabase: Supabase, tenantId: string): Promise<TenantCalcPolicy> {
  const { data, error } = await supabase
    .from("tenant_calc_policies")
    .select("tenant_id, new_estimate_calc_engine, default_sale_coefficient_fo, default_sale_coefficient_mo, allowed_tax_rates_bp")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la politique de calcul de l'entreprise.");
  return data ? toTenantCalcPolicy(data) : ABSENT_TENANT_CALC_POLICY;
}

/** Politique et son dernier changement (motif, date), pour l'écran d'administration ; `lastChange` nul sans ligne. */
export type TenantCalcPolicySettings = TenantCalcPolicy & {
  lastChange: { reason: string; updatedAt: string } | null;
};

export async function readTenantCalcPolicySettings(supabase: Supabase, tenantId: string): Promise<TenantCalcPolicySettings> {
  const { data, error } = await supabase
    .from("tenant_calc_policies")
    .select("new_estimate_calc_engine, default_sale_coefficient_fo, default_sale_coefficient_mo, allowed_tax_rates_bp, change_reason, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la politique de calcul de l'entreprise.");
  if (!data) return { ...ABSENT_TENANT_CALC_POLICY, lastChange: null };
  return { ...toTenantCalcPolicy(data), lastChange: { reason: data.change_reason, updatedAt: data.updated_at } };
}

const TENANT_CALC_DEFAULTS_MESSAGES: Record<string, string> = {
  TENANT_CALC_DEFAULTS_REQUIRED: "Les deux coefficients de vente et au moins un taux de TVA sont obligatoires.",
  TENANT_CALC_POLICY_INVALID:
    "Réglages refusés : coefficients supérieurs à 0 et au plus 10 (4 décimales au plus), taux de TVA distincts entre 0 et 100 %.",
  TENANT_CALC_POLICY_REASON_REQUIRED: "Motif obligatoire : 5 à 500 caractères.",
};

/**
 * Lot 3.2, entrée 5 (P-13) : un administrateur écrit les coefficients de vente par défaut et les taux de TVA autorisés
 * par `public.set_tenant_calc_defaults`, qui garde le moteur en vigueur (absente : 3) et journalise le changement.
 */
export async function writeTenantCalcDefaults(
  supabase: Supabase,
  tenantId: string,
  values: TenantCalcDefaultsValues,
): Promise<TenantCalcPolicy> {
  const { data, error } = await supabase.rpc("set_tenant_calc_defaults", {
    p_tenant_id: tenantId,
    p_default_sale_coefficient_fo: values.defaultSaleCoefficientFo,
    p_default_sale_coefficient_mo: values.defaultSaleCoefficientMo,
    p_allowed_tax_rates_bp: [...values.allowedTaxRatesBp],
    p_change_reason: values.changeReason,
  });
  if (error?.code === "42501") {
    throw forbidden("Seul un administrateur de l'entreprise modifie ces réglages.", undefined, "TENANT_CALC_DEFAULTS_ADMIN_ONLY");
  }
  const message = error?.code === "22023" ? TENANT_CALC_DEFAULTS_MESSAGES[error.message ?? ""] : undefined;
  if (message) throw badRequest(message, undefined, error!.message);
  if (error) throw mapSupabaseError(error, "Impossible d'enregistrer les réglages de calcul de l'entreprise.");
  if (!data) throw internalError("Politique de calcul de l'entreprise illisible.");
  return toTenantCalcPolicy(data);
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

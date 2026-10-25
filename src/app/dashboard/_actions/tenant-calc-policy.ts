"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import {
  formatTenantCalcDefaults,
  parseTenantCalcDefaultsForm,
  type TenantCalcDefaultsFieldErrors,
  type TenantCalcDefaultsForm,
} from "@/lib/estimates/calc-policy-defaults";
import { writeTenantCalcDefaults } from "@/lib/estimates/calc-policy-server";
import { ApiError } from "@/lib/estimates/errors";

export type SaveTenantCalcDefaultsResult =
  | { ok: true; form: Omit<TenantCalcDefaultsForm, "changeReason"> }
  | { ok: false; message: string; errors?: TenantCalcDefaultsFieldErrors };

const ADMIN_ONLY_MESSAGE = "Seul un administrateur de l'entreprise modifie ces réglages.";
const SESSION_EXPIRED_MESSAGE = "Session expirée. Reconnectez-vous pour enregistrer les réglages.";

// Forme de l'appel seulement : les règles métier sont celles de `parseTenantCalcDefaultsForm`.
const tenantCalcDefaultsFormSchema = z.object({
  saleCoefficientFo: z.string().max(64),
  saleCoefficientMo: z.string().max(64),
  allowedTaxRates: z.string().max(500),
  changeReason: z.string().max(2000),
});

/**
 * Lot 3.2, entrée 5 (P-13) : enregistre les coefficients de vente par défaut et les taux de TVA autorisés de
 * l'entreprise active. La saisie texte est relue ici par les mêmes règles que l'écran ; la base revérifie le rôle,
 * les bornes et garde le moteur choisi par l'équipe.
 */
export async function saveTenantCalcDefaults(input: TenantCalcDefaultsForm): Promise<SaveTenantCalcDefaultsResult> {
  const form = tenantCalcDefaultsFormSchema.safeParse(input);
  if (!form.success) return { ok: false, message: "Saisie illisible. Rechargez la page." };
  const parsed = parseTenantCalcDefaultsForm(form.data);
  if (!parsed.ok) return { ok: false, message: "Corrigez les champs signalés.", errors: parsed.errors };
  try {
    const context = await getAuthenticatedContext();
    if (context.tenantRole !== "admin") return { ok: false, message: ADMIN_ONLY_MESSAGE };
    const policy = await writeTenantCalcDefaults(context.supabase, context.tenantId, parsed.values);
    revalidatePath("/dashboard/admin/calc-policy");
    return { ok: true, form: formatTenantCalcDefaults(policy) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.status === 401 ? SESSION_EXPIRED_MESSAGE : error.message };
    }
    return { ok: false, message: "Impossible d'enregistrer les réglages. Réessayez." };
  }
}

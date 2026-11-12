"use server";

import { z } from "zod";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";

export async function readFoCoefficientSettings() {
  const { supabase, tenantId, userId, isTenantAdmin } =
    await getAuthenticatedTenantContext();
  const [types, preferences] = await Promise.all([
    supabase
      .from("supply_types")
      .select("id, name, default_fo_provision")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("estimate_fo_preferences")
      .select("supply_type_id, coefficient")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId),
  ]);
  if (types.error || preferences.error)
    throw new Error("Impossible de charger les coefficients fourniture.");
  const personal = new Map(
    (preferences.data ?? []).map((row) => [
      row.supply_type_id,
      row.coefficient,
    ]),
  );
  return {
    canManageCompany: isTenantAdmin,
    rows: (types.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      company: row.default_fo_provision,
      personal: personal.get(row.id) ?? null,
    })),
  };
}

export async function saveFoCoefficientSetting(input: {
  supplyTypeId: string;
  scope: "company" | "personal";
  coefficient: number | null;
}) {
  const parsed = z
    .object({
      supplyTypeId: z.uuid(),
      scope: z.enum(["company", "personal"]),
      coefficient: z.number().min(0).max(999999999.999).nullable(),
    })
    .parse(input);
  if (
    parsed.coefficient !== null &&
    Number(parsed.coefficient.toFixed(6)) !== parsed.coefficient
  ) {
    throw new Error("Le K FO accepte six décimales au maximum.");
  }
  const { supabase, tenantId, userId, isTenantAdmin } =
    await getAuthenticatedTenantContext();
  const type = await supabase
    .from("supply_types")
    .select("id")
    .eq("id", parsed.supplyTypeId)
    .eq("tenant_id", tenantId)
    .single();
  if (type.error || !type.data)
    throw new Error("Type de fourniture introuvable.");
  if (parsed.scope === "company") {
    if (!isTenantAdmin)
      throw new Error("La base entreprise est réservée aux administrateurs.");
    if (parsed.coefficient === null)
      throw new Error("La base entreprise doit être renseignée.");
    const result = await supabase
      .from("supply_types")
      .update({ default_fo_provision: parsed.coefficient })
      .eq("id", parsed.supplyTypeId)
      .eq("tenant_id", tenantId);
    if (result.error)
      throw new Error("Impossible d'enregistrer la base entreprise.");
  } else {
    const result =
      parsed.coefficient === null
        ? await supabase
            .from("estimate_fo_preferences")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("user_id", userId)
            .eq("supply_type_id", parsed.supplyTypeId)
        : await supabase.from("estimate_fo_preferences").upsert(
            {
              tenant_id: tenantId,
              user_id: userId,
              supply_type_id: parsed.supplyTypeId,
              coefficient: parsed.coefficient,
            },
            { onConflict: "tenant_id,user_id,supply_type_id" },
          );
    if (result.error)
      throw new Error("Impossible d'enregistrer votre préférence.");
  }
  return readFoCoefficientSettings();
}

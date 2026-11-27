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

const coefficientChangeSchema = z.object({
  supplyTypeId: z.uuid(),
  scope: z.enum(["company", "personal"]),
  coefficient: z.number().min(0).max(999999999.999).nullable(),
});

export type FoCoefficientChange = z.infer<typeof coefficientChangeSchema>;

/**
 * Saves the cells edited in the K FO table. Every change is checked before the first write; the
 * writes are idempotent, so a request that fails part-way is retried with the same changes.
 */
export async function saveFoCoefficientSettings(input: FoCoefficientChange[]) {
  const changes = z.array(coefficientChangeSchema).min(1).max(500).parse(input);
  const keys = new Set(changes.map((c) => `${c.scope}:${c.supplyTypeId}`));
  if (keys.size !== changes.length)
    throw new Error("Un coefficient est modifié deux fois.");
  for (const change of changes) {
    if (
      change.coefficient !== null &&
      Number(change.coefficient.toFixed(6)) !== change.coefficient
    )
      throw new Error("Le K FO accepte six décimales au maximum.");
    if (change.scope === "company" && change.coefficient === null)
      throw new Error("La base entreprise doit être renseignée.");
  }
  const { supabase, tenantId, userId, isTenantAdmin } =
    await getAuthenticatedTenantContext();
  const company = changes.filter((c) => c.scope === "company");
  const personal = changes.filter((c) => c.scope === "personal");
  if (company.length > 0 && !isTenantAdmin)
    throw new Error("La base entreprise est réservée aux administrateurs.");
  const ids = [...new Set(changes.map((c) => c.supplyTypeId))];
  const types = await supabase
    .from("supply_types")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (types.error || (types.data ?? []).length !== ids.length)
    throw new Error("Famille de fourniture introuvable.");

  for (const change of company) {
    const result = await supabase
      .from("supply_types")
      .update({ default_fo_provision: change.coefficient as number })
      .eq("id", change.supplyTypeId)
      .eq("tenant_id", tenantId);
    if (result.error)
      throw new Error("Impossible d'enregistrer la base entreprise.");
  }
  const upserts = personal.flatMap((c) =>
    c.coefficient === null
      ? []
      : [
          {
            tenant_id: tenantId,
            user_id: userId,
            supply_type_id: c.supplyTypeId,
            coefficient: c.coefficient,
          },
        ],
  );
  if (upserts.length > 0) {
    const result = await supabase
      .from("estimate_fo_preferences")
      .upsert(upserts, { onConflict: "tenant_id,user_id,supply_type_id" });
    if (result.error)
      throw new Error("Impossible d'enregistrer vos préférences.");
  }
  const cleared = personal
    .filter((c) => c.coefficient === null)
    .map((c) => c.supplyTypeId);
  if (cleared.length > 0) {
    const result = await supabase
      .from("estimate_fo_preferences")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .in("supply_type_id", cleared);
    if (result.error)
      throw new Error("Impossible d'enregistrer vos préférences.");
  }
  return readFoCoefficientSettings();
}

import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { badRequest, conflict, forbidden, mapSupabaseError } from "@/lib/estimates/errors";

import {
  supplyTypeCodeFromName,
  supplyTypeNameKey,
  type CreateSupplyTypeInput,
  type SupplyTypeRecord,
} from "./supply-types";

export async function listSupplyTypes(): Promise<{ items: SupplyTypeRecord[] }> {
  const { supabase, tenantId } = await getAuthenticatedTenantContext();
  const { data, error } = await supabase
    .from("supply_types")
    .select("id, code, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les types de fourniture.");
  }
  return { items: data ?? [] };
}

/**
 * RLS lets any member write supply types (they predate roles). The referential is shared by every estimate
 * of the tenant, so the application reserves its growth to administrators, like the rest of the catalogue.
 */
export async function createSupplyType(input: CreateSupplyTypeInput): Promise<{ item: SupplyTypeRecord }> {
  const { supabase, tenantId, isTenantAdmin } = await getAuthenticatedTenantContext();
  if (!isTenantAdmin) {
    throw forbidden("La gestion du catalogue est réservée aux administrateurs.");
  }
  const code = supplyTypeCodeFromName(input.name);
  if (!code) {
    throw badRequest("Le nom du type de fourniture doit contenir une lettre ou un chiffre.");
  }

  const nameKey = supplyTypeNameKey(input.name);
  const existing = await supabase
    .from("supply_types")
    .select("code, name")
    .eq("tenant_id", tenantId);
  if (existing.error) {
    throw mapSupabaseError(existing.error, "Impossible de vérifier les types de fourniture existants.");
  }
  const taken = (existing.data ?? []).find(
    (type) => supplyTypeNameKey(type.name) === nameKey || type.code === code,
  );
  if (taken) {
    throw conflict(`Ce type de fourniture existe déjà : « ${taken.name} ».`);
  }

  const { data, error } = await supabase
    .from("supply_types")
    .insert({ tenant_id: tenantId, code, name: input.name })
    .select("id, code, name")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw conflict("Ce type de fourniture existe déjà.");
    }
    throw mapSupabaseError(error, "Impossible de créer le type de fourniture.");
  }
  return { item: data };
}

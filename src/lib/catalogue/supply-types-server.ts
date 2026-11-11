import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { badRequest, conflict, forbidden, mapSupabaseError } from "@/lib/estimates/errors";

import {
  supplyTypeCodeFromName,
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
  const { supabase, isTenantAdmin } = await getAuthenticatedTenantContext();
  if (!isTenantAdmin) {
    throw forbidden("La gestion du catalogue est réservée aux administrateurs.");
  }
  if (!supplyTypeCodeFromName(input.name)) {
    throw badRequest("Le nom du type de fourniture doit contenir une lettre ou un chiffre.");
  }

  // The duplicate check and the insert are one database call, under a lock per tenant: two administrators
  // creating "Tube" and "Tubes" at the same moment cannot both succeed.
  const { data, error } = await supabase.rpc("create_supply_type", { p_name: input.name }).single();
  if (error) {
    if (error.message.includes("SUPPLY_TYPE_NAME_TAKEN")) {
      throw conflict(
        error.details
          ? `Ce type de fourniture existe déjà : « ${error.details} ».`
          : "Ce type de fourniture existe déjà.",
      );
    }
    if (error.message.includes("SUPPLY_TYPE_ADMIN_REQUIRED")) {
      throw forbidden("La gestion du catalogue est réservée aux administrateurs.");
    }
    if (error.message.includes("SUPPLY_TYPE_NAME_INVALID")) {
      throw badRequest("Le nom du type de fourniture doit contenir une lettre ou un chiffre.");
    }
    throw mapSupabaseError(error, "Impossible de créer le type de fourniture.");
  }
  return { item: data };
}

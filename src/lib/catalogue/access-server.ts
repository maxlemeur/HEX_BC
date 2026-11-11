import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { forbidden, mapSupabaseError } from "@/lib/estimates/errors";

import { buildCatalogueAccess, canAddToCatalogue, type CatalogueAccess } from "./access";

type CatalogueSupabase = Awaited<ReturnType<typeof getAuthenticatedTenantContext>>["supabase"];

/** Absent row: engineers do not edit the shared base (default of `tenant_catalogue_policies`). */
export async function readEngineersCanEditShared(supabase: CatalogueSupabase, tenantId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("tenant_catalogue_policies")
    .select("engineers_can_edit_shared")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire les droits du catalogue.");
  return data?.engineers_can_edit_shared === true;
}

export async function readCatalogueAccess(): Promise<CatalogueAccess> {
  const { supabase, userId, tenantId, tenantRole } = await getAuthenticatedTenantContext();
  // Only an engineer depends on the setting: no read for the other roles.
  const engineersCanEditShared = tenantRole === "engineer" ? await readEngineersCanEditShared(supabase, tenantId) : false;
  return buildCatalogueAccess({ userId, role: tenantRole, engineersCanEditShared });
}

/**
 * Client of a catalogue write. The policies decide; refusing a role that can never write here turns a silent
 * zero-row write into an explicit 403.
 */
export async function getCatalogueWriterClient(refusal: string) {
  const { supabase, userId, tenantRole } = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(tenantRole)) throw forbidden(refusal);
  return { supabase, userId, isTenantAdmin: tenantRole === "admin" };
}

import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";

import { CatalogueRightsAdminClient } from "./CatalogueRightsAdminClient";

/** TI-689: who changes the suppliers and items of the company, decided by its administrators. */
export default async function AdminCatalogueRightsPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const context = await getAuthenticatedContext();
  const engineersCanEditShared = await readEngineersCanEditShared(context.supabase, context.tenantId);

  return <CatalogueRightsAdminClient initialEngineersCanEditShared={engineersCanEditShared} />;
}

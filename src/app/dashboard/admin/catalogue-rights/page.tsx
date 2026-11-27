import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { ProductReferenceNamingForm } from "@/components/catalogue/ProductReferenceNamingForm";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { readProductReferenceNaming } from "@/lib/catalogue/product-reference-naming-server";

import { CatalogueRightsAdminClient } from "./CatalogueRightsAdminClient";

/** TI-689: who changes the suppliers and items of the company, decided by its administrators. */
export default async function AdminCatalogueRightsPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const context = await getAuthenticatedContext();
  const [engineersCanEditShared, naming] = await Promise.all([
    readEngineersCanEditShared(context.supabase, context.tenantId),
    readProductReferenceNaming(context.supabase, context.tenantId),
  ]);

  return (
    <>
      <CatalogueRightsAdminClient initialEngineersCanEditShared={engineersCanEditShared} />
      <ProductReferenceNamingForm initial={naming.naming} saved={naming.saved} available={naming.available} />
    </>
  );
}

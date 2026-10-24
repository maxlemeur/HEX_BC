import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { formatTenantCalcDefaults } from "@/lib/estimates/calc-policy-defaults";
import { readTenantCalcPolicySettings } from "@/lib/estimates/calc-policy-server";

import { TenantCalcPolicyAdminClient } from "./TenantCalcPolicyAdminClient";

/** Lot 3.2, entrée 5 (P-13) : défauts de calcul de l'entreprise, réglés par ses administrateurs. */
export default async function AdminCalcPolicyPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const context = await getAuthenticatedContext();
  const settings = await readTenantCalcPolicySettings(context.supabase, context.tenantId);

  return (
    <TenantCalcPolicyAdminClient
      engine={settings.engine}
      initialForm={formatTenantCalcDefaults(settings)}
      lastChange={settings.lastChange}
    />
  );
}

import { redirect } from "next/navigation";

import { TenantMembershipManager } from "@/components/tenants/TenantMembershipManager";
import { getUserContext } from "@/lib/auth/server";

export default async function TenantsPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return <TenantMembershipManager />;
}

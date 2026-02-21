import { redirect } from "next/navigation";

import { MembershipsManager } from "@/components/memberships/MembershipsManager";
import { getUserContext } from "@/lib/auth/server";

export default async function MembershipsPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return <MembershipsManager />;
}

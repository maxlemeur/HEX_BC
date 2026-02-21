import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";

import { FeatureFlagsAdminClient } from "./FeatureFlagsAdminClient";

export default async function AdminFeatureFlagsPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return <FeatureFlagsAdminClient tenantId={tenantId} />;
}

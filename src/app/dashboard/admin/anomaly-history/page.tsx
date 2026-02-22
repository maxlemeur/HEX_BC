import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";

import { AnomalyHistoryClient } from "./AnomalyHistoryClient";

export default async function AdminAnomalyHistoryPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return <AnomalyHistoryClient tenantId={tenantId} />;
}

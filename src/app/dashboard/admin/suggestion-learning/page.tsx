import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";

import { SuggestionLearningAdminClient } from "./SuggestionLearningAdminClient";

export default async function AdminSuggestionLearningPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return <SuggestionLearningAdminClient tenantId={tenantId} />;
}

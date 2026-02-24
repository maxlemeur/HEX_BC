import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";

import { CurrencyRatesAdminClient } from "./CurrencyRatesAdminClient";

export default async function AdminCurrenciesPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return <CurrencyRatesAdminClient />;
}

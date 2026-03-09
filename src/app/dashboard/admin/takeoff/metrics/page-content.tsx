import { redirect } from "next/navigation";
import type { ComponentType } from "react";

import { getUserContext } from "@/lib/auth/server";

type TakeoffMetricsDashboardProps = {
  tenantId: string;
};

async function loadTakeoffMetricsDashboard(): Promise<ComponentType<TakeoffMetricsDashboardProps>> {
  const dashboardModule = (await import("@/components/takeoff/TakeoffMetricsDashboard")) as {
    TakeoffMetricsDashboard?: ComponentType<TakeoffMetricsDashboardProps>;
    default?: ComponentType<TakeoffMetricsDashboardProps>;
  };
  const dashboardComponent = dashboardModule.TakeoffMetricsDashboard ?? dashboardModule.default;

  if (!dashboardComponent) {
    throw new Error("TakeoffMetricsDashboard export is missing.");
  }

  return dashboardComponent;
}

type AdminTakeoffMetricsPageInput = {
  loadDashboard?: () => Promise<ComponentType<TakeoffMetricsDashboardProps>>;
};

export async function renderAdminTakeoffMetricsPage(
  input: AdminTakeoffMetricsPageInput = {}
) {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const Dashboard = await (input.loadDashboard ?? loadTakeoffMetricsDashboard)();

  return <Dashboard tenantId={tenantId} />;
}

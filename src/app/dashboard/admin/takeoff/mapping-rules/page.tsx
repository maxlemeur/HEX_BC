import { redirect } from "next/navigation";
import type { ComponentType } from "react";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

type MappingRulesManagerProps = {
  tenantId: string;
};

async function loadMappingRulesManager(): Promise<ComponentType<MappingRulesManagerProps>> {
  const managerModule = (await import("@/components/takeoff/MappingRulesManager")) as {
    MappingRulesManager?: ComponentType<MappingRulesManagerProps>;
    default?: ComponentType<MappingRulesManagerProps>;
  };
  const managerComponent = managerModule.MappingRulesManager ?? managerModule.default;

  if (!managerComponent) {
    throw new Error("MappingRulesManager export is missing.");
  }

  return managerComponent;
}

type AdminTakeoffMappingRulesPageInput = {
  loadManager?: () => Promise<ComponentType<MappingRulesManagerProps>>;
};

export async function renderAdminTakeoffMappingRulesPage(
  input: AdminTakeoffMappingRulesPageInput = {}
) {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) {
    redirect("/dashboard");
  }

  const MappingRulesManager = await (input.loadManager ?? loadMappingRulesManager)();

  return <MappingRulesManager tenantId={tenantId} />;
}

export default async function AdminTakeoffMappingRulesPage() {
  return renderAdminTakeoffMappingRulesPage();
}

"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { useUserContext } from "@/lib/auth/user-context";

const DashboardAssistantWorkspace = dynamic(() => import("./DashboardAssistantWorkspace"));

export function AssistantDock({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { profile, tenantId } = useUserContext();
  if (!enabled || !profile?.id || !tenantId) return children;
  return (
    <DashboardAssistantWorkspace key={profile.id + ":" + tenantId} userId={profile.id} tenantId={tenantId}>
      {children}
    </DashboardAssistantWorkspace>
  );
}

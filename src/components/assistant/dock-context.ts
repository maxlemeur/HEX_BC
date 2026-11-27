"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect } from "react";

import type { AssistantContextOption } from "@/components/ai/AssistantAiSettings";
import type { AssistantScreen } from "@/lib/assistant/prompt";
import type { WorkbookSnapshot } from "@/lib/assistant/session-context";

export type AssistantScope = { projectId: string; screen: AssistantScreen };
export type Registration = { pathname: string; scope: AssistantScope };
export type WorkbookStatus = {
  running: boolean;
  result: boolean;
  label: string;
  snapshot: WorkbookSnapshot;
  prepare(criterion: string): void;
  previewReliabilityZero(): boolean;
};

type DockContext = {
  register(value: Registration): () => void;
  workbookControls: HTMLDivElement | null;
  workbookActive: boolean;
  contextOptions: readonly AssistantContextOption[];
  setHeaderTarget(value: HTMLDivElement | null): void;
  setWorkbookStatus(value: WorkbookStatus | null): void;
};
export const AssistantDockContext = createContext<DockContext | null>(null);

export function useDashboardAssistant() {
  return useContext(AssistantDockContext);
}

export function useAssistantScreen(scope: AssistantScope | null) {
  const register = useDashboardAssistant()?.register;
  const pathname = usePathname();
  const serialized = scope ? JSON.stringify(scope) : null;
  useEffect(() => {
    if (!register || !serialized) return;
    return register({ pathname, scope: JSON.parse(serialized) as AssistantScope });
  }, [register, serialized, pathname]);
}

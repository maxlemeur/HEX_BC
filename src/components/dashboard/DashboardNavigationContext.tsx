"use client";

import {
  createContext,
  useContext,
  type ReactNode,
  type RefObject,
} from "react";

import type { NavGroup } from "@/lib/navigation/build-nav-groups";
import type { DashboardNavigationMode } from "@/lib/navigation/dashboard-navigation-mode";

export type DashboardNavigationContextValue = {
  mode: DashboardNavigationMode;
  pathname: string;
  drawerOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  openDrawer: () => void;
  groups: NavGroup[];
};

const DashboardNavigationContext =
  createContext<DashboardNavigationContextValue | null>(null);

export function useDashboardNavigation() {
  return useContext(DashboardNavigationContext);
}

export function DashboardNavigationProvider({
  children,
  value,
}: Readonly<{
  children: ReactNode;
  value: DashboardNavigationContextValue;
}>) {
  return (
    <DashboardNavigationContext.Provider value={value}>
      {children}
    </DashboardNavigationContext.Provider>
  );
}

export function WorkspaceNavigationButton({
  className = "",
}: Readonly<{
  className?: string;
}>) {
  const navigation = useDashboardNavigation();

  if (!navigation || navigation.mode !== "workspace") {
    return null;
  }

  return (
    <button
      ref={navigation.menuButtonRef}
      type="button"
      className={`btn btn-secondary btn-sm shrink-0 gap-2 ${className}`}
      onClick={navigation.openDrawer}
      aria-label="Ouvrir le menu principal"
      aria-expanded={navigation.drawerOpen}
      aria-controls="dashboard-sidebar"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
    </button>
  );
}

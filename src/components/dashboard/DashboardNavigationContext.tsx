"use client";

import {
  createContext,
  useContext,
  type ReactNode,
  type RefObject,
} from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NavGroup } from "@/lib/navigation/build-nav-groups";
import { MenuIcon } from "lucide-react";

export type DashboardNavigationContextValue = {
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

  if (!navigation) {
    return null;
  }

  return (
    <button
      ref={navigation.menuButtonRef}
      type="button"
      className={cn(buttonVariants({ variant: "outline", size: "md" }), "shrink-0 gap-2", className)}
      onClick={navigation.openDrawer}
      aria-label="Ouvrir le menu principal"
      aria-expanded={navigation.drawerOpen}
      aria-controls="dashboard-sidebar"
    >
      <MenuIcon aria-hidden="true" size={16} />
    </button>
  );
}

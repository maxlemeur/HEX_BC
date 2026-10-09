import type { ReactNode } from "react";

import type { UiMode } from "@/lib/ui-mode";
import { AsteriskIcon, BuildingIcon, ChartLineIcon, DatabaseIcon, FileTextIcon, FolderIcon, HouseIcon, LayersIcon, SettingsIcon, SquareCheckBigIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  title?: string;
  navId?: string;
};

export type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

export type TenantRole = "admin" | "engineer" | "viewer" | "director";

export type BuildNavGroupsInput = {
  role: TenantRole | null;
  uiMode: UiMode;
  featureFlags: { takeoffEnabled: boolean };
  lastAffaireId?: string | null;
};

// ---------------------------------------------------------------------------
// Nav item constants
// ---------------------------------------------------------------------------

const HOME_ITEM: NavItem = {
  href: "/dashboard",
  label: "Accueil",
  icon: (
    <HouseIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const AFFAIRES_ITEM: NavItem = {
  href: "/dashboard/affaires",
  label: "Mes affaires",
  icon: (
    <FolderIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

export const TAKEOFF_NAV_ITEM: NavItem = {
  href: "/dashboard/takeoff",
  label: "Métrés plans",
  navId: "takeoff",
  icon: (
    <BuildingIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const ORDERS_ITEM: NavItem = {
  href: "/dashboard/orders",
  label: "Mes commandes",
  icon: (
    <FileTextIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const REFERENTIEL_ITEM: NavItem = {
  href: "/dashboard/referentiel",
  label: "Référentiel",
  icon: (
    <DatabaseIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const TARIFS_ITEM: NavItem = {
  href: "/dashboard/tarifs",
  label: "Tarifs",
  icon: (
    <LayersIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const ANALYTICS_ITEM: NavItem = {
  href: "/dashboard/analytics",
  label: "Performances",
  icon: (
    <ChartLineIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const APPROVALS_ITEM: NavItem = {
  href: "/dashboard/approvals",
  label: "Approbations",
  navId: "approvals",
  icon: (
    <SquareCheckBigIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const DIRECTION_ITEM: NavItem = {
  href: "/dashboard/direction",
  label: "Vue direction",
  navId: "direction",
  icon: (
    <AsteriskIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

const ADMIN_ITEM: NavItem = {
  href: "/dashboard/admin",
  label: "Administration",
  icon: (
    <SettingsIcon aria-hidden="true" strokeWidth="1.75" size={20} />
  ),
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildNavGroups(input: BuildNavGroupsInput): NavGroup[] {
  const { role, uiMode, featureFlags } = input;

  if (!role) return [];

  const groups: NavGroup[] = [];

  groups.push({ key: "accueil", label: "Accueil", items: [HOME_ITEM] });

  // --- Mes affaires (all roles) ---
  const affairesItems: NavItem[] = [AFFAIRES_ITEM];
  if (featureFlags.takeoffEnabled) {
    const takeoffHref = input.lastAffaireId
      ? `/dashboard/affaires/${input.lastAffaireId}/takeoff`
      : "/dashboard/takeoff";
    affairesItems.push({ ...TAKEOFF_NAV_ITEM, href: takeoffHref });
  }
  groups.push({ key: "affaires", label: "Mes affaires", items: affairesItems });

  // --- Commandes (all roles) ---
  groups.push({ key: "commandes", label: "Commandes", items: [ORDERS_ITEM] });

  // --- Validation (admin + director only) ---
  if (role === "admin" || role === "director") {
    groups.push({
      key: "validation",
      label: "Validation",
      items: [APPROVALS_ITEM, DIRECTION_ITEM],
    });
  }

  // --- Outils (admin always, engineer only in expert mode) ---
  if (role === "admin" || (role === "engineer" && uiMode === "expert")) {
    groups.push({
      key: "outils",
      label: "Outils",
      items: [REFERENTIEL_ITEM, TARIFS_ITEM, ANALYTICS_ITEM],
    });
  }

  // --- Administration (admin only) ---
  if (role === "admin") {
    groups.push({
      key: "administration",
      label: "Administration",
      items: [ADMIN_ITEM],
    });
  }

  return groups;
}

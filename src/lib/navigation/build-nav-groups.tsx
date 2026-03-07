import type { ReactNode } from "react";

import type { UiMode } from "@/lib/ui-mode";

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

const AFFAIRES_ITEM: NavItem = {
  href: "/dashboard/affaires",
  label: "Mes affaires",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  ),
};

export const TAKEOFF_NAV_ITEM: NavItem = {
  href: "/dashboard/takeoff",
  label: "Métrés plans",
  navId: "takeoff",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20V8l8-4 8 4v12" />
      <path d="M10 20v-6h4v6" />
      <path d="M2 20h20" />
      <path d="M8 10h.01" />
      <path d="M16 10h.01" />
    </svg>
  ),
};

const ORDERS_ITEM: NavItem = {
  href: "/dashboard/orders",
  label: "Mes commandes",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  ),
};

const REFERENTIEL_ITEM: NavItem = {
  href: "/dashboard/referentiel",
  label: "Référentiel",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  ),
};

const TARIFS_ITEM: NavItem = {
  href: "/dashboard/tarifs",
  label: "Tarifs",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  ),
};

const ANALYTICS_ITEM: NavItem = {
  href: "/dashboard/analytics",
  label: "Analytics",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
};

const APPROVALS_ITEM: NavItem = {
  href: "/dashboard/approvals",
  label: "Approbations",
  navId: "approvals",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
};

const ADMIN_ITEM: NavItem = {
  href: "/dashboard/admin",
  label: "Administration",
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildNavGroups(input: BuildNavGroupsInput): NavGroup[] {
  const { role, uiMode, featureFlags } = input;

  if (!role) return [];

  const groups: NavGroup[] = [];

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
    groups.push({ key: "validation", label: "Validation", items: [APPROVALS_ITEM] });
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

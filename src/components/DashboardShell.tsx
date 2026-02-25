"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SignOutButton } from "@/components/SignOutButton";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useTakeoffEnabled } from "@/hooks/useTakeoffEnabled";

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";

type NavGroup = {
  key: string;
  label: string;
  items: { href: string; label: string; icon: React.ReactNode }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    key: "chiffrages",
    label: "Chiffrages",
    items: [
      {
        href: "/dashboard/estimates",
        label: "Chiffrages",
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
            <rect width="16" height="20" x="4" y="2" rx="2" />
            <path d="M8 7h8" />
            <path d="M8 11h2" />
            <path d="M14 11h2" />
            <path d="M8 15h2" />
            <path d="M14 15h2" />
          </svg>
        ),
      },
      {
        href: "/dashboard/imports",
        label: "Imports DPGF",
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
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
        ),
      },
      {
        href: "/dashboard/mappings",
        label: "Mappings",
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
            <path d="M8 3 4 7l4 4" />
            <path d="M16 3l4 4-4 4" />
            <path d="M12 19v-4" />
            <path d="M9 19h6" />
            <path d="M12 15V7" />
          </svg>
        ),
      },
    ],
  },
  {
    key: "commandes",
    label: "Commandes",
    items: [
      {
        href: "/dashboard/orders",
        label: "Bons de commande",
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
      },
    ],
  },
  {
    key: "configurer",
    label: "Configurer",
    items: [
      {
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
      },
      {
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
      },
      {
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
      },
    ],
  },
];

const TAKEOFF_NAV_ITEM: NavGroup["items"][number] = {
  href: "/dashboard/takeoff",
  label: "Métrés plans",
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


function buildInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "..";
  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function DashboardShell({
  children,
  displayName,
}: Readonly<{
  children: React.ReactNode;
  displayName: string;
}>) {
  const pathname = usePathname();
  const userInitials = buildInitials(displayName);
  const { enabled: isSidebarFlagIndicatorEnabled } = useFeatureFlag(
    "FEATURE_FLAGS_SIDEBAR_INDICATOR"
  );
  const { status: takeoffStatus, enabled: isTakeoffEnabled } = useTakeoffEnabled();

  const [collapsed, setCollapsed] = useState(false);
  const [hasLoadedCollapsedPreference, setHasLoadedCollapsedPreference] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    } catch {
      setCollapsed(false);
    } finally {
      setHasLoadedCollapsedPreference(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedCollapsedPreference) {
      return;
    }

    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // Ignore persistence failures to keep navigation usable.
    }
  }, [collapsed, hasLoadedCollapsedPreference]);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const navGroups = useMemo(() => {
    if (takeoffStatus !== "ready" || !isTakeoffEnabled) {
      return NAV_GROUPS;
    }

    return NAV_GROUPS.map((group) => {
      if (group.key === "chiffrages") {
        return {
          ...group,
          items: [...group.items, TAKEOFF_NAV_ITEM],
        };
      }

      return group;
    });
  }, [isTakeoffEnabled, takeoffStatus]);

  function isActive(href: string) {
    if (href === "/dashboard/orders") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/orders");
    }
    if (href === "/dashboard/admin") {
      return pathname.startsWith("/dashboard/admin") || pathname.startsWith("/dashboard/tenants");
    }
    if (href === "/dashboard/referentiel") {
      return (
        pathname.startsWith("/dashboard/referentiel") ||
        pathname.startsWith("/dashboard/suppliers") ||
        pathname.startsWith("/dashboard/sites") ||
        pathname.startsWith("/dashboard/products") ||
        pathname.startsWith("/dashboard/catalogue")
      );
    }
    if (href === "/dashboard/tarifs") {
      return (
        pathname.startsWith("/dashboard/tarifs") ||
        pathname.startsWith("/dashboard/prices") ||
        pathname.startsWith("/dashboard/indices")
      );
    }
    return pathname.startsWith(href);
  }

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      {/* Mobile hamburger button */}
      <button
        type="button"
        className="no-print fixed left-4 top-5 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-blue)] text-white shadow-lg md:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Ouvrir le menu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      ) : null}

      <aside
        data-mobile-open={mobileOpen ? "true" : undefined}
        className={`no-print dashboard-sidebar fixed left-0 top-0 z-40 flex h-screen flex-col${collapsed ? " dashboard-sidebar--collapsed" : ""}`}
      >
        <div className="flex h-20 items-center px-6 mt-2 sidebar-header">
          <Link href="/dashboard" className="sidebar-logo-link flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Image
                src="/logo-hydro-express.jpg"
                alt="Hydro Express"
                width={28}
                height={28}
                className="rounded-md"
              />
            </div>
            <div className="sidebar-label">
              <span className="block text-base font-bold text-white">Hydro Express</span>
              <span className="block text-[11px] font-medium text-white/50">
                Gestion des commandes
              </span>
              {isSidebarFlagIndicatorEnabled ? (
                <span className="mt-1 inline-flex items-center rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
                  Flags actifs
                </span>
              ) : null}
            </div>
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="sidebar-toggle"
            aria-label={collapsed ? "Déployer le menu" : "Replier le menu"}
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
            >
              {collapsed ? (
                <>
                  <polyline points="13 17 18 12 13 7" />
                  <polyline points="6 17 11 12 6 7" />
                </>
              ) : (
                <>
                  <polyline points="11 17 6 12 11 7" />
                  <polyline points="18 17 13 12 18 7" />
                </>
              )}
            </svg>
          </button>
        </div>

        <nav className="mt-4 flex-1 px-4" aria-label="Menu principal">
          {navGroups.map((group, i) => (
            <div
              key={group.key}
              className={`sidebar-nav-group${i === 0 ? " sidebar-nav-group--first" : ""}`}
            >
              <div className="sidebar-nav-group__label">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`sidebar-nav-item ${active ? "active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      onClick={closeMobile}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4 sidebar-footer">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <Link
              href="/dashboard/profile"
              className="flex flex-1 items-center gap-3 min-w-0 rounded-lg -m-1.5 p-1.5 transition-colors hover:bg-white/5"
              title={collapsed ? displayName || "Compte" : undefined}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-orange text-sm font-bold text-white">
                {userInitials}
              </div>
              <div className="sidebar-label flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {displayName || "Compte"}
                </p>
              </div>
            </Link>
            <div className="sidebar-label">
              <SignOutButton />
            </div>
          </div>
        </div>
      </aside>

      <main
        className="flex-1 transition-[padding-left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{
          paddingLeft: collapsed
            ? "var(--sidebar-collapsed-width)"
            : "var(--sidebar-width)",
        }}
      >
        <div className="min-h-screen px-4 py-16 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}

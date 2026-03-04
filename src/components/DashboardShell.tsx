"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SignOutButton } from "@/components/SignOutButton";
import { useUserContext } from "@/components/UserContext";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useTakeoffEnabled } from "@/hooks/useTakeoffEnabled";
import { useUiMode } from "@/hooks/useUiMode";
import { buildNavGroups } from "@/lib/navigation/build-nav-groups";

// ---------------------------------------------------------------------------
// Text-editing guard (shared with useCommandPalette)
// ---------------------------------------------------------------------------

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden",
  "image", "radio", "range", "reset", "submit",
]);

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type.toLowerCase());
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(
    target.closest(
      "[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
    )
  );
}

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";



function buildInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "..";
  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function ModeToggleSwitch({
  isExpert,
  onToggle,
}: Readonly<{
  isExpert: boolean;
  onToggle: () => void;
}>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isExpert}
      aria-label={isExpert ? "Mode Expert actif, basculer en Simplifié" : "Mode Simplifié actif, basculer en Expert"}
      title={isExpert ? "Passer en mode Simplifié" : "Passer en mode Expert"}
      onClick={onToggle}
      className="group relative flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-white/20 bg-white/10 p-0.5 transition-colors duration-200 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 focus-visible:outline-offset-2"
    >
      {/* Track labels */}
      <span className="absolute inset-0 flex items-center justify-between px-1.5 text-[9px] font-bold uppercase tracking-wider">
        <span className={`transition-opacity duration-200 ${isExpert ? "opacity-0" : "opacity-60 text-white"}`}>S</span>
        <span className={`transition-opacity duration-200 ${isExpert ? "opacity-60 text-white" : "opacity-0"}`}>E</span>
      </span>
      {/* Sliding thumb */}
      <span
        className={`pointer-events-none relative z-10 h-5 w-5 rounded-full shadow-md transition-all duration-200 ease-in-out ${
          isExpert
            ? "translate-x-5 bg-brand-orange"
            : "translate-x-0 bg-white/80"
        }`}
      />
    </button>
  );
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
  const { setMode, isExpert } = useUiMode();
  const { profile } = useUserContext();
  const tenantRole = profile?.tenant_role ?? null;

  const [collapsed, setCollapsed] = useState(false);
  const [hasLoadedCollapsedPreference, setHasLoadedCollapsedPreference] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Determine active shortcut context from current route
  const shortcutContext = useMemo(() => {
    if (/\/dashboard\/estimates\/[^/]+\/edit/.test(pathname)) return "editor" as const;
    return "navigation" as const;
  }, [pathname]);

  // Global listener for "?" key to open shortcuts modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEditingTarget(e.target)) return;
      e.preventDefault();
      setShortcutsOpen(true);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
  const navGroups = useMemo(
    () =>
      buildNavGroups({
        role: tenantRole,
        uiMode: isExpert ? "expert" : "simplified",
        featureFlags: {
          takeoffEnabled: takeoffStatus === "ready" && isTakeoffEnabled,
        },
      }),
    [tenantRole, isExpert, takeoffStatus, isTakeoffEnabled]
  );

  function isActive(href: string) {
    if (href === "/dashboard/affaires") {
      return (
        pathname.startsWith("/dashboard/affaires") ||
        pathname.startsWith("/dashboard/estimates")
      );
    }
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
                      title={collapsed ? item.label : item.title}
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
          {/* Keyboard shortcuts button */}
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white/90"
            onClick={() => setShortcutsOpen(true)}
            title="Raccourcis clavier"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01" />
              <path d="M10 8h.01" />
              <path d="M14 8h.01" />
              <path d="M18 8h.01" />
              <path d="M8 12h.01" />
              <path d="M12 12h.01" />
              <path d="M16 12h.01" />
              <path d="M7 16h10" />
            </svg>
            <span className="sidebar-label">Raccourcis</span>
            <kbd className="sidebar-label ml-auto rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/50">
              ?
            </kbd>
          </button>

          <div className={`flex items-center rounded-xl bg-white/5 transition-all duration-200 ${
            collapsed ? "flex-col gap-2 p-2" : "gap-3 p-3"
          }`}>
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
                <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors duration-200 ${
                  isExpert
                    ? "bg-brand-orange/20 text-brand-orange-light"
                    : "bg-white/10 text-white/70"
                }`}>
                  {isExpert ? "Expert" : "Simplifié"}
                </span>
              </div>
            </Link>
            <ModeToggleSwitch
              isExpert={isExpert}
              onToggle={() => setMode(isExpert ? "simplified" : "expert")}
            />
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

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        activeContext={shortcutContext}
      />
    </div>
  );
}

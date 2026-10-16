"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SignOutButton } from "@/components/SignOutButton";
import { TimaxMark, TimaxWordmark } from "@/components/brand/timax-logo";
import { useUserContext } from "@/components/UserContext";
import { DashboardNavigationProvider } from "@/components/dashboard/DashboardNavigationContext";
import { WorkspaceGlobalNavigation } from "@/components/dashboard/WorkspaceGlobalNavigation";
import { KeyboardShortcutsModal } from "@/components/ui-legacy/KeyboardShortcutsModal";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { setLastAffaire, useLastAffaireId } from "@/hooks/useLastAffaireContext";
import { useTakeoffEnabled } from "@/hooks/useTakeoffEnabled";
import { useUiMode } from "@/hooks/useUiMode";
import { buildNavGroups } from "@/lib/navigation/build-nav-groups";
import { isDashboardNavItemActive } from "@/lib/navigation/dashboard-nav-active";
import { isProductionWorkspaceRoute } from "@/lib/navigation/dashboard-navigation-mode";
import { initStore } from "@/lib/stores/last-affaire-store";
import { KeyboardIcon, XIcon } from "lucide-react";

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

const DRAWER_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");



function buildInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "..";
  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function getAffaireIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/affaires\/([^/]+)/);
  return match?.[1] ?? null;
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
      className="sidebar-mode-toggle group relative flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-white/20 bg-white/10 p-0.5 transition-colors duration-200 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 focus-visible:outline-offset-2"
    >
      {/* Track labels */}
      <span className="sidebar-mode-toggle__labels absolute inset-0 flex items-center justify-between px-1.5 text-[9px] font-bold uppercase tracking-wider">
        <span className={`transition-opacity duration-200 ${isExpert ? "opacity-0" : "opacity-60 text-white"}`}>S</span>
        <span className={`transition-opacity duration-200 ${isExpert ? "opacity-60 text-white" : "opacity-0"}`}>E</span>
      </span>
      {/* Sliding thumb */}
      <span
        className={`sidebar-mode-toggle__thumb pointer-events-none relative z-10 h-5 w-5 rounded-full shadow-md transition-all duration-200 ease-in-out ${
          isExpert
            ? "translate-x-5 bg-brand-orange"
            : "translate-x-0 bg-surface/80"
        }`}
      />
    </button>
  );
}

export function DashboardShell({
  appBuildId,
  appVersion,
  children,
  displayName,
  tenantName = null,
}: Readonly<{
  appBuildId: string | null;
  appVersion: string;
  children: React.ReactNode;
  displayName: string;
  /** Active organisation, shown next to the product name. */
  tenantName?: string | null;
}>) {
  const pathname = usePathname();
  // The navigation is always the workspace top bar + drawer (see dashboard-navigation-mode.ts).
  const navigationMode = "workspace" as const;
  const isProductionWorkspace = isProductionWorkspaceRoute(pathname);
  const userInitials = buildInitials(displayName);
  const { enabled: isSidebarFlagIndicatorEnabled } = useFeatureFlag(
    "FEATURE_FLAGS_SIDEBAR_INDICATOR"
  );
  const { status: takeoffStatus, enabled: isTakeoffEnabled } = useTakeoffEnabled();
  const { setMode, isExpert } = useUiMode();
  const { profile } = useUserContext();
  const tenantRole = profile?.tenant_role ?? null;
  const lastAffaireId = useLastAffaireId();
  const currentAffaireId = useMemo(
    () => getAffaireIdFromPathname(pathname),
    [pathname]
  );

  useLayoutEffect(() => {
    initStore(profile?.id ?? null);
  }, [profile?.id]);

  useLayoutEffect(() => {
    if (!currentAffaireId) {
      return;
    }

    setLastAffaire(currentAffaireId, profile?.id ?? null);
  }, [currentAffaireId, profile?.id]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const previousPathnameRef = useRef(pathname);

  // Determine active shortcut context from current route
  const shortcutContext = useMemo(() => {
    if (/\/dashboard\/estimates\/[^/]+\/edit/.test(pathname)) return "editor" as const;
    return "navigation" as const;
  }, [pathname]);

  const density = useMemo(() => {
    if (/\/estimates\/[^/]+/.test(pathname) || pathname.startsWith("/dashboard/takeoff")) {
      return "compact" as const;
    }
    return "comfortable" as const;
  }, [pathname]);

  // Global listener for "?" key to open shortcuts modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (drawerOpen) return;
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEditingTarget(e.target)) return;
      e.preventDefault();
      setShortcutsOpen(true);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback((restoreFocus = false) => {
    setDrawerOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const drawer = sidebarRef.current;
    const mainContent = mainContentRef.current;
    const topbar = topbarRef.current;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => {
      drawerCloseButtonRef.current?.focus();
    });
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer(true);
        return;
      }

      if (event.key !== "Tab" || !drawer) {
        return;
      }

      const focusableElements = Array.from(
        drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR)
      );
      const firstFocusable =
        drawerCloseButtonRef.current ?? focusableElements[0];
      const lastFocusable = focusableElements.at(-1);

      if (!firstFocusable || !lastFocusable) {
        event.preventDefault();
        drawerCloseButtonRef.current?.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.body.style.overflow = "hidden";
    mainContent?.setAttribute("inert", "");
    topbar?.setAttribute("inert", "");
    document.addEventListener("keydown", handleDrawerKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      mainContent?.removeAttribute("inert");
      topbar?.removeAttribute("inert");
      document.removeEventListener("keydown", handleDrawerKeyDown);
    };
  }, [closeDrawer, drawerOpen]);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) {
      return;
    }

    previousPathnameRef.current = pathname;
    setDrawerOpen(false);
    window.requestAnimationFrame(() => {
      mainContentRef.current?.focus({ preventScroll: true });
    });
  }, [pathname]);

  const navGroups = useMemo(
    () =>
      buildNavGroups({
        role: tenantRole,
        uiMode: isExpert ? "expert" : "simplified",
        featureFlags: {
          takeoffEnabled: takeoffStatus === "ready" && isTakeoffEnabled,
        },
        lastAffaireId,
      }),
    [tenantRole, isExpert, takeoffStatus, isTakeoffEnabled, lastAffaireId]
  );
  const navigationContextValue = useMemo(
    () => ({
      mode: navigationMode,
      pathname,
      drawerOpen,
      menuButtonRef,
      openDrawer,
      groups: navGroups,
    }),
    [drawerOpen, navigationMode, navGroups, openDrawer, pathname]
  );

  function isActive(href: string) {
    return isDashboardNavItemActive(pathname, href);
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      data-navigation-mode={navigationMode}
    >
      <a
        href="#dashboard-main-content"
        className="sr-only fixed left-3 top-3 z-[70] rounded-lg bg-surface px-4 py-3 font-semibold text-primary shadow-lg focus:not-sr-only focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        Aller au contenu principal
      </a>

      {/* Keep this provider around the header only. Its value changes right after
          hydration (last affaire, feature flags); React client-renders a streamed
          page boundary still waiting for its reveal under a changed provider and
          briefly keeps both copies in the document. */}
      <DashboardNavigationProvider value={navigationContextValue}>
      <header ref={topbarRef} className="no-print dashboard-global-topbar">
        <Link
          href="/dashboard"
          prefetch={false}
          className="dashboard-global-topbar__brand"
          aria-label={`TIMAX${tenantName ? ` — ${tenantName}` : ""} — Accueil`}
        >
          <TimaxWordmark tenantName={tenantName} tenantClassName="hidden xl:inline" />
        </Link>

        <WorkspaceGlobalNavigation />

        <div className="dashboard-global-topbar__tools">
          <button
            type="button"
            className="dashboard-global-topbar__tool"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Afficher les raccourcis clavier"
            title="Raccourcis clavier"
          >
            <KeyboardIcon strokeWidth="1.75" aria-hidden="true" size={18} />
          </button>
          <Link
            href="/dashboard/profile"
            prefetch={false}
            className="dashboard-global-topbar__profile"
            aria-label={`Ouvrir le profil de ${displayName || "Compte"}`}
            title={displayName || "Compte"}
          >
            {userInitials}
          </Link>
        </div>
      </header>
      </DashboardNavigationProvider>
      {/* Drawer backdrop. */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-[55] bg-black/40"
          onClick={() => closeDrawer(true)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        ref={sidebarRef}
        id="dashboard-sidebar"
        data-mobile-open={drawerOpen ? "true" : undefined}
        data-drawer-open={drawerOpen ? "true" : undefined}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? "true" : undefined}
        aria-label={drawerOpen ? "Navigation principale" : undefined}
        className="no-print dashboard-sidebar dashboard-sidebar--overlay fixed left-0 top-0 z-[60] flex h-screen flex-col"
      >
        <div className="flex h-20 items-center px-6 mt-2 sidebar-header">
          <Link
            href="/dashboard"
            prefetch={false}
            className="sidebar-logo-link flex items-center gap-3 min-w-0"
            onClick={() => setDrawerOpen(false)}
          >
            <TimaxMark className="size-10 rounded-xl text-lg" />
            <div className="sidebar-label min-w-0">
              <span className="block font-display text-base font-extrabold tracking-tight text-white">TIMAX</span>
              <span className="block truncate text-micro font-medium text-white/60">
                {tenantName ?? "Chiffrage BTP"}
              </span>
              {isSidebarFlagIndicatorEnabled ? (
                <span className="mt-1 inline-flex items-center rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
                  Fonctionnalités actives
                </span>
              ) : null}
            </div>
          </Link>
          <button
            ref={drawerCloseButtonRef}
            type="button"
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={() => closeDrawer(true)}
            aria-label="Fermer le menu"
          >
            <XIcon aria-hidden="true" size={20} />
          </button>
        </div>
        <nav
          className="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          aria-label="Menu principal"
        >
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
                      key={item.navId ?? item.href}
                      href={item.href}
                      prefetch={false}
                      className={`sidebar-nav-item ${active ? "active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      title={item.title}
                      onClick={() => {
                        if (drawerOpen) {
                          closeDrawer(active);
                        }
                      }}
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

        <div className="sidebar-footer shrink-0 border-t border-white/10 p-4">
          {/* Keyboard shortcuts button */}
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white/90"
            onClick={() => {
              setDrawerOpen(false);
              setShortcutsOpen(true);
            }}
            title="Raccourcis clavier"
          >
            <KeyboardIcon aria-hidden="true" strokeWidth="1.75" className="shrink-0" size={16} />
            <span className="sidebar-label">Raccourcis</span>
            <kbd className="sidebar-label ml-auto rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-micro font-medium text-white/50">
              ?
            </kbd>
          </button>

          <div className="sidebar-footer-profile flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <Link
              href="/dashboard/profile"
              prefetch={false}
              className="flex flex-1 items-center gap-3 min-w-0 rounded-lg -m-1.5 p-1.5 transition-colors hover:bg-white/5"
              onClick={() => setDrawerOpen(false)}
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
        ref={mainContentRef}
        id="dashboard-main-content"
        tabIndex={-1}
        data-density={density}
        className="min-w-0 min-h-0 flex-1 focus:outline-none"
      >
        <div
          className={`mx-auto w-full px-3 pb-6 sm:px-6 sm:pb-8 ${
            isProductionWorkspace
              ? "dashboard-workspace-content pt-0"
              : "py-6 sm:py-8"
          }`}
        >
          {children}
        </div>
        <footer className="no-print mx-auto w-full px-3 pb-4 text-right text-micro font-medium tracking-wide text-subtle-foreground sm:px-6">
          <p
            role="note"
            aria-label={`Version de l'application ${appVersion}${
              appBuildId ? `, build ${appBuildId}` : ""
            }`}
          >
            {`v${appVersion}${appBuildId ? ` · ${appBuildId}` : ""}`}
          </p>
        </footer>
      </main>

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        activeContext={shortcutContext}
      />
    </div>
  );
}

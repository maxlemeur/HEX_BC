"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  subscribe as subscribeCockpit,
  getSnapshot as getCockpitSnapshot,
  getServerSnapshot as getCockpitServerSnapshot,
} from "@/lib/stores/cockpit-suggestions-store";

import { useUserContext } from "@/components/UserContext";
import { useLastAffaireId } from "@/hooks/useLastAffaireContext";
import { useTakeoffEnabled } from "@/hooks/useTakeoffEnabled";
import { useUiMode } from "@/hooks/useUiMode";
import {
  buildNavGroups,
  type BuildNavGroupsInput,
  type NavGroup as SidebarNavGroup,
} from "@/lib/navigation/build-nav-groups";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandItem = {
  id: string;
  group: "recent" | "actions" | "navigation";
  label: string;
  description?: string;
  keywords?: string[];
  href?: string;
  action?: () => void;
};

export type CommandGroup = {
  key: CommandItem["group"];
  label: string;
  items: CommandItem[];
};

// ---------------------------------------------------------------------------
// Nav + action items
// ---------------------------------------------------------------------------

const NAVIGATION_KEYWORDS_BY_HREF: Readonly<Record<string, string[]>> = {
  "/dashboard/affaires": ["affaire", "project", "projet", "chiffrage", "devis"],
  "/dashboard/takeoff": ["takeoff", "metre", "plan"],
  "/dashboard/orders": ["order", "commande", "bon"],
  "/dashboard/referentiel": ["referentiel", "produit", "catalogue", "fournisseur"],
  "/dashboard/tarifs": ["tarif", "prix", "price", "indice"],
  "/dashboard/admin": ["admin", "parametres", "settings", "tenant"],
  "/dashboard/analytics": ["analytics", "tableau", "bord", "dashboard", "kpi", "statistiques"],
  "/dashboard/profile": ["profile", "profil", "compte"],
};

const NAVIGATION_KEYWORDS_BY_NAVID: Readonly<Record<string, string[]>> = {
  takeoff: ["takeoff", "metre", "plan", "extraction"],
};

const PROFILE_NAV_ITEM: CommandItem = {
  id: "nav-profile",
  group: "navigation",
  label: "Mon profil",
  keywords: NAVIGATION_KEYWORDS_BY_HREF["/dashboard/profile"],
  href: "/dashboard/profile",
};

const ACTION_ITEMS: CommandItem[] = [
  {
    id: "action-new-order",
    group: "actions",
    label: "Nouveau bon de commande",
    keywords: ["creer", "nouveau", "commande", "order"],
    href: "/dashboard/orders/new",
  },
  {
    id: "action-new-estimate",
    group: "actions",
    label: "Nouveau chiffrage",
    keywords: ["creer", "nouveau", "chiffrage", "estimate", "devis"],
    href: "/dashboard/estimates/new",
  },
];

function toNavigationItemId(href: string) {
  const normalized = href.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return `nav-${normalized}`;
}

export function buildNavigationItemsFromNavGroups(
  navGroups: SidebarNavGroup[]
): CommandItem[] {
  const navigationItems: CommandItem[] = navGroups.flatMap((group) =>
    group.items.map((item) => {
      const keywords = item.navId
        ? NAVIGATION_KEYWORDS_BY_NAVID[item.navId]
        : NAVIGATION_KEYWORDS_BY_HREF[item.href];
      return {
        id: toNavigationItemId(item.navId ?? item.href),
        group: "navigation" as const,
        label: item.label,
        keywords: keywords ?? [],
        href: item.href,
      };
    })
  );

  navigationItems.push(PROFILE_NAV_ITEM);

  return navigationItems;
}

export function buildNavigationItems(input: BuildNavGroupsInput): CommandItem[] {
  return buildNavigationItemsFromNavGroups(buildNavGroups(input));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECENTS_KEY = "command-palette-recents";
const MAX_RECENTS = 5;

export function fuzzyMatch(query: string, item: CommandItem): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const target = [item.label, item.description ?? "", ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => target.includes(term));
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
    return true;
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

function loadRecents(allItems: CommandItem[]): CommandItem[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const ids: string[] = JSON.parse(raw);
    return ids
      .map((id) => allItems.find((item) => item.id === id))
      .filter((item): item is CommandItem => item != null)
      .map((item) => ({ ...item, group: "recent" as const }));
  } catch {
    return [];
  }
}

function saveRecent(id: string) {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const next = [id, ...ids.filter((i) => i !== id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { profile } = useUserContext();
  const { isExpert } = useUiMode();
  const { status: takeoffStatus, enabled: isTakeoffEnabled } = useTakeoffEnabled();
  const tenantRole = profile?.tenant_role ?? null;
  const lastAffaireId = useLastAffaireId();

  const navigationItems = useMemo(
    () =>
      buildNavigationItems({
        role: tenantRole,
        uiMode: isExpert ? "expert" : "simplified",
        featureFlags: {
          takeoffEnabled: takeoffStatus === "ready" && isTakeoffEnabled,
        },
        lastAffaireId,
      }),
    [tenantRole, isExpert, takeoffStatus, isTakeoffEnabled, lastAffaireId]
  );
  const cockpitSuggestions = useSyncExternalStore(
    subscribeCockpit,
    getCockpitSnapshot,
    getCockpitServerSnapshot
  );

  const allItems = useMemo(() => {
    const contextualActions: CommandItem[] = cockpitSuggestions.map((s) => ({
      id: `cockpit-${s.actionId}`,
      group: "actions" as const,
      label: s.label,
      description: s.preview,
      keywords: ["cockpit", s.intent.replace(/_/g, " ")],
      ...(s.target.kind === "navigate"
        ? { href: s.target.href }
        : {
            action: () =>
              document.dispatchEvent(
                new CustomEvent("cockpit-open-dialog", {
                  detail: s.target.kind === "open_dialog"
                    ? s.target.dialogId
                    : undefined,
                })
              ),
          }),
    }));
    return [...ACTION_ITEMS, ...contextualActions, ...navigationItems];
  }, [navigationItems, cockpitSuggestions]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<CommandItem[]>([]);

  // Reset state when opening
  const openPalette = useCallback(() => {
    setRecents(loadRecents(allItems));
    setQuery("");
    setSelectedIndex(0);
    setOpen(true);
  }, [allItems]);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  // Build filtered + grouped results
  const groups: CommandGroup[] = useMemo(() => {
    const filtered = query
      ? allItems.filter((item) => fuzzyMatch(query, item))
      : allItems;

    const result: CommandGroup[] = [];

    // Recents only when no query
    if (!query && recents.length > 0) {
      result.push({ key: "recent", label: "Récents", items: recents });
    }

    const actions = filtered.filter((i) => i.group === "actions");
    if (actions.length > 0) {
      result.push({ key: "actions", label: "Actions", items: actions });
    }

    const navigation = filtered.filter((i) => i.group === "navigation");
    if (navigation.length > 0) {
      result.push({
        key: "navigation",
        label: "Navigation",
        items: navigation,
      });
    }

    return result;
  }, [query, recents, allItems]);

  // Flat list for keyboard nav
  const flatItems = useMemo(
    () => groups.flatMap((g) => g.items),
    [groups]
  );

  // Clamp selected index to valid range
  const clampedSelectedIndex =
    flatItems.length === 0 ? 0 : Math.min(selectedIndex, flatItems.length - 1);

  // Execute an item
  const execute = useCallback(
    (item: CommandItem) => {
      closePalette();
      saveRecent(item.id);

      if (item.action) {
        item.action();
      } else if (item.href) {
        router.push(item.href);
      }
    },
    [router, closePalette]
  );

  // Selected item ref for scrollIntoView
  const selectedRef = useRef<HTMLElement | null>(null);

  // Global keyboard listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        if (!open && isTextEditingTarget(e.target)) return;
        e.preventDefault();
        if (open) {
          closePalette();
        } else {
          openPalette();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, openPalette, closePalette]);

  // Palette-internal keyboard handler (called from component)
  const handlePaletteKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          flatItems.length === 0 ? 0 : (prev + 1) % flatItems.length
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          flatItems.length === 0
            ? 0
            : (prev - 1 + flatItems.length) % flatItems.length
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[clampedSelectedIndex];
        if (item) execute(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    },
    [flatItems, clampedSelectedIndex, execute, closePalette]
  );

  return {
    open,
    setOpen: closePalette,
    query,
    setQuery,
    selectedIndex: clampedSelectedIndex,
    setSelectedIndex,
    groups,
    flatItems,
    execute,
    handlePaletteKeyDown,
    selectedRef,
    pathname,
  };
}

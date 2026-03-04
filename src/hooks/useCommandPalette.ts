"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

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
// Nav items (mirrors DashboardShell NAV_GROUPS without importing icons)
// ---------------------------------------------------------------------------

const NAVIGATION_ITEMS: CommandItem[] = [
  {
    id: "nav-estimates",
    group: "navigation",
    label: "Chiffrages",
    keywords: ["estimate", "devis", "chiffrage"],
    href: "/dashboard/estimates",
  },
  {
    id: "nav-imports",
    group: "navigation",
    label: "Imports DPGF",
    keywords: ["import", "dpgf", "decomposition", "prix"],
    href: "/dashboard/imports",
  },
  {
    id: "nav-mappings",
    group: "navigation",
    label: "Mappings",
    keywords: ["mapping", "correspondance"],
    href: "/dashboard/mappings",
  },
  {
    id: "nav-orders",
    group: "navigation",
    label: "Bons de commande",
    keywords: ["order", "commande", "bon"],
    href: "/dashboard/orders",
  },
  {
    id: "nav-referentiel",
    group: "navigation",
    label: "Référentiel",
    keywords: ["referentiel", "produit", "catalogue", "fournisseur"],
    href: "/dashboard/referentiel",
  },
  {
    id: "nav-tarifs",
    group: "navigation",
    label: "Tarifs",
    keywords: ["tarif", "prix", "price", "indice"],
    href: "/dashboard/tarifs",
  },
  {
    id: "nav-admin",
    group: "navigation",
    label: "Administration",
    keywords: ["admin", "parametres", "settings", "tenant"],
    href: "/dashboard/admin",
  },
  {
    id: "nav-takeoff",
    group: "navigation",
    label: "Métrés plans",
    keywords: ["takeoff", "metre", "plan"],
    href: "/dashboard/takeoff",
  },
  {
    id: "nav-profile",
    group: "navigation",
    label: "Mon profil",
    keywords: ["profile", "profil", "compte"],
    href: "/dashboard/profile",
  },
];

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
  {
    id: "action-new-import",
    group: "actions",
    label: "Nouvel import DPGF",
    keywords: ["importer", "dpgf", "nouveau"],
    href: "/dashboard/imports/new",
  },
];

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

function loadRecents(): CommandItem[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const ids: string[] = JSON.parse(raw);
    const all = [...ACTION_ITEMS, ...NAVIGATION_ITEMS];
    return ids
      .map((id) => all.find((item) => item.id === id))
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<CommandItem[]>([]);

  // Reset state when opening
  const openPalette = useCallback(() => {
    setRecents(loadRecents());
    setQuery("");
    setSelectedIndex(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  // Build filtered + grouped results
  const groups: CommandGroup[] = useMemo(() => {
    const allItems = [...ACTION_ITEMS, ...NAVIGATION_ITEMS];
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
  }, [query, recents]);

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

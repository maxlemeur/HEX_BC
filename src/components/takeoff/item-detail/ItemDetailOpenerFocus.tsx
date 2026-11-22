"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { itemTableAddressParams, readItemTableAddress, withItemTableParams } from "@/lib/takeoff/item-table-query";
import { withoutTakeoffItemDetail } from "@/lib/takeoff/review-href";

/**
 * The line whose « Détail » opened the detail of an item (lot 5 follow-ups). The browser's back returns to the table's
 * address as it was when the line was opened: its `posteFocus` may name another line (the one a previous return named).
 * The detail remembers its opener for that address (the tab's storage, by member and affaire: another member in the same
 * tab neither takes nor uses it); the table shown again for that same address gives the keyboard back to the opener's
 * « Détail » — only from the line the address named, never from another line the member focused — and names it in the
 * address. « Revenir aux postes » forgets it: that return names the item last shown itself.
 */

const PREFIX = "poste";
const key = (projectId: string, viewerKey: string) => `metre-detail-ouvreur:${viewerKey}:${projectId}`;
/** A table's address compared without the detail's parameters and in a stable order. */
const tableKey = (query: string | URLSearchParams) => {
  const params = [...withoutTakeoffItemDetail(query).entries()].sort(([left, a], [right, b]) =>
    left === right ? a.localeCompare(b) : left.localeCompare(right));
  return new URLSearchParams(params).toString();
};

export function rememberItemDetailOpener(projectId: string, viewerKey: string, query: string | URLSearchParams, itemId: string) {
  try {
    window.sessionStorage.setItem(key(projectId, viewerKey), JSON.stringify({ table: tableKey(query), itemId }));
  } catch {
    // A tab without storage gives the keyboard back as the address says.
  }
}

export function forgetItemDetailOpener(projectId: string, viewerKey: string) {
  try {
    window.sessionStorage.removeItem(key(projectId, viewerKey));
  } catch {
    // Nothing kept.
  }
}

/** The opener remembered for this table's address, forgotten once read; null for another address or none. */
export function takeItemDetailOpener(projectId: string, viewerKey: string, query: string | URLSearchParams) {
  try {
    const stored = window.sessionStorage.getItem(key(projectId, viewerKey));
    if (!stored) return null;
    window.sessionStorage.removeItem(key(projectId, viewerKey));
    const opener = JSON.parse(stored) as { table?: unknown; itemId?: unknown };
    return opener.table === tableKey(query) && typeof opener.itemId === "string" ? opener.itemId : null;
  } catch {
    return null;
  }
}

/** How long the table's lines may take to be read before the keyboard is left where the table put it. */
const WAIT_MS = 15_000;

/**
 * Beside the table of items: once its lines are drawn, the keyboard goes to the opener's « Détail » (when nothing holds
 * it, or another line's « Détail » the address named does), and the address names the opener.
 */
export function ItemDetailOpenerFocus({ projectId, viewerKey }: { projectId: string; viewerKey: string }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const opener = takeItemDetailOpener(projectId, viewerKey, window.location.search);
    if (!opener) return;
    // The line the address names: the one the table gives the keyboard back to, which the opener takes over.
    const named = readItemTableAddress(new URLSearchParams(window.location.search), PREFIX).focusItemId;
    const restored = (element: Element) => Boolean(named) && element.closest(`[id="poste-ligne-${named}"]`) !== null;
    const linkOf = () => document.getElementById(`poste-ligne-${opener}`)?.querySelector<HTMLElement>("[data-poste-detail-link]") ?? null;
    let done = false;
    const give = () => {
      const link = linkOf();
      if (!link || done) return false;
      done = true;
      const focused = document.activeElement;
      // Nothing holds the keyboard, or the table gave it to the line the address named: not a line the member focused.
      const free = !focused || focused === document.body || (focused instanceof HTMLElement
        && focused.matches("[data-poste-detail-link]") && restored(focused));
      if (free) {
        link.focus({ preventScroll: true });
        link.closest("tr")?.scrollIntoView?.({ block: "center" });
      }
      const next = withItemTableParams(window.location.search, itemTableAddressParams({ focusItemId: opener }, PREFIX)).toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
      return true;
    };
    if (give()) return;
    const observer = new MutationObserver(() => {
      if (give()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pathname, projectId, router, viewerKey]);
  return null;
}

"use client";

import { useEffect, useRef } from "react";

import { shouldBlockBeforeUnload } from "@/hooks/useAutoSave";

type NavigationClickLikeEvent = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

export type GuardedAnchorNavigationInput = {
  currentHref: string;
  destinationHref: string;
  target?: string | null;
  hasDownloadAttribute?: boolean;
};

export type UseAutoSaveNavigationGuardOptions = {
  enabled: boolean;
  hasPendingChanges: boolean;
  isSaving: boolean;
  onBlockedNavigation: () => void;
  onBeforeNavigation?: () => Promise<boolean>;
  onNavigate?: (href: string) => void;
};

function resolvePathnameAndSearch(url: URL) {
  return `${url.pathname}${url.search}`;
}

export function shouldBlockInternalNavigation(
  hasPendingChanges: boolean,
  isSaving: boolean
) {
  return shouldBlockBeforeUnload(hasPendingChanges, isSaving);
}

export function isPrimaryNavigationClick(event: NavigationClickLikeEvent) {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function shouldGuardAnchorNavigation({
  currentHref,
  destinationHref,
  target,
  hasDownloadAttribute = false,
}: GuardedAnchorNavigationInput) {
  if (hasDownloadAttribute) return false;
  if (target && target !== "_self") return false;

  try {
    const currentUrl = new URL(currentHref);
    const destinationUrl = new URL(destinationHref, currentUrl);

    if (destinationUrl.origin !== currentUrl.origin) return false;
    return (
      resolvePathnameAndSearch(destinationUrl) !==
      resolvePathnameAndSearch(currentUrl)
    );
  } catch {
    return false;
  }
}

function resolveAnchorFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

function currentHistoryIndex(): number | null {
  const navigation = (window as Window & {
    navigation?: { currentEntry?: { index: number } | null };
  }).navigation;
  const index = navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : null;
}

export function useAutoSaveNavigationGuard({
  enabled,
  hasPendingChanges,
  isSaving,
  onBlockedNavigation,
  onBeforeNavigation,
  onNavigate,
}: UseAutoSaveNavigationGuardOptions) {
  const shouldBlockNavigationRef = useRef(false);
  const onBlockedNavigationRef = useRef(onBlockedNavigation);
  const guardedHrefRef = useRef("");
  const guardedHistoryStateRef = useRef<unknown>(null);
  const guardedHistoryIndexRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onBeforeNavigation, onNavigate });

  useEffect(() => {
    shouldBlockNavigationRef.current =
      enabled && shouldBlockInternalNavigation(hasPendingChanges, isSaving);
  }, [enabled, hasPendingChanges, isSaving]);

  useEffect(() => {
    onBlockedNavigationRef.current = onBlockedNavigation;
    callbacksRef.current = { onBeforeNavigation, onNavigate };
  }, [onBlockedNavigation, onBeforeNavigation, onNavigate]);

  useEffect(() => {
    if (!enabled) return;
    guardedHrefRef.current = window.location.href;
    guardedHistoryStateRef.current = window.history.state;
    guardedHistoryIndexRef.current = currentHistoryIndex();
  }, [enabled, hasPendingChanges, isSaving]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let preparingNavigation = false;
    let restoringTraversal: { originIndex: number; delta: number; href: string } | null = null;
    let bypassNextTraversal = false;
    const saveAndNavigate = async (href: string, resume?: () => void) => {
      if (preparingNavigation) return;
      const { onBeforeNavigation: prepare, onNavigate: navigate } = callbacksRef.current;
      if (!prepare || (!resume && !navigate)) {
        onBlockedNavigationRef.current();
        return;
      }
      preparingNavigation = true;
      const originHref = window.location.href;
      try {
        const saved = await prepare();
        if (!active || window.location.href !== originHref) return;
        if (saved) {
          if (resume) resume();
          else navigate?.(href);
        }
        else onBlockedNavigationRef.current();
      } catch {
        if (active) onBlockedNavigationRef.current();
      } finally {
        preparingNavigation = false;
      }
    };
    const handleClickCapture = (event: MouseEvent) => {
      const anchor = resolveAnchorFromTarget(event.target);
      if (!anchor) return;
      if (!isPrimaryNavigationClick(event)) return;
      if (
        !shouldGuardAnchorNavigation({
          currentHref: window.location.href,
          destinationHref: anchor.href,
          target: anchor.target,
          hasDownloadAttribute: anchor.hasAttribute("download"),
        })
      ) {
        return;
      }
      if (!shouldBlockNavigationRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      if (restoringTraversal) return;
      void saveAndNavigate(anchor.href);
    };

    const handlePopStateCapture = (event: PopStateEvent) => {
      const guardedHref = guardedHrefRef.current;
      if (!guardedHref) return;
      const index = currentHistoryIndex();
      if (bypassNextTraversal) {
        bypassNextTraversal = false;
        guardedHrefRef.current = window.location.href;
        guardedHistoryStateRef.current = window.history.state;
        guardedHistoryIndexRef.current = index;
        return;
      }
      if (restoringTraversal) {
        event.stopImmediatePropagation();
        const traversal = restoringTraversal;
        if (index !== traversal.originIndex) {
          if (index !== null) window.history.go(traversal.originIndex - index);
          return;
        }
        restoringTraversal = null;
        void saveAndNavigate(traversal.href, () => {
          bypassNextTraversal = true;
          window.history.go(traversal.delta);
        });
        return;
      }

      if (!shouldBlockNavigationRef.current) {
        guardedHrefRef.current = window.location.href;
        guardedHistoryStateRef.current = window.history.state;
        guardedHistoryIndexRef.current = index;
        return;
      }

      if (
        !shouldGuardAnchorNavigation({
          currentHref: guardedHref,
          destinationHref: window.location.href,
        })
      ) {
        guardedHrefRef.current = window.location.href;
        guardedHistoryStateRef.current = window.history.state;
        guardedHistoryIndexRef.current = index;
        return;
      }

      event.stopImmediatePropagation();
      const destinationHref = window.location.href;
      const originIndex = guardedHistoryIndexRef.current;
      if (index !== null && originIndex !== null && index !== originIndex) {
        // Restore and replay the actual Back/Forward traversal. No new entry is
        // added, and Next receives only the successfully saved traversal.
        restoringTraversal = { originIndex, delta: index - originIndex, href: destinationHref };
        window.history.go(originIndex - index);
        return;
      }
      // Older browsers lack history indices. Preserve the guarded page and
      // resume the restored destination with Back instead of pushing it again.
      window.history.pushState(
        guardedHistoryStateRef.current,
        "",
        guardedHref
      );
      void saveAndNavigate(destinationHref, () => {
        bypassNextTraversal = true;
        window.history.back();
      });
    };

    document.addEventListener("click", handleClickCapture, true);
    window.addEventListener("popstate", handlePopStateCapture, true);

    return () => {
      active = false;
      document.removeEventListener("click", handleClickCapture, true);
      window.removeEventListener("popstate", handlePopStateCapture, true);
    };
  }, [enabled]);
}

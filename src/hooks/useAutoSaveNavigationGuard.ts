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

export function useAutoSaveNavigationGuard({
  enabled,
  hasPendingChanges,
  isSaving,
  onBlockedNavigation,
}: UseAutoSaveNavigationGuardOptions) {
  const shouldBlockNavigationRef = useRef(false);
  const onBlockedNavigationRef = useRef(onBlockedNavigation);
  const guardedHrefRef = useRef("");
  const guardedHistoryStateRef = useRef<unknown>(null);

  useEffect(() => {
    shouldBlockNavigationRef.current =
      enabled && shouldBlockInternalNavigation(hasPendingChanges, isSaving);
  }, [enabled, hasPendingChanges, isSaving]);

  useEffect(() => {
    onBlockedNavigationRef.current = onBlockedNavigation;
  }, [onBlockedNavigation]);

  useEffect(() => {
    if (!enabled) return;
    guardedHrefRef.current = window.location.href;
    guardedHistoryStateRef.current = window.history.state;
  }, [enabled, hasPendingChanges, isSaving]);

  useEffect(() => {
    if (!enabled) return;

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
      onBlockedNavigationRef.current();
    };

    const handlePopStateCapture = (event: PopStateEvent) => {
      const guardedHref = guardedHrefRef.current;
      if (!guardedHref) return;

      if (!shouldBlockNavigationRef.current) {
        guardedHrefRef.current = window.location.href;
        guardedHistoryStateRef.current = window.history.state;
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
        return;
      }

      event.stopImmediatePropagation();
      onBlockedNavigationRef.current();
      window.history.pushState(
        guardedHistoryStateRef.current,
        "",
        guardedHref
      );
    };

    document.addEventListener("click", handleClickCapture, true);
    window.addEventListener("popstate", handlePopStateCapture, true);

    return () => {
      document.removeEventListener("click", handleClickCapture, true);
      window.removeEventListener("popstate", handlePopStateCapture, true);
    };
  }, [enabled]);
}

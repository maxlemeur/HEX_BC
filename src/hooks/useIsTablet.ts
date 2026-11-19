"use client";

import { useSyncExternalStore } from "react";

const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";
const WIDE_VIEWPORT_QUERY = "(min-width: 1280px)";

function createMediaQueryStore(query: string) {
  return {
    getSnapshot: () => window.matchMedia(query).matches,
    subscribe: (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
  };
}

function getServerSnapshot(): boolean {
  return false;
}

const mobileViewportStore = createMediaQueryStore(MOBILE_VIEWPORT_QUERY);
const wideViewportStore = createMediaQueryStore(WIDE_VIEWPORT_QUERY);

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    mobileViewportStore.subscribe,
    mobileViewportStore.getSnapshot,
    getServerSnapshot,
  );
}

export function useIsWideViewport(): boolean {
  return useSyncExternalStore(
    wideViewportStore.subscribe,
    wideViewportStore.getSnapshot,
    getServerSnapshot,
  );
}

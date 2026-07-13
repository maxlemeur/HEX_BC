"use client";

import { useSyncExternalStore } from "react";

const TABLET_QUERY = "(min-width: 768px) and (max-width: 1024px)";
const COMPACT_VIEWPORT_QUERY = "(max-width: 1024px)";

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

const tabletStore = createMediaQueryStore(TABLET_QUERY);
const compactViewportStore = createMediaQueryStore(COMPACT_VIEWPORT_QUERY);

export function useIsTablet(): boolean {
  return useSyncExternalStore(
    tabletStore.subscribe,
    tabletStore.getSnapshot,
    getServerSnapshot
  );
}

export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(
    compactViewportStore.subscribe,
    compactViewportStore.getSnapshot,
    getServerSnapshot
  );
}

"use client";

import { useSyncExternalStore } from "react";

const TABLET_QUERY = "(min-width: 768px) and (max-width: 1024px)";

function getSnapshot(): boolean {
  return window.matchMedia(TABLET_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(TABLET_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

export function useIsTablet(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

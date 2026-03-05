"use client";

import { useSyncExternalStore } from "react";

import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
} from "@/lib/stores/last-affaire-store";

export { setLastAffaire } from "@/lib/stores/last-affaire-store";

export function useLastAffaireId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

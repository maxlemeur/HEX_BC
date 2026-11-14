"use client";

import { useCallback, useMemo } from "react";

import { foProvisionsBySupplyType, staleAutomaticKfoPatches } from "@/lib/estimates/fo-provision";

type Input = {
  enabled: boolean;
  isReadOnly: boolean;
  items: Parameters<typeof staleAutomaticKfoPatches>[0];
  supplyTypes: Parameters<typeof foProvisionsBySupplyType>[0];
  onPatchItem: (id: string, patch: { k_fo: number; k_fo_manual: boolean }, options: { persist: boolean }) => void;
};

/** Only refresh automatic lines whose stored coefficient differs from the current settings. */
export function useEstimateAutomaticKfo({ enabled, isReadOnly, items, supplyTypes, onPatchItem }: Input) {
  const patches = useMemo(
    () => enabled ? staleAutomaticKfoPatches(items, foProvisionsBySupplyType(supplyTypes)) : [],
    [enabled, items, supplyTypes],
  );
  const automaticCount = useMemo(
    () => enabled ? items.filter((item) => item.item_type === "line" && item.k_fo_manual === false).length : 0,
    [enabled, items],
  );
  const onRefresh = useCallback(() => {
    if (isReadOnly) return;
    for (const { id, patch } of patches) {
      onPatchItem(id, patch, { persist: true });
    }
  }, [isReadOnly, onPatchItem, patches]);
  return enabled ? { automaticCount, staleCount: patches.length, onRefresh } : undefined;
}

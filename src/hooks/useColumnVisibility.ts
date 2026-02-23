"use client";

import { useCallback, useMemo, useState } from "react";

export type ColumnKey =
  | "supply_type"
  | "k_fo"
  | "h_mo_majoration"
  | "labor_role"
  | "k_mo";

export type ColumnPreset = "essential" | "standard" | "full";

const PRESET_COLUMNS: Record<ColumnPreset, ColumnKey[]> = {
  essential: [],
  standard: ["supply_type", "k_fo", "labor_role", "k_mo", "h_mo_majoration"],
  full: ["supply_type", "k_fo", "h_mo_majoration", "labor_role", "k_mo"],
};

const PRESET_LABELS: Record<ColumnPreset, string> = {
  essential: "Essentiel",
  standard: "Standard",
  full: "Complet",
};

const ALL_ADVANCED_COLUMNS: ColumnKey[] = [
  "supply_type",
  "k_fo",
  "h_mo_majoration",
  "labor_role",
  "k_mo",
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo_majoration: "Majoration MO (%)",
  labor_role: "Type MO",
  k_mo: "K MO",
};

const STORAGE_KEY = "est-col-vis";

function loadPresetFromStorage(): ColumnPreset {
  if (typeof window === "undefined") return "essential";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "essential" || stored === "standard" || stored === "full") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "essential";
}

function savePresetToStorage(preset: ColumnPreset) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, preset);
  } catch {
    // ignore
  }
}

export function useColumnVisibility() {
  const [preset, setPresetState] = useState<ColumnPreset>(loadPresetFromStorage);

  const visibleColumns = useMemo(() => {
    return new Set<ColumnKey>(PRESET_COLUMNS[preset]);
  }, [preset]);

  const setPreset = useCallback((next: ColumnPreset) => {
    setPresetState(next);
    savePresetToStorage(next);
  }, []);

  const toggleColumn = useCallback(
    (key: ColumnKey) => {
      const currentCols = new Set(PRESET_COLUMNS[preset]);
      if (currentCols.has(key)) {
        currentCols.delete(key);
      } else {
        currentCols.add(key);
      }

      // Try to match a preset
      const matchedPreset = (Object.keys(PRESET_COLUMNS) as ColumnPreset[]).find(
        (p) => {
          const presetCols = new Set(PRESET_COLUMNS[p]);
          if (presetCols.size !== currentCols.size) return false;
          for (const col of presetCols) {
            if (!currentCols.has(col)) return false;
          }
          return true;
        }
      );

      if (matchedPreset) {
        setPreset(matchedPreset);
      } else {
        // Default to "full" if custom selection doesn't match any preset
        // (for simplicity, we only support preset-based selection)
        setPreset(currentCols.size >= ALL_ADVANCED_COLUMNS.length ? "full" : "essential");
      }
    },
    [preset, setPreset]
  );

  return {
    preset,
    visibleColumns,
    setPreset,
    toggleColumn,
    presetLabels: PRESET_LABELS,
    allAdvancedColumns: ALL_ADVANCED_COLUMNS,
    columnLabels: COLUMN_LABELS,
  };
}

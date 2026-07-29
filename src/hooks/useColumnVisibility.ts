"use client";

import { useCallback, useMemo, useState } from "react";

export type ColumnKey =
  | "supply_type"
  | "k_fo"
  | "h_mo_majoration"
  | "labor_role"
  | "k_mo"
  // EST-E15 increment 1 : le sous-detail de prix, en lecture seule. Le
  // deboursé sec etait deja calcule par le moteur puis jete ; sans lui le
  // chiffreur ne voit jamais sa marge ligne a ligne et ne peut pas arbitrer.
  | "ds"
  | "marge"
  | "marque";

export type ColumnPreset = "essential" | "standard" | "full" | "custom";

const PRESET_COLUMNS: Record<ColumnPreset, ColumnKey[]> = {
  essential: [],
  standard: ["supply_type", "k_fo", "labor_role", "k_mo"],
  // Volontairement absentes de « Standard » : les y ajouter elargirait sans
  // prevenir la grille des utilisateurs qui ont choisi cette densite.
  // `h_mo_majoration` est absente de TOUS les presets : la majoration chantier
  // n'est pas utilisee pour le moment (laisser a 100%, neutre) et le champ
  // n'est conserve que pour la fidelite des imports/exports OPTIMA. La colonne
  // reste activable individuellement via « Personnalise ».
  full: [
    "supply_type",
    "k_fo",
    "labor_role",
    "k_mo",
    "ds",
    "marge",
    "marque",
  ],
  custom: [],
};

const PRESET_LABELS: Record<ColumnPreset, string> = {
  essential: "Essentiel",
  standard: "Standard",
  full: "Complet",
  custom: "Personnalisé",
};

const ALL_ADVANCED_COLUMNS: ColumnKey[] = [
  "supply_type",
  "k_fo",
  "h_mo_majoration",
  "labor_role",
  "k_mo",
  "ds",
  "marge",
  "marque",
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo_majoration: "Majoration MO (%)",
  labor_role: "Type MO",
  k_mo: "K MO",
  ds: "Deboursé sec",
  marge: "Marge €",
  // Taux de MARQUE (marge / vente), jamais « marge % » (marge / cout) : sur un
  // coefficient 1,35 le premier vaut 25,9 % et le second 35 %.
  marque: "Marque %",
};

const STORAGE_KEY = "est-col-vis";
const STORAGE_KEY_CUSTOM = "est-col-custom";
const STORAGE_KEY_OVERRIDE = "est-col-override";

function loadCustomColumnsFromStorage(): ColumnKey[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed.filter((k: unknown) => ALL_ADVANCED_COLUMNS.includes(k as ColumnKey)) as ColumnKey[];
  } catch {
    // ignore
  }
  return [];
}

function saveCustomColumnsToStorage(columns: ColumnKey[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(columns));
  } catch {
    // ignore
  }
}

function loadOverrideFromStorage(preset: ColumnPreset): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_OVERRIDE);
    if (stored === "true") return true;
    if (stored === "false") return false;

    // Migration path for users who already had a non-default preset before
    // the override key existed.
    const shouldInferLegacyOverride = preset === "full" || preset === "custom";
    if (shouldInferLegacyOverride) {
      localStorage.setItem(STORAGE_KEY_OVERRIDE, "true");
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function saveOverrideToStorage(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_OVERRIDE, String(value));
  } catch {
    // ignore
  }
}

function loadPresetFromStorage(): ColumnPreset {
  if (typeof window === "undefined") return "essential";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "essential" || stored === "standard" || stored === "full" || stored === "custom") {
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
  const [customColumns, setCustomColumnsState] = useState<ColumnKey[]>(loadCustomColumnsFromStorage);
  const [hasManualOverride, setHasManualOverrideState] = useState<boolean>(() => loadOverrideFromStorage(preset));

  const setCustomColumns = useCallback((cols: ColumnKey[]) => {
    setCustomColumnsState(cols);
    saveCustomColumnsToStorage(cols);
  }, []);

  const visibleColumns = useMemo(() => {
    if (preset === "custom") {
      return new Set<ColumnKey>(customColumns);
    }
    return new Set<ColumnKey>(PRESET_COLUMNS[preset]);
  }, [preset, customColumns]);

  /** User-initiated preset change — marks manual override */
  const setPreset = useCallback((next: ColumnPreset) => {
    setPresetState(next);
    savePresetToStorage(next);
    setHasManualOverrideState(true);
    saveOverrideToStorage(true);
  }, []);

  /** System-initiated preset change — does NOT mark manual override */
  const setPresetAuto = useCallback((next: ColumnPreset) => {
    setPresetState(next);
    savePresetToStorage(next);
  }, []);

  const clearManualOverride = useCallback(() => {
    setHasManualOverrideState(false);
    saveOverrideToStorage(false);
  }, []);

  const hiddenAdvancedCount = useMemo(
    () => ALL_ADVANCED_COLUMNS.filter((col) => !visibleColumns.has(col)).length,
    [visibleColumns]
  );

  const toggleAdvancedColumns = useCallback(() => {
    if (preset === "full") {
      setPreset("essential");
    } else {
      setPreset("full");
    }
  }, [preset, setPreset]);

  const toggleColumn = useCallback(
    (key: ColumnKey) => {
      const currentCols = preset === "custom"
        ? new Set(customColumns)
        : new Set(PRESET_COLUMNS[preset]);
      if (currentCols.has(key)) {
        currentCols.delete(key);
      } else {
        currentCols.add(key);
      }

      const matchedPreset = (["essential", "standard", "full"] as ColumnPreset[]).find(
        (p) => {
          const presetCols = new Set(PRESET_COLUMNS[p]);
          if (presetCols.size !== currentCols.size) return false;
          for (const col of presetCols) {
            if (!currentCols.has(col)) return false;
          }
          return true;
        }
      );
      const newCustom = Array.from(currentCols) as ColumnKey[];
      setCustomColumns(newCustom);

      if (matchedPreset) {
        setPreset(matchedPreset);
      } else {
        setPreset("custom");
      }
    },
    [preset, customColumns, setPreset, setCustomColumns]
  );

  return {
    preset,
    visibleColumns,
    setPreset,
    setPresetAuto,
    toggleColumn,
    customColumns,
    setCustomColumns,
    presetLabels: PRESET_LABELS,
    allAdvancedColumns: ALL_ADVANCED_COLUMNS,
    columnLabels: COLUMN_LABELS,
    hiddenAdvancedCount,
    hasManualOverride,
    clearManualOverride,
    toggleAdvancedColumns,
  };
}

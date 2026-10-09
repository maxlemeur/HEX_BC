"use client";

import { useCallback, useMemo } from "react";

import { useEstimatePreferenceKey, useEstimatePreferenceStorage } from "@/hooks/useEstimatePreferenceStorage";

export type ColumnKey =
  | "supplier"
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
    "supplier",
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
  "supplier",
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
  supplier: "Fournisseur",
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

function parsePreset(stored: string | null): ColumnPreset {
  return stored === "standard" || stored === "full" || stored === "custom" ? stored : "essential";
}

function parseCustomColumns(stored: string | null): ColumnKey[] {
  try {
    const parsed = JSON.parse(stored ?? "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((key: unknown) => ALL_ADVANCED_COLUMNS.includes(key as ColumnKey)))] as ColumnKey[]
      : [];
  } catch {
    return [];
  }
}

const serializePreset = (preset: ColumnPreset) => preset;
const serializeOverride = (value: boolean) => String(value);
const parseSchema = (value: string | null) => value === "2" ? 2 : 1;
const serializeSchema = (value: number) => String(value);

export function useColumnVisibility() {
  const presetKey = useEstimatePreferenceKey(STORAGE_KEY);
  const customKey = useEstimatePreferenceKey(STORAGE_KEY_CUSTOM);
  const overrideKey = useEstimatePreferenceKey(STORAGE_KEY_OVERRIDE);
  const schemaKey = useEstimatePreferenceKey("est-col-schema-v2");
  const [schemaVersion, setSchemaVersion] = useEstimatePreferenceStorage(schemaKey, parseSchema, serializeSchema);
  const [preset, setPresetState] = useEstimatePreferenceStorage(presetKey, parsePreset, serializePreset);
  const [customColumns, setCustomColumns] = useEstimatePreferenceStorage(customKey, parseCustomColumns);
  const [hasManualOverride, setHasManualOverrideState] = useEstimatePreferenceStorage(
    overrideKey,
    (stored) => {
      if (stored === "true") return true;
      if (stored === "false") return false;
      const legacyOverride = preset === "full" || preset === "custom";
      if (legacyOverride && overrideKey && typeof window !== "undefined") {
        try { localStorage.setItem(overrideKey, "true"); } catch { /* Optional storage. */ }
      }
      return legacyOverride;
    },
    serializeOverride,
  );

  const visibleColumns = useMemo(() => {
    if (preset === "custom") {
      return new Set<ColumnKey>(customColumns);
    }
    // A saved "Complet" predating the supplier column must retain its density.
    // Explicitly selecting Complet adopts the current schema.
    return new Set<ColumnKey>(PRESET_COLUMNS[preset].filter(
      (column) => column !== "supplier" || schemaVersion === 2,
    ));
  }, [preset, customColumns, schemaVersion]);

  /** User-initiated preset change — marks manual override */
  const setPreset = useCallback((next: ColumnPreset) => {
    setSchemaVersion(2);
    setPresetState(next);
    setHasManualOverrideState(true);
  }, [setPresetState, setHasManualOverrideState, setSchemaVersion]);

  /** System-initiated preset change — does NOT mark manual override */
  const setPresetAuto = useCallback((next: ColumnPreset) => {
    setPresetState(next);
  }, [setPresetState]);

  const clearManualOverride = useCallback(() => {
    setHasManualOverrideState(false);
  }, [setHasManualOverrideState]);

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
      const currentCols = new Set(visibleColumns);
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
    [visibleColumns, setPreset, setCustomColumns]
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
    resetColumns: () => {
      setSchemaVersion(2);
      setCustomColumns([]);
      setPresetState("essential");
      setHasManualOverrideState(false);
    },
  };
}

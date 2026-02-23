"use client";

import { useState } from "react";

import {
  ESTIMATE_QUALITY_FLAG_KEYS,
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagCounts,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  type EstimateOutlierMethod,
} from "@/lib/estimates/outlier-detection";
import type { Database } from "@/types/database";
import {
  useEstimateEditorActions,
  useEstimateEditorMeta,
  useEstimateEditorState,
} from "@/components/estimates/context/EstimateEditorContext";
import type { ColumnKey, ColumnPreset } from "@/hooks/useColumnVisibility";
import { usePopover } from "@/hooks/usePopover";

type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

export type EstimateQualityFilter =
  | "all_lines"
  | "with_anomalies"
  | EstimateQualityFlagKey;

type BulkMoveDestination = {
  id: string | null;
  label: string;
};

type EstimateEditorToolbarProps = {
  qualityCounts: EstimateQualityFlagCounts;
  qualityFilter: EstimateQualityFilter;
  outlierDetectionMethod: EstimateOutlierMethod;
  outlierThreshold: number;
  isUndoRedoBusy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  bulkMoveDestinations: BulkMoveDestination[];
  categories: EstimateCategory[];
  laborRoles: LaborRole[];
  bulkSuggestionEligibleCount: number;
  onQualityFilterChange: (value: EstimateQualityFilter) => void;
  onOutlierDetectionMethodChange: (value: EstimateOutlierMethod) => void;
  onOutlierThresholdChange: (value: number) => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onApplyBulkMajoration: () => Promise<void>;
  onBulkDeleteSelection: () => Promise<void>;
  onApplyBulkMove: () => Promise<void>;
  onApplyBulkCategory: () => Promise<void>;
  onApplyBulkLaborRole: () => Promise<void>;
  onOpenBulkSuggestDialog: () => void;
  onOpenAssemblyPicker: () => void;
  onAddRootSection: () => void;
  columnPreset: ColumnPreset;
  columnPresetLabels: Record<ColumnPreset, string>;
  onColumnPresetChange: (preset: ColumnPreset) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  columnVisibleColumns: Set<ColumnKey>;
  allAdvancedColumns: ColumnKey[];
  columnLabels: Record<ColumnKey, string>;
  onToggleColumn: (key: ColumnKey) => void;
};

const ROOT_KEY = "root";

function parseEstimateQualityFilter(value: string): EstimateQualityFilter {
  if (value === "all_lines" || value === "with_anomalies") {
    return value;
  }
  if (ESTIMATE_QUALITY_FLAG_KEYS.includes(value as EstimateQualityFlagKey)) {
    return value as EstimateQualityFlagKey;
  }
  return "all_lines";
}

function parseOutlierMethod(value: string): EstimateOutlierMethod {
  return value === "zscore" ? "zscore" : "iqr";
}

function parseNumberInput(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function EstimateEditorToolbar({
  qualityCounts,
  qualityFilter,
  outlierDetectionMethod,
  outlierThreshold,
  isUndoRedoBusy,
  canUndo,
  canRedo,
  bulkMoveDestinations,
  categories,
  laborRoles,
  bulkSuggestionEligibleCount,
  onQualityFilterChange,
  onOutlierDetectionMethodChange,
  onOutlierThresholdChange,
  onUndo,
  onRedo,
  onApplyBulkMajoration,
  onBulkDeleteSelection,
  onApplyBulkMove,
  onApplyBulkCategory,
  onApplyBulkLaborRole,
  onOpenBulkSuggestDialog,
  onOpenAssemblyPicker,
  onAddRootSection,
  columnPreset,
  columnPresetLabels,
  onColumnPresetChange,
  searchTerm,
  onSearchChange,
  columnVisibleColumns,
  allAdvancedColumns,
  columnLabels,
  onToggleColumn,
}: EstimateEditorToolbarProps) {
  const state = useEstimateEditorState();
  const actions = useEstimateEditorActions();
  const meta = useEstimateEditorMeta();
  const {
    isOpen: columnsOpen,
    toggle: columnsToggle,
    setContainerRef: columnsContainerRef,
  } = usePopover();
  const {
    isOpen: toolsOpen,
    toggle: toolsToggle,
    setContainerRef: toolsContainerRef,
  } = usePopover();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">Éditeur du devis</h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Organisez chapitres, sous-chapitres et lignes FO/MO.
          </p>
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            {qualityCounts.linesWithAnomaliesCount} ligne(s) avec anomalies sur{" "}
            {qualityCounts.linesCount} ligne(s) ({qualityCounts.totalFlagsCount} flag(s))
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-2 py-1">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void onUndo()}
              disabled={meta.isReadOnly || isUndoRedoBusy || !canUndo}
              aria-label="Annuler la dernière action"
              title="Annuler (Ctrl+Z)"
            >
              Annuler
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void onRedo()}
              disabled={meta.isReadOnly || isUndoRedoBusy || !canRedo}
              aria-label="Rétablir la dernière action"
              title="Rétablir (Ctrl+Y)"
            >
              Rétablir
            </button>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onAddRootSection}
            disabled={meta.isReadOnly}
          >
            + Chapitre
          </button>
          <input
            type="search"
            className="form-input h-8 w-48 text-sm"
            placeholder="Rechercher..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <div className="relative" ref={columnsContainerRef}>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={columnsToggle}
            >
              Colonnes
            </button>
            {columnsOpen && (
              <div
                className="absolute right-0 top-full z-20 mt-2 flex flex-col gap-2 rounded-xl border border-[var(--slate-200)] bg-white p-3 shadow-xl"
                style={{ minWidth: "200px" }}
              >
                {(Object.keys(columnPresetLabels) as ColumnPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`btn btn-sm w-full text-left${columnPreset === preset ? " btn-primary" : " btn-secondary"}`}
                    onClick={() => onColumnPresetChange(preset)}
                  >
                    {columnPresetLabels[preset]}
                  </button>
                ))}
                {columnPreset === "custom" && (
                  <div className="mt-2 border-t border-[var(--slate-200)] pt-2 space-y-1">
                    {allAdvancedColumns.map((col) => (
                      <label key={col} className="flex items-center gap-2 text-sm text-[var(--slate-700)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={columnVisibleColumns.has(col)}
                          onChange={() => onToggleColumn(col)}
                        />
                        {columnLabels[col]}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {qualityCounts.linesWithAnomaliesCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
              {qualityCounts.linesWithAnomaliesCount} anomalie{qualityCounts.linesWithAnomaliesCount > 1 ? "s" : ""}
            </span>
          )}
          <div className="relative" ref={toolsContainerRef}>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={toolsToggle}
            >
              Outils avancés
            </button>
            {toolsOpen && (
              <div
                className="absolute right-0 top-full z-20 mt-2 flex flex-col gap-3 rounded-xl border border-[var(--slate-200)] bg-white p-4 shadow-xl"
                style={{ minWidth: "320px" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
                    htmlFor="estimate-quality-filter"
                  >
                    Filtre qualité
                  </label>
                  <select
                    id="estimate-quality-filter"
                    className="estimate-input estimate-select"
                    style={{ width: "auto", minWidth: "260px" }}
                    value={qualityFilter}
                    onChange={(event) => onQualityFilterChange(parseEstimateQualityFilter(event.target.value))}
                  >
                    <option value="all_lines">Toutes les lignes ({qualityCounts.linesCount})</option>
                    <option value="with_anomalies">
                      Lignes avec anomalies ({qualityCounts.linesWithAnomaliesCount})
                    </option>
                    {ESTIMATE_QUALITY_FLAG_KEYS.map((flag) => (
                      <option key={flag} value={flag}>
                        {ESTIMATE_QUALITY_FLAG_META[flag].label} ({qualityCounts.byFlag[flag]})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
                  <label
                    className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-700"
                    htmlFor="estimate-outlier-method"
                  >
                    Outliers
                  </label>
                  <select
                    id="estimate-outlier-method"
                    className="estimate-input estimate-select"
                    style={{ width: "auto", minWidth: "104px" }}
                    value={outlierDetectionMethod}
                    disabled={meta.isReadOnly}
                    onChange={(event) => onOutlierDetectionMethodChange(parseOutlierMethod(event.target.value))}
                  >
                    <option value="iqr">IQR</option>
                    <option value="zscore">Z-score</option>
                  </select>
                  <input
                    className="estimate-input"
                    style={{ width: "92px" }}
                    type="number"
                    step="0.1"
                    min={0.1}
                    value={outlierThreshold}
                    disabled={meta.isReadOnly}
                    onChange={(event) => onOutlierThresholdChange(parseNumberInput(event.target.value))}
                    aria-label="Seuil de detection des outliers"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {bulkSuggestionEligibleCount > 0 ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={onOpenBulkSuggestDialog}
                      disabled={meta.isReadOnly}
                    >
                      Suggestions ({bulkSuggestionEligibleCount})
                    </button>
                  ) : null}
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={onOpenAssemblyPicker}
                    disabled={meta.isReadOnly}
                  >
                    Assemblages
                  </button>
                </div>
              </div>
            )}
          </div>
          <KeyboardShortcutsButton />
        </div>
      </div>
      {state.hasSelectedLines ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--slate-200)] bg-white px-6 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[var(--slate-700)]">
            {state.selectedLineCount} sélection(s)
          </span>
          <div className="mx-1 h-4 w-px bg-[var(--slate-300)]" />
          <input
            className="estimate-input"
            style={{ width: "92px" }}
            type="number"
            step="0.1"
            min={0}
            value={state.bulkMajorationPercent}
            onChange={(event) => actions.setBulkMajorationPercent(event.target.value)}
            placeholder="100"
            disabled={meta.isReadOnly}
            aria-label="Majoration MO en pourcentage"
          />
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onApplyBulkMajoration()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
          >
            Appliquer majoration
          </button>
          <div className="mx-1 h-4 w-px bg-[var(--slate-300)]" />
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-bulk-move-target"
          >
            Déplacer
          </label>
          <select
            id="estimate-bulk-move-target"
            className="estimate-input estimate-select"
            style={{ width: "auto", minWidth: "180px" }}
            value={state.bulkMoveParentId}
            onChange={(event) => actions.setBulkMoveParentId(event.target.value)}
            disabled={meta.isReadOnly}
          >
            {bulkMoveDestinations.map((destination) => (
              <option key={destination.id ?? ROOT_KEY} value={destination.id ?? ""}>
                {destination.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onApplyBulkMove()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
          >
            Appliquer
          </button>
          <div className="mx-1 h-4 w-px bg-[var(--slate-300)]" />
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-bulk-category"
          >
            Catégorie
          </label>
          <select
            id="estimate-bulk-category"
            className="estimate-input estimate-select"
            style={{ width: "auto", minWidth: "180px" }}
            value={state.bulkCategoryId}
            onChange={(event) => actions.setBulkCategoryId(event.target.value)}
            disabled={meta.isReadOnly}
          >
            <option value="">Aucune</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onApplyBulkCategory()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
          >
            Appliquer
          </button>
          <div className="mx-1 h-4 w-px bg-[var(--slate-300)]" />
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-bulk-labor-role"
          >
            Rôle MO
          </label>
          <select
            id="estimate-bulk-labor-role"
            className="estimate-input estimate-select"
            style={{ width: "auto", minWidth: "180px" }}
            value={state.bulkLaborRoleId}
            onChange={(event) => actions.setBulkLaborRoleId(event.target.value)}
            disabled={meta.isReadOnly}
          >
            <option value="">Aucun</option>
            {laborRoles.map((role) => (
              <option key={role.id} value={role.id} disabled={!role.is_active}>
                {role.name}
                {!role.is_active ? " (inactif)" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onApplyBulkLaborRole()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
          >
            Appliquer
          </button>
          <div className="mx-1 h-4 w-px bg-[var(--slate-300)]" />
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={() => void onBulkDeleteSelection()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
          >
            Supprimer sélection
          </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const KEYBOARD_SHORTCUTS = [
  { keys: ["Ctrl", "S"], description: "Sauvegarder" },
  { keys: ["Ctrl", "Z"], description: "Annuler (Undo)" },
  { keys: ["Ctrl", "Shift", "Z"], description: "Refaire (Redo)" },
  { keys: ["Ctrl", "Y"], description: "Refaire (Redo)" },
  { keys: ["Ctrl", "A"], description: "Sélectionner toutes les lignes" },
  { keys: ["Ctrl", "C"], description: "Copier les lignes sélectionnées" },
  { keys: ["Ctrl", "Shift", "A"], description: "Ouvrir le sélecteur d'assemblages" },
  { keys: ["Delete"], description: "Supprimer les lignes sélectionnées" },
  { keys: ["Escape"], description: "Désélectionner / Annuler l'édition" },
  { keys: ["Tab"], description: "Cellule suivante" },
  { keys: ["Shift", "Tab"], description: "Cellule précédente" },
  { keys: ["Entrée"], description: "Valider et passer à la cellule suivante" },
  { keys: ["\u2191", "\u2193"], description: "Navigation entre lignes" },
];

function KeyboardShortcutsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => setIsOpen(true)}
        title="Raccourcis clavier"
        aria-label="Raccourcis clavier"
      >
        ?
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--slate-800)]">
                Raccourcis clavier
              </h3>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Fermer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2">
              {KEYBOARD_SHORTCUTS.map(({ keys, description }) => (
                <div
                  key={keys.join("+")}
                  className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--slate-50)]"
                >
                  <span className="text-[var(--slate-600)]">{description}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-[var(--slate-300)] bg-[var(--slate-50)] px-1.5 py-0.5 text-xs font-medium text-[var(--slate-700)]"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

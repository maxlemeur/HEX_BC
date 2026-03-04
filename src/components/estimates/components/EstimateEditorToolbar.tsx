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
import type { UiMode } from "@/lib/ui-mode";

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
  uiMode: UiMode;
  isViewerMode?: boolean;
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
  onOpenImportFromEstimateDialog?: () => void;
  onAddRootSection: () => void;
  rootAddSectionLabel?: string;
  onExpandAllSections?: () => void;
  onCollapseAllSections?: () => void;
  onOpenSettings?: () => void;
  columnPreset: ColumnPreset;
  columnPresetLabels: Record<ColumnPreset, string>;
  onColumnPresetChange: (preset: ColumnPreset) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  columnVisibleColumns: Set<ColumnKey>;
  allAdvancedColumns: ColumnKey[];
  columnLabels: Record<ColumnKey, string>;
  onToggleColumn: (key: ColumnKey) => void;
  /* UX2-022: Quick insert pickers */
  isQuickTemplatePickerOpen?: boolean;
  onToggleQuickTemplatePicker?: () => void;
  isQuickAssemblyPickerOpen?: boolean;
  onToggleQuickAssemblyPicker?: () => void;
  quickTemplatePickerNode?: React.ReactNode;
  quickAssemblyPickerNode?: React.ReactNode;
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
  uiMode,
  isViewerMode = false,
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
  onOpenImportFromEstimateDialog,
  onAddRootSection,
  rootAddSectionLabel = "+ Ajouter un Lot",
  onExpandAllSections,
  onCollapseAllSections,
  onOpenSettings,
  columnPreset,
  columnPresetLabels,
  onColumnPresetChange,
  searchTerm,
  onSearchChange,
  columnVisibleColumns,
  allAdvancedColumns,
  columnLabels,
  onToggleColumn,
  isQuickTemplatePickerOpen,
  onToggleQuickTemplatePicker,
  isQuickAssemblyPickerOpen,
  onToggleQuickAssemblyPicker,
  quickTemplatePickerNode,
  quickAssemblyPickerNode,
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
  const {
    isOpen: anomaliesOpen,
    toggle: anomaliesToggle,
    setContainerRef: anomaliesContainerRef,
  } = usePopover();
  const isSimplifiedMode = uiMode === "simplified";
  const availableColumnPresets = isSimplifiedMode
    ? (["essential"] as const)
    : (Object.keys(columnPresetLabels) as ColumnPreset[]);

  if (isViewerMode) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="form-input h-8 text-sm"
          style={{ width: "220px" }}
          placeholder="Rechercher..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <div className="flex-1 min-w-0" />
        {onOpenSettings ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onOpenSettings}
          >
            Parametres
          </button>
        ) : null}
        <KeyboardShortcutsButton />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isSimplifiedMode ? "gap-1" : "gap-2"}`}>
      {/* Row 1 — Edit actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Undo / Redo group */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-subtle px-2 py-1">
          <button
            className="btn btn-ghost btn-sm px-2"
            type="button"
            onClick={() => void onUndo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canUndo}
            aria-label="Annuler la dernière action"
            title="Annuler (Ctrl+Z)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
            <span className="text-xs">Annuler</span>
          </button>
          <button
            className="btn btn-ghost btn-sm px-2"
            type="button"
            onClick={() => void onRedo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canRedo}
            aria-label="Rétablir la dernière action"
            title="Rétablir (Ctrl+Y)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></svg>
            <span className="text-xs">Rétablir</span>
          </button>
        </div>

        <div className="h-5 w-px bg-slate-200" />

        {/* Primary actions */}
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={onAddRootSection}
          disabled={meta.isReadOnly}
        >
          {rootAddSectionLabel}
        </button>
        {onExpandAllSections ? (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={onExpandAllSections}
          >
            Tout deplier
          </button>
        ) : null}
        {onCollapseAllSections ? (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={onCollapseAllSections}
          >
            Tout replier
          </button>
        ) : null}
        {onOpenImportFromEstimateDialog ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onOpenImportFromEstimateDialog}
            disabled={meta.isReadOnly}
          >
            Importer depuis...
          </button>
        ) : null}

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Settings button */}
        {onOpenSettings && (
          <>
            <div className="h-5 w-px bg-slate-200" />
            <button
              className="btn btn-ghost btn-sm flex items-center gap-1.5"
              type="button"
              onClick={onOpenSettings}
              title="Paramétrage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>Paramétrage</span>
            </button>
          </>
        )}
      </div>

      {/* Row 2 — View & filter */}
      <div className={`flex flex-wrap items-center ${isSimplifiedMode ? "gap-1.5" : "gap-2"}`}>
        <input
          type="search"
          className="form-input h-8 text-sm"
          style={{ width: "160px" }}
          placeholder="Rechercher..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {/* UX2-022: Quick insert buttons — Expert mode only */}
        {!isSimplifiedMode && onToggleQuickTemplatePicker && (
          <div className="relative">
            <button
              className={`btn btn-sm ${isQuickTemplatePickerOpen ? "btn-primary" : "btn-secondary"}`}
              type="button"
              onClick={onToggleQuickTemplatePicker}
              disabled={meta.isReadOnly}
              title="Inserer un template"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              <span className="text-xs">+ Template</span>
            </button>
            {quickTemplatePickerNode}
          </div>
        )}
        {!isSimplifiedMode && onToggleQuickAssemblyPicker && (
          <div className="relative">
            <button
              className={`btn btn-sm ${isQuickAssemblyPickerOpen ? "btn-primary" : "btn-secondary"}`}
              type="button"
              onClick={onToggleQuickAssemblyPicker}
              disabled={meta.isReadOnly}
              title="Inserer un assemblage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>
              <span className="text-xs">+ Assemblage</span>
            </button>
            {quickAssemblyPickerNode}
          </div>
        )}
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
              className="absolute left-0 top-full z-20 mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-xl"
              style={{ minWidth: "200px" }}
            >
              {availableColumnPresets.map((preset) => (
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
                <div className="mt-2 border-t border-border pt-2 space-y-1">
                  {allAdvancedColumns.map((col) => (
                    <label key={col} className="flex items-center gap-2 text-sm text-secondary-foreground cursor-pointer">
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
        {!isSimplifiedMode && qualityCounts.linesWithAnomaliesCount > 0 && (
          <div className="relative" ref={anomaliesContainerRef}>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors cursor-pointer ${
                qualityFilter !== "all_lines"
                  ? "bg-orange-200 text-orange-800 ring-1 ring-orange-400"
                  : "bg-orange-100 text-orange-700 hover:bg-orange-200"
              }`}
              onClick={anomaliesToggle}
              title="Filtrer par anomalies"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {qualityCounts.linesWithAnomaliesCount} anomalie{qualityCounts.linesWithAnomaliesCount > 1 ? "s" : ""}
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {anomaliesOpen && (
              <div
                className="absolute left-0 top-full z-20 mt-2 flex flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-xl"
                style={{ minWidth: "260px" }}
              >
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors ${qualityFilter === "all_lines" ? "bg-secondary font-semibold text-foreground" : "text-secondary-foreground hover:bg-surface-subtle"}`}
                  onClick={() => { onQualityFilterChange("all_lines"); anomaliesToggle(); }}
                >
                  Toutes les lignes ({qualityCounts.linesCount})
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors ${qualityFilter === "with_anomalies" ? "bg-orange-100 font-semibold text-orange-800" : "text-secondary-foreground hover:bg-surface-subtle"}`}
                  onClick={() => { onQualityFilterChange("with_anomalies"); anomaliesToggle(); }}
                >
                  Lignes avec anomalies ({qualityCounts.linesWithAnomaliesCount})
                </button>
                {ESTIMATE_QUALITY_FLAG_KEYS.filter((flag) => qualityCounts.byFlag[flag] > 0).map((flag) => (
                  <button
                    key={flag}
                    type="button"
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors ${qualityFilter === flag ? "bg-orange-100 font-semibold text-orange-800" : "text-secondary-foreground hover:bg-surface-subtle"}`}
                    onClick={() => { onQualityFilterChange(flag); anomaliesToggle(); }}
                  >
                    {ESTIMATE_QUALITY_FLAG_META[flag].label} ({qualityCounts.byFlag[flag]})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!isSimplifiedMode && (
          <div className="relative" ref={toolsContainerRef}>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={toolsToggle}
            >
              Outils
            </button>
            {toolsOpen && (
              <div
                className="absolute right-0 top-full z-20 mt-2 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xl"
                style={{ minWidth: "320px" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
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
        )}
        <KeyboardShortcutsButton />
      </div>

      {/* Bulk selection bar */}
      {!isViewerMode && state.hasSelectedLines ? (
        <>
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-surface px-6 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-secondary-foreground">
            {state.selectedLineCount} sélection(s)
          </span>
          <div className="mx-1 h-4 w-px bg-slate-300" />
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
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
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
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
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
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
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
          <div className="mx-1 h-4 w-px bg-slate-300" />
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
        </>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
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
                  className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-subtle"
                >
                  <span className="text-slate-600">{description}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-slate-300 bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-secondary-foreground"
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

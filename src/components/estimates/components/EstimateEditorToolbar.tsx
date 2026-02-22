"use client";

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
}: EstimateEditorToolbarProps) {
  const state = useEstimateEditorState();
  const actions = useEstimateEditorActions();
  const meta = useEstimateEditorMeta();

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--slate-800)]">Editeur du devis</h2>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Organisez chapitres, sous-chapitres et lignes FO/MO.
        </p>
        <p className="mt-2 text-xs text-[var(--slate-500)]">
          {qualityCounts.linesWithAnomaliesCount} ligne(s) avec anomalies sur{" "}
          {qualityCounts.linesCount} ligne(s) ({qualityCounts.totalFlagsCount} flag(s))
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
          htmlFor="estimate-quality-filter"
        >
          Filtre qualite
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
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1">
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
        <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-2 py-1">
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onUndo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canUndo}
            aria-label="Annuler la derniere action"
          >
            Undo
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onRedo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canRedo}
            aria-label="Retablir la derniere action"
          >
            Redo
          </button>
          <span className="text-xs text-[var(--slate-600)]">{state.selectedLineCount} selection(s)</span>
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
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={() => void onBulkDeleteSelection()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
          >
            Supprimer selection
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1">
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-bulk-move-target"
          >
            Deplacer
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
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1">
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-bulk-category"
          >
            Categorie
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
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1">
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-bulk-labor-role"
          >
            Role MO
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
        </div>
        {bulkSuggestionEligibleCount > 0 ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onOpenBulkSuggestDialog}
            disabled={meta.isReadOnly}
          >
            Appliquer les suggestions ({bulkSuggestionEligibleCount})
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
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={onAddRootSection}
          disabled={meta.isReadOnly}
        >
          + Chapitre
        </button>
      </div>
    </div>
  );
}

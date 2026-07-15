"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
import { useIsCompactViewport } from "@/hooks/useIsTablet";
import { usePopover } from "@/hooks/usePopover";
import { EstimateEditorCommandBar } from "@/components/estimates/components/EstimateEditorCommandBar";
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

export type EstimateEditorToolbarProps = {
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
  supplierPreselectionEligibleCount: number;
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
  onOpenSupplierPreselectionDialog: () => void;
  onOpenAssemblyPicker: () => void;
  onOpenImportFromEstimateDialog?: () => void;
  onOpenEstimateStructureDraftDialog?: () => void;
  onOpenGeneratedOuvrageDialog?: () => void;
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
  hiddenAdvancedCount: number;
  onToggleAdvancedColumns: () => void;
  isFinalizationPanelOpen?: boolean;
  onToggleFinalizationPanel?: () => void;
  isLaborSplitEnabled?: boolean;
  /* UX2-022: Quick insert pickers */
  isQuickTemplatePickerOpen?: boolean;
  onToggleQuickTemplatePicker?: () => void;
  isQuickAssemblyPickerOpen?: boolean;
  onToggleQuickAssemblyPicker?: () => void;
  quickTemplatePickerNode?: React.ReactNode;
  quickAssemblyPickerNode?: React.ReactNode;
};

const ROOT_KEY = "root";
const COLUMNS_PANEL_ID = "estimate-editor-columns-panel";
const ANOMALIES_PANEL_ID = "estimate-editor-anomalies-panel";
const TOOLS_PANEL_ID = "estimate-editor-tools-panel";
const PRIMARY_ACTIONS_PANEL_ID = "estimate-editor-primary-actions-panel";
const TOOLS_PANEL_WIDTH = 320;
const POPOVER_VIEWPORT_PADDING = 16;
const POPOVER_TRIGGER_GAP = 8;
const TOOLS_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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

export function EstimateEditorToolbar(props: EstimateEditorToolbarProps) {
  return <EstimateEditorCommandBar {...props} />;
}

// Conservé temporairement pour les intégrations qui dépendent encore de la
// disposition historique à deux rangées.
export function LegacyEstimateEditorToolbar({
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
  supplierPreselectionEligibleCount,
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
  onOpenSupplierPreselectionDialog,
  onOpenAssemblyPicker,
  onOpenImportFromEstimateDialog,
  onOpenEstimateStructureDraftDialog,
  onOpenGeneratedOuvrageDialog,
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
  hiddenAdvancedCount,
  onToggleAdvancedColumns,
  isLaborSplitEnabled = false,
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
  const isCompactViewport = useIsCompactViewport();
  const {
    isOpen: columnsOpen,
    toggle: columnsToggle,
    close: columnsClose,
    setContainerRef: columnsContainerRef,
  } = usePopover();
  const {
    isOpen: toolsOpen,
    toggle: toolsToggle,
    close: toolsClose,
    setContainerRef: toolsContainerRef,
  } = usePopover();
  const {
    isOpen: anomaliesOpen,
    toggle: anomaliesToggle,
    close: anomaliesClose,
    setContainerRef: anomaliesContainerRef,
  } = usePopover();
  const {
    isOpen: overflowOpen,
    toggle: overflowToggle,
    setContainerRef: overflowContainerRef,
  } = usePopover();
  const {
    isOpen: primaryActionsOpen,
    toggle: primaryActionsToggle,
    close: primaryActionsClose,
    setContainerRef: primaryActionsContainerRef,
  } = usePopover();
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const toolsPanelRef = useRef<HTMLDivElement>(null);
  const hasFocusedToolsPanelRef = useRef(false);
  const [toolsPanelPosition, setToolsPanelPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const isSimplifiedMode = uiMode === "simplified";
  const availableColumnPresets = isSimplifiedMode
    ? (["essential"] as const)
    : (Object.keys(columnPresetLabels) as ColumnPreset[]);

  useLayoutEffect(() => {
    if (!toolsOpen) return;

    const updateToolsPanelPosition = () => {
      const button = toolsButtonRef.current;
      const panel = toolsPanelRef.current;
      if (!button || !panel) return;

      const buttonRect = button.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const width = Math.min(
        TOOLS_PANEL_WIDTH,
        Math.max(0, window.innerWidth - POPOVER_VIEWPORT_PADDING * 2)
      );
      const maximumLeft = Math.max(
        POPOVER_VIEWPORT_PADDING,
        window.innerWidth - POPOVER_VIEWPORT_PADDING - width
      );
      const leftAlignedPosition = buttonRect.left;
      const rightAlignedPosition = buttonRect.right - width;
      const canOpenRight =
        leftAlignedPosition + width <=
        window.innerWidth - POPOVER_VIEWPORT_PADDING;
      const left = Math.min(
        maximumLeft,
        Math.max(
          POPOVER_VIEWPORT_PADDING,
          canOpenRight ? leftAlignedPosition : rightAlignedPosition
        )
      );
      const availableBelow = Math.max(
        0,
        window.innerHeight -
          buttonRect.bottom -
          POPOVER_TRIGGER_GAP -
          POPOVER_VIEWPORT_PADDING
      );
      const availableAbove = Math.max(
        0,
        buttonRect.top - POPOVER_TRIGGER_GAP - POPOVER_VIEWPORT_PADDING
      );
      const shouldOpenAbove =
        panelRect.height > availableBelow && availableAbove > availableBelow;
      const maxHeight = shouldOpenAbove ? availableAbove : availableBelow;
      const top = shouldOpenAbove
        ? Math.max(
            POPOVER_VIEWPORT_PADDING,
            buttonRect.top - POPOVER_TRIGGER_GAP - Math.min(panelRect.height, maxHeight)
          )
        : buttonRect.bottom + POPOVER_TRIGGER_GAP;

      setToolsPanelPosition({ left, top, width, maxHeight });
    };

    updateToolsPanelPosition();
    window.addEventListener("resize", updateToolsPanelPosition);
    window.addEventListener("scroll", updateToolsPanelPosition, true);
    return () => {
      window.removeEventListener("resize", updateToolsPanelPosition);
      window.removeEventListener("scroll", updateToolsPanelPosition, true);
    };
  }, [toolsOpen]);

  useLayoutEffect(() => {
    if (!toolsOpen) {
      hasFocusedToolsPanelRef.current = false;
      return;
    }
    if (!toolsPanelPosition || hasFocusedToolsPanelRef.current) return;

    const firstControl = toolsPanelRef.current?.querySelector<HTMLElement>(
      "select:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    if (!firstControl) return;

    firstControl.focus();
    hasFocusedToolsPanelRef.current = true;
  }, [toolsOpen, toolsPanelPosition]);

  useLayoutEffect(() => {
    if (!toolsOpen) return;

    const handleToolsKeyDown = (event: KeyboardEvent) => {
      const panel = toolsPanelRef.current;
      if (!panel || !panel.contains(document.activeElement)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        toolsClose();
        toolsButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = Array.from(
        panel.querySelectorAll<HTMLElement>(TOOLS_FOCUSABLE_SELECTOR)
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const firstControl = focusableElements[0];
      const lastControl = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleToolsKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleToolsKeyDown, true);
  }, [toolsClose, toolsOpen]);

  useLayoutEffect(() => {
    if (!isCompactViewport || overflowOpen) return;
    columnsClose();
    anomaliesClose();
    toolsClose();
  }, [
    anomaliesClose,
    columnsClose,
    isCompactViewport,
    overflowOpen,
    toolsClose,
  ]);

  if (isViewerMode) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="estimate-editor-table-toolbar">
        <input
          type="search"
          className="form-input min-h-11 text-sm sm:min-h-0"
          style={{ width: "220px" }}
          placeholder="Rechercher..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          data-testid="estimate-editor-search-input"
        />
        <div className="flex-1 min-w-0" />
        {onOpenSettings ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onOpenSettings}
            data-testid="estimate-editor-settings-button"
          >
            Parametres
          </button>
        ) : null}
        <KeyboardShortcutsButton />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isSimplifiedMode ? "gap-1" : "gap-2"}`} data-testid="estimate-editor-table-toolbar">
      {/* Row 1 — Edit actions */}
      <div
        className={`flex items-center gap-2 ${isCompactViewport ? "flex-nowrap" : "flex-wrap"}`}
      >
        {/* Undo / Redo group */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-subtle px-1 py-1 sm:px-2">
          <button
            className={`btn btn-ghost btn-sm px-2 ${isCompactViewport ? "h-11 w-11" : ""}`}
            type="button"
            onClick={() => void onUndo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canUndo}
            aria-label="Annuler la dernière action"
            title="Annuler (Ctrl+Z)"
            data-testid="estimate-editor-undo-button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
            <span className={isCompactViewport ? "sr-only" : "text-xs"}>
              Annuler
            </span>
          </button>
          <button
            className={`btn btn-ghost btn-sm px-2 ${isCompactViewport ? "h-11 w-11" : ""}`}
            type="button"
            onClick={() => void onRedo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canRedo}
            aria-label="Rétablir la dernière action"
            title="Rétablir (Ctrl+Y)"
            data-testid="estimate-editor-redo-button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></svg>
            <span className={isCompactViewport ? "sr-only" : "text-xs"}>
              Rétablir
            </span>
          </button>
        </div>

        {!isCompactViewport ? <div className="h-5 w-px bg-slate-200" /> : null}

        {/* Primary actions */}
        {isCompactViewport ? (
          <div className="relative shrink-0" ref={primaryActionsContainerRef}>
            <button
              className="btn btn-secondary btn-sm h-10 whitespace-nowrap"
              type="button"
              onClick={primaryActionsToggle}
              aria-expanded={primaryActionsOpen}
              aria-haspopup="menu"
              aria-controls={PRIMARY_ACTIONS_PANEL_ID}
              data-testid="estimate-editor-primary-actions-button"
            >
              Actions
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {primaryActionsOpen ? (
              <div
                id={PRIMARY_ACTIONS_PANEL_ID}
                role="menu"
                aria-label="Actions du devis"
                className="absolute bottom-full right-0 z-40 mb-2 flex max-h-[calc(100vh-32px)] flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl"
                style={{ width: "min(280px, calc(100vw - 32px))" }}
              >
                {onExpandAllSections ? (
                  <button
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      primaryActionsClose();
                      onExpandAllSections();
                    }}
                    data-testid="estimate-editor-expand-all-sections-button"
                  >
                    Tout déplier
                  </button>
                ) : null}
                {onCollapseAllSections ? (
                  <button
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      primaryActionsClose();
                      onCollapseAllSections();
                    }}
                    data-testid="estimate-editor-collapse-all-sections-button"
                  >
                    Tout replier
                  </button>
                ) : null}
                {onOpenImportFromEstimateDialog ? (
                  <button
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      primaryActionsClose();
                      onOpenImportFromEstimateDialog();
                    }}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-import-from-estimate-button"
                  >
                    Importer depuis un devis
                  </button>
                ) : null}
                {onOpenEstimateStructureDraftDialog ||
                onOpenGeneratedOuvrageDialog ? (
                  <div className="my-1 border-t border-border pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Assistants optionnels
                  </div>
                ) : null}
                {onOpenEstimateStructureDraftDialog ? (
                  <button
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      primaryActionsClose();
                      onOpenEstimateStructureDraftDialog();
                    }}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-open-structure-draft-button"
                  >
                    Structure IA
                  </button>
                ) : null}
                {onOpenGeneratedOuvrageDialog ? (
                  <button
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      primaryActionsClose();
                      onOpenGeneratedOuvrageDialog();
                    }}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-open-generated-ouvrage-button"
                  >
                    Générer des ouvrages
                  </button>
                ) : null}
                {onOpenSettings ? (
                  <button
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      primaryActionsClose();
                      onOpenSettings();
                    }}
                    data-testid="estimate-editor-settings-button"
                  >
                    Paramétrage
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {onExpandAllSections ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onExpandAllSections} data-testid="estimate-editor-expand-all-sections-button">Tout déplier</button>
            ) : null}
            {onCollapseAllSections ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onCollapseAllSections} data-testid="estimate-editor-collapse-all-sections-button">Tout replier</button>
            ) : null}
            {onOpenImportFromEstimateDialog ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={onOpenImportFromEstimateDialog} disabled={meta.isReadOnly} data-testid="estimate-editor-import-from-estimate-button">Importer depuis...</button>
            ) : null}
            {onOpenEstimateStructureDraftDialog || onOpenGeneratedOuvrageDialog ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400"
                title="Assistants optionnels : ils proposent du contenu à valider sans remplacer le flux principal."
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5" />
                  <path d="M12 8h.01" />
                </svg>
                Assistants optionnels
              </span>
            ) : null}
            {onOpenEstimateStructureDraftDialog ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={onOpenEstimateStructureDraftDialog} disabled={meta.isReadOnly} data-testid="estimate-editor-open-structure-draft-button">Structure IA</button>
            ) : null}
            {onOpenGeneratedOuvrageDialog ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={onOpenGeneratedOuvrageDialog} disabled={meta.isReadOnly} data-testid="estimate-editor-open-generated-ouvrage-button">Générer des ouvrages</button>
            ) : null}
            <div className="min-w-0 flex-1" />
            {onOpenSettings ? (
              <>
                <div className="h-5 w-px bg-slate-200" />
                <button className="btn btn-ghost btn-sm flex items-center gap-1.5" type="button" onClick={onOpenSettings} title="Paramétrage" data-testid="estimate-editor-settings-button">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span>Paramétrage</span>
                </button>
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Row 2 — View & filter */}
      <div
        className={
          isCompactViewport && !isSimplifiedMode
            ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
            : `flex flex-wrap items-center ${isSimplifiedMode ? "gap-1.5" : "gap-2"}`
        }
      >
        <input
          type="search"
          className={`form-input text-sm ${isCompactViewport ? "h-11 min-h-11 w-full min-w-0" : "h-8"}`}
          style={isCompactViewport ? undefined : { width: "160px" }}
          placeholder="Rechercher..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          data-testid="estimate-editor-search-input"
        />
        {/* Compact overflow menu — keeps mobile and tablet controls touch-friendly. */}
        {isCompactViewport && !isSimplifiedMode ? (
          <div className="relative" ref={overflowContainerRef}>
            <button
              className="btn btn-secondary btn-sm h-11 whitespace-nowrap"
              type="button"
              onClick={overflowToggle}
              aria-expanded={overflowOpen}
              aria-haspopup="dialog"
              data-testid="estimate-editor-overflow-button"
            >
              Plus...
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`ml-0.5 transition-transform ${overflowOpen ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {overflowOpen && (
              <div
                role="dialog"
                aria-label="Insertion et affichage"
                className="absolute bottom-full right-0 z-30 mb-2 flex max-h-[calc(100vh-32px)] flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl"
                style={{ width: "min(300px, calc(100vw - 32px))" }}
              >
                {/* Quick insert buttons */}
                {onToggleQuickTemplatePicker && (
                  <button
                    className={`btn btn-sm min-h-10 w-full justify-start ${isQuickTemplatePickerOpen ? "btn-primary" : "btn-ghost"}`}
                    type="button"
                    onClick={() => { overflowToggle(); onToggleQuickTemplatePicker(); }}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-quick-template-button"
                  >
                    + Template
                  </button>
                )}
                {onToggleQuickAssemblyPicker && (
                  <button
                    className={`btn btn-sm min-h-10 w-full justify-start ${isQuickAssemblyPickerOpen ? "btn-primary" : "btn-ghost"}`}
                    type="button"
                    onClick={() => { overflowToggle(); onToggleQuickAssemblyPicker(); }}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-quick-assembly-button"
                  >
                    + Ouvrage
                  </button>
                )}
                <div className="my-1 border-t border-border" />
                {/* Colonnes */}
                <button
                  className="btn btn-ghost btn-sm min-h-10 w-full justify-between"
                  type="button"
                  onClick={() => {
                    if (!columnsOpen && anomaliesOpen) anomaliesToggle();
                    columnsToggle();
                  }}
                  aria-expanded={columnsOpen}
                  aria-controls={COLUMNS_PANEL_ID}
                  data-testid="estimate-editor-columns-button"
                >
                  Colonnes
                  <span className="text-xs text-muted-foreground">
                    {columnPresetLabels[columnPreset]}
                  </span>
                </button>
                {columnsOpen ? (
                  <div
                    id={COLUMNS_PANEL_ID}
                    role="group"
                    aria-label="Choisir les colonnes"
                  >
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-subtle p-1.5">
                      {availableColumnPresets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`btn btn-sm min-h-9 ${columnPreset === preset ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => onColumnPresetChange(preset)}
                        >
                          {columnPresetLabels[preset]}
                        </button>
                      ))}
                    </div>
                    {columnPreset === "custom" ? (
                      <div className="mt-1 space-y-1 rounded-lg border border-border p-2">
                        {allAdvancedColumns.map((column) => (
                          <label
                            key={column}
                            className="flex min-h-9 items-center gap-2 text-sm text-secondary-foreground"
                          >
                            <input
                              type="checkbox"
                              checked={columnVisibleColumns.has(column)}
                              onChange={() => onToggleColumn(column)}
                            />
                            {columnLabels[column]}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* Anomalies */}
                {qualityCounts.linesWithAnomaliesCount > 0 && (
                  <>
                    <button
                      className={`btn btn-sm min-h-10 w-full justify-between ${qualityFilter !== "all_lines" ? "btn-primary" : "btn-ghost"}`}
                      type="button"
                      onClick={() => {
                        if (!anomaliesOpen && columnsOpen) columnsToggle();
                        anomaliesToggle();
                      }}
                      aria-expanded={anomaliesOpen}
                      aria-controls={ANOMALIES_PANEL_ID}
                      data-testid="estimate-editor-anomalies-button"
                    >
                      Anomalies
                      <span>{qualityCounts.linesWithAnomaliesCount}</span>
                    </button>
                    {anomaliesOpen ? (
                      <div
                        id={ANOMALIES_PANEL_ID}
                        role="group"
                        className="flex flex-col gap-1 rounded-lg bg-orange-50 p-1.5"
                        aria-label="Filtrer les anomalies"
                      >
                        <button
                          type="button"
                          className={`rounded-md px-3 py-2 text-left text-sm ${qualityFilter === "all_lines" ? "bg-white font-semibold" : ""}`}
                          onClick={() => onQualityFilterChange("all_lines")}
                        >
                          Toutes les lignes ({qualityCounts.linesCount})
                        </button>
                        <button
                          type="button"
                          className={`rounded-md px-3 py-2 text-left text-sm ${qualityFilter === "with_anomalies" ? "bg-white font-semibold text-orange-800" : ""}`}
                          onClick={() => onQualityFilterChange("with_anomalies")}
                        >
                          Lignes avec anomalies ({qualityCounts.linesWithAnomaliesCount})
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
                {/* Outils */}
                <div ref={toolsContainerRef}>
                  <button
                    ref={toolsButtonRef}
                    className="btn btn-ghost btn-sm min-h-10 w-full justify-start"
                    type="button"
                    onClick={toolsToggle}
                    aria-expanded={toolsOpen}
                    aria-haspopup="dialog"
                    aria-controls={TOOLS_PANEL_ID}
                    data-testid="estimate-editor-tools-button"
                  >
                    Outils avancés
                  </button>
                </div>
                <div className="flex min-h-10 items-center justify-between rounded-lg px-3 text-sm text-secondary-foreground">
                  <span>Raccourcis clavier</span>
                  <KeyboardShortcutsButton />
                </div>
              </div>
            )}
            {/* Picker nodes rendered outside overflow for correct positioning */}
            {quickTemplatePickerNode}
            {quickAssemblyPickerNode}
          </div>
        ) : (
          <>
        {/* UX2-022: Quick insert buttons — Expert mode only */}
        {!isSimplifiedMode && onToggleQuickTemplatePicker && (
          <div className="relative">
            <button
              className={`btn btn-sm ${isQuickTemplatePickerOpen ? "btn-primary" : "btn-secondary"}`}
              type="button"
              onClick={onToggleQuickTemplatePicker}
              disabled={meta.isReadOnly}
              title="Inserer un template"
              data-testid="estimate-editor-quick-template-button"
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
              title="Inserer un ouvrage"
              data-testid="estimate-editor-quick-assembly-button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>
              <span className="text-xs">+ Ouvrage</span>
            </button>
            {quickAssemblyPickerNode}
          </div>
        )}
        {isSimplifiedMode ? (
          isLaborSplitEnabled ? null : (
            <button
              className={`btn btn-sm ${hiddenAdvancedCount === 0 ? "btn-primary" : "btn-secondary"}`}
              type="button"
              onClick={onToggleAdvancedColumns}
              data-testid="estimate-editor-toggle-advanced-columns-button"
            >
              Colonnes avancées
              {hiddenAdvancedCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-bold leading-4 text-primary">
                  +{hiddenAdvancedCount}
                </span>
              )}
            </button>
          )
        ) : (
          <div className="relative" ref={columnsContainerRef}>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={columnsToggle}
              aria-expanded={columnsOpen}
              aria-haspopup="dialog"
              aria-controls={COLUMNS_PANEL_ID}
              data-testid="estimate-editor-columns-button"
            >
              Colonnes
            </button>
            {columnsOpen && (
              <div
                id={COLUMNS_PANEL_ID}
                role="dialog"
                aria-label="Choisir les colonnes"
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
        )}
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
              aria-expanded={anomaliesOpen}
              aria-haspopup="dialog"
              aria-controls={ANOMALIES_PANEL_ID}
              data-testid="estimate-editor-anomalies-button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {qualityCounts.linesWithAnomaliesCount} anomalie{qualityCounts.linesWithAnomaliesCount > 1 ? "s" : ""}
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {anomaliesOpen && (
              <div
                id={ANOMALIES_PANEL_ID}
                role="dialog"
                aria-label="Filtrer les anomalies"
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
              ref={toolsButtonRef}
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={toolsToggle}
              aria-expanded={toolsOpen}
              aria-haspopup="dialog"
              aria-controls={TOOLS_PANEL_ID}
              data-testid="estimate-editor-tools-button"
            >
              Outils
            </button>
          </div>
        )}
          </>
        )}
        {toolsOpen && createPortal(
              <div
                ref={toolsPanelRef}
                id={TOOLS_PANEL_ID}
                role="dialog"
                aria-label="Outils du devis"
                tabIndex={-1}
                onMouseDown={(event) => event.stopPropagation()}
                className="fixed z-20 flex flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-xl"
                style={
                  toolsPanelPosition
                    ? {
                        left: `${toolsPanelPosition.left}px`,
                        top: `${toolsPanelPosition.top}px`,
                        width: `${toolsPanelPosition.width}px`,
                        maxHeight: `${toolsPanelPosition.maxHeight}px`,
                      }
                    : {
                        left: `${POPOVER_VIEWPORT_PADDING}px`,
                        top: 0,
                        width: `min(${TOOLS_PANEL_WIDTH}px, calc(100vw - ${POPOVER_VIEWPORT_PADDING * 2}px))`,
                        maxHeight: `calc(100vh - ${POPOVER_VIEWPORT_PADDING * 2}px)`,
                        visibility: "hidden",
                      }
                }
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label
                    className="typo-label text-muted-foreground"
                    htmlFor="estimate-quality-filter"
                  >
                    Filtre qualité
                  </label>
                  <select
                    id="estimate-quality-filter"
                    className="estimate-input estimate-select min-w-0 flex-1"
                    style={{ width: "auto" }}
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
                    className="typo-label text-orange-700"
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
                    data-testid="estimate-editor-bulk-suggestions-button"
                  >
                      Suggestions ({bulkSuggestionEligibleCount})
                    </button>
                  ) : null}
                  {supplierPreselectionEligibleCount > 0 ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={onOpenSupplierPreselectionDialog}
                      disabled={meta.isReadOnly}
                      data-testid="estimate-editor-supplier-preselection-button"
                    >
                      Préselection fournisseurs ({supplierPreselectionEligibleCount})
                    </button>
                  ) : null}
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={onOpenAssemblyPicker}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-assemblies-button"
                  >
                    Ouvrages
                  </button>
                </div>
              </div>,
              document.body
        )}
        {!isCompactViewport ? <KeyboardShortcutsButton /> : null}
      </div>

      {/* Bulk selection bar */}
      {!isViewerMode && state.hasSelectedLines ? (
        <>
        <div
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-surface px-6 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
          data-testid="estimate-editor-bulk-selection-bar"
        >
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
            data-testid="estimate-editor-bulk-majoration-input"
          />
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void onApplyBulkMajoration()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
            data-testid="estimate-editor-bulk-majoration-apply-button"
          >
            Appliquer majoration
          </button>
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <label
            className="typo-label text-muted-foreground"
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
            data-testid="estimate-editor-bulk-move-apply-button"
          >
            Appliquer
          </button>
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <label
            className="typo-label text-muted-foreground"
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
            data-testid="estimate-editor-bulk-category-apply-button"
          >
            Appliquer
          </button>
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <label
            className="typo-label text-muted-foreground"
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
            data-testid="estimate-editor-bulk-labor-role-apply-button"
          >
            Appliquer
          </button>
          <div className="mx-1 h-4 w-px bg-slate-300" />
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={() => void onBulkDeleteSelection()}
            disabled={meta.isReadOnly || !state.hasSelectedLines}
            data-testid="estimate-editor-bulk-delete-selection-button"
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
  { keys: ["Ctrl", "Shift", "A"], description: "Ouvrir le sélecteur d'ouvrages" },
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
        data-testid="estimate-editor-keyboard-shortcuts-button"
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

"use client";

import { EstimateColumnOrderControls } from "@/components/estimates/components/EstimateColumnOrderControls";
import { EstimateBulkSelectionBar, type BulkMoveDestination, type EstimateCategory, type LaborRole } from "@/components/estimates/components/EstimateBulkSelectionBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  ESTIMATE_QUALITY_FLAG_KEYS,
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagCounts,
} from "@/lib/estimate-quality";
import {
  useEstimateEditorMeta,
} from "@/components/estimates/context/EstimateEditorContext";
import { usePopover } from "@/hooks/usePopover";
import type { ColumnKey, ColumnPreset } from "@/hooks/useColumnVisibility";
import type { EstimateColumnId } from "@/hooks/useEstimateColumnWidths";
import type { EstimateQualityFilter } from "@/lib/estimates/editor-quality-filter";
import type { EstimateOutlierMethod } from "@/lib/estimates/outlier-detection";
import { parseNumberInput } from "@/lib/estimates/editor-values";
import { cn } from "@/lib/utils";
import type { UiMode } from "@/lib/ui-mode";

type EstimateEditorCommandBarProps = {
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
  onOpenPriceReuseDialog?: () => void;
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
  columnOrder?: readonly EstimateColumnId[];
  onMoveColumn?: (id: EstimateColumnId, direction: -1 | 1) => void;
  onResetColumns?: () => void;
  isFinalizationPanelOpen?: boolean;
  onToggleFinalizationPanel?: () => void;
  isLaborSplitEnabled?: boolean;
  /* UX2-022: Quick insert pickers */
  onToggleQuickTemplatePicker?: () => void;
  quickTemplatePickerNode?: React.ReactNode;
  /** Moteur 3, brouillon modifiable : actualisation des K FO automatiques, toujours accessible dans « Contrôles ». */
  kfoRefresh?: {
    automaticCount: number;
    staleCount: number;
    onRefresh: () => void;
  };
};

const INSERT_PANEL_ID = "estimate-editor-insert-panel";
const DISPLAY_PANEL_ID = "estimate-editor-display-panel";
const CONTROLS_PANEL_ID = "estimate-editor-controls-panel";
/** Menus opened from the right-hand end of the toolbar (the search field takes the free width): aligned to their button's right edge. */
const RIGHT_PANEL_CLASS =
  "absolute right-0 top-full z-40 mt-2 max-h-[min(620px,calc(100vh-120px))] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-dropdown";
const SECTION_STACK_CLASS =
  "[&>section+section]:mt-4 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-4";

/** Full-width entries of the ribbon panels (long labels may wrap). */
const PANEL_ITEM_CLASS =
  "min-h-11 w-full justify-start whitespace-normal py-2 text-left text-foreground-secondary";
const PANEL_SECTION_TITLE_CLASS =
  "text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground";

function parseEstimateQualityFilter(value: string): EstimateQualityFilter {
  if (value === "all_lines" || value === "with_anomalies") {
    return value;
  }
  if (ESTIMATE_QUALITY_FLAG_KEYS.includes(value as never)) {
    return value as EstimateQualityFilter;
  }
  return "all_lines";
}

function parseOutlierMethod(value: string): EstimateOutlierMethod {
  return value === "zscore" ? "zscore" : "iqr";
}

function PanelAction({ label, testId, onSelect, disabled }: {
  label: string;
  testId: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="md"
      className={PANEL_ITEM_CLASS}
      onClick={onSelect}
      disabled={disabled}
      data-testid={testId}
    >
      {label}
    </Button>
  );
}

function openCommandPalette() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
    }),
  );
}

export function EstimateEditorCommandBar({
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
  onOpenPriceReuseDialog,
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
  columnOrder,
  onMoveColumn,
  onResetColumns,
  isFinalizationPanelOpen = false,
  onToggleFinalizationPanel,
  isLaborSplitEnabled = false,
  onToggleQuickTemplatePicker,
  quickTemplatePickerNode,
  kfoRefresh,
}: EstimateEditorCommandBarProps) {
  const meta = useEstimateEditorMeta();
  const isSimplifiedMode = uiMode === "simplified";
  const availableColumnPresets = Object.keys(columnPresetLabels) as Array<keyof typeof columnPresetLabels>;
  const {
    isOpen: insertOpen,
    toggle: insertToggle,
    close: insertClose,
    setContainerRef: insertContainerRef,
  } = usePopover();
  const {
    isOpen: displayOpen,
    toggle: displayToggle,
    close: displayClose,
    setContainerRef: displayContainerRef,
  } = usePopover();
  const {
    isOpen: controlsOpen,
    toggle: controlsToggle,
    close: controlsClose,
    setContainerRef: controlsContainerRef,
  } = usePopover();
  // « Contrôles » n'a de contenu qu'avec la finalisation ou le mode Expert (qualité, traitements groupés).
  const hasControlsPanel =
    Boolean(onToggleFinalizationPanel) || Boolean(kfoRefresh) || !isSimplifiedMode;

  const commandButton = (
    <Button
      type="button"
      variant="ghost"
      size="md"
      className="min-h-10 text-foreground-secondary"
      onClick={openCommandPalette}
      title="Rechercher une action sans parcourir les menus. Raccourci : Ctrl+K."
      aria-keyshortcuts="Control+K"
      data-testid="estimate-editor-command-palette-button"
    >
      Commandes
      <kbd className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-micro font-semibold text-muted-foreground">
        Ctrl K
      </kbd>
    </Button>
  );

  const searchInput = (
    <Input
      type="search"
      size="sm"
      className="min-h-10 min-w-[220px] flex-1"
      placeholder="Rechercher dans le chiffrage…"
      aria-label="Rechercher dans le chiffrage"
      value={searchTerm}
      onChange={(event) => onSearchChange(event.target.value)}
      data-testid="estimate-editor-search-input"
    />
  );

  if (isViewerMode) {
    return (
      <div data-testid="estimate-editor-table-toolbar">
        <div
          className="production-ribbon__commands"
          role="toolbar"
          aria-label="Outils de consultation du chiffrage"
        >
          {searchInput}
          {onOpenSettings ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              className="min-h-10"
              onClick={onOpenSettings}
              data-testid="estimate-editor-settings-button"
            >
              Paramétrage
            </Button>
          ) : null}
          {commandButton}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="estimate-editor-table-toolbar">
      <div
        className="production-ribbon__commands"
        role="toolbar"
        aria-label="Outils du chiffrage"
      >
        <div className="relative shrink-0" ref={insertContainerRef}>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-10"
            onClick={() => {
              displayClose();
              controlsClose();
              insertToggle();
            }}
            aria-expanded={insertOpen}
            aria-controls={INSERT_PANEL_ID}
            title="Ajouter du contenu ou importer une structure existante."
            data-testid="estimate-editor-insert-button"
          >
            Insérer
          </Button>
          {insertOpen ? (
            <div
              id={INSERT_PANEL_ID}
              role="group"
              aria-label="Insérer dans le chiffrage"
              className="absolute left-0 top-full z-40 mt-2 flex w-[min(320px,calc(100vw-32px))] flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-dropdown"
            >
              {!isSimplifiedMode && onToggleQuickTemplatePicker ? (
                <PanelAction
                  label="Insérer un modèle"
                  testId="estimate-editor-quick-template-button"
                  onSelect={() => {
                    insertClose();
                    onToggleQuickTemplatePicker();
                  }}
                  disabled={meta.isReadOnly}
                />
              ) : null}
              <PanelAction
                label="Ajouter un ouvrage"
                testId="estimate-editor-assemblies-button"
                onSelect={() => {
                  insertClose();
                  onOpenAssemblyPicker();
                }}
                disabled={meta.isReadOnly}
              />
              {onOpenImportFromEstimateDialog ? (
                <PanelAction
                  label="Importer depuis un autre devis"
                  testId="estimate-editor-import-from-estimate-button"
                  onSelect={() => {
                    insertClose();
                    onOpenImportFromEstimateDialog();
                  }}
                  disabled={meta.isReadOnly}
                />
              ) : null}
              {onOpenEstimateStructureDraftDialog ||
              onOpenGeneratedOuvrageDialog ? (
                <div className="mt-1 border-t border-border px-2 pb-1 pt-3">
                  <p className="text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Assistants optionnels
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Proposent un contenu que vous gardez libre de valider.
                  </p>
                </div>
              ) : null}
              {onOpenEstimateStructureDraftDialog ? (
                <PanelAction
                  label="Proposer une structure avec l’IA"
                  testId="estimate-editor-open-structure-draft-button"
                  onSelect={() => {
                    insertClose();
                    onOpenEstimateStructureDraftDialog();
                  }}
                  disabled={meta.isReadOnly}
                />
              ) : null}
              {onOpenGeneratedOuvrageDialog ? (
                <PanelAction
                  label="Générer des ouvrages à valider"
                  testId="estimate-editor-open-generated-ouvrage-button"
                  onSelect={() => {
                    insertClose();
                    onOpenGeneratedOuvrageDialog();
                  }}
                  disabled={meta.isReadOnly}
                />
              ) : null}
            </div>
          ) : null}
          {quickTemplatePickerNode}
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-subtle p-1"
          role="group"
          aria-label="Historique des modifications"
        >
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="min-h-9 px-2.5"
            onClick={() => void onUndo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canUndo}
            aria-label="Annuler la dernière action"
            aria-keyshortcuts="Control+Z"
            title="Annuler la dernière modification. Raccourci : Ctrl+Z."
            data-testid="estimate-editor-undo-button"
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="min-h-9 px-2.5"
            onClick={() => void onRedo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canRedo}
            aria-label="Rétablir la dernière action"
            aria-keyshortcuts="Control+Y"
            title="Rétablir la modification annulée. Raccourci : Ctrl+Y."
            data-testid="estimate-editor-redo-button"
          >
            Rétablir
          </Button>
        </div>

        {searchInput}

        {hasControlsPanel ? (
          <div className="relative shrink-0" ref={controlsContainerRef}>
            <Button
              type="button"
              variant="outline"
              size="md"
              className="min-h-10"
              onClick={() => {
                insertClose();
                displayClose();
                controlsToggle();
              }}
              aria-expanded={controlsOpen}
              aria-haspopup="dialog"
              aria-controls={CONTROLS_PANEL_ID}
              title="Vérifier le chiffrage avant l’envoi : finalisation, anomalies et traitements groupés."
              data-testid="estimate-editor-controls-button"
            >
              Contrôles
              {qualityCounts.totalFlagsCount > 0 ? (
                <Badge variant="warning" size="sm">
                  {qualityCounts.totalFlagsCount}
                  <span className="sr-only">
                    {qualityCounts.totalFlagsCount > 1 ? " anomalies" : " anomalie"}
                  </span>
                </Badge>
              ) : null}
            </Button>
            {controlsOpen ? (
              <div
                id={CONTROLS_PANEL_ID}
                role="dialog"
                aria-label="Contrôles du chiffrage"
                className={cn(RIGHT_PANEL_CLASS, SECTION_STACK_CLASS)}
              >
                {onToggleFinalizationPanel ? (
                  <section aria-labelledby="estimate-display-finalization-title">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3
                          id="estimate-display-finalization-title"
                          className={PANEL_SECTION_TITLE_CLASS}
                        >
                          Finalisation
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Critères, blocages et anomalies avant l’envoi.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={isFinalizationPanelOpen ? "primary" : "outline"}
                        size="md"
                        className="min-h-10"
                        onClick={() => {
                          controlsClose();
                          onToggleFinalizationPanel();
                        }}
                        aria-pressed={isFinalizationPanelOpen}
                        data-testid="estimate-editor-toggle-finalization-button"
                      >
                        {isFinalizationPanelOpen ? "Masquer" : "Afficher"}
                      </Button>
                    </div>
                  </section>
                ) : null}
                {kfoRefresh ? (
                  <section aria-labelledby="estimate-controls-kfo-title">
                    <h3
                      id="estimate-controls-kfo-title"
                      className={PANEL_SECTION_TITLE_CLASS}
                    >
                      Coefficients K FO
                    </h3>
                    <p
                      className="mt-1 text-xs leading-relaxed text-muted-foreground"
                      data-testid="estimate-editor-kfo-refresh-status"
                    >
                      {kfoRefresh.automaticCount === 0
                        ? "Aucune ligne en K FO automatique : les coefficients saisis à la main sont conservés."
                        : kfoRefresh.staleCount === 0
                          ? "Tous les K FO automatiques suivent les coefficients enregistrés."
                          : `${kfoRefresh.staleCount} ligne${kfoRefresh.staleCount > 1 ? "s" : ""} à mettre à jour avec les coefficients enregistrés.`}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      className="mt-2 h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left"
                      onClick={() => {
                        controlsClose();
                        kfoRefresh.onRefresh();
                      }}
                      disabled={meta.isReadOnly}
                      data-testid="estimate-editor-kfo-refresh-button"
                    >
                      Actualiser les K FO automatiques
                    </Button>
                  </section>
                ) : null}
                {!isSimplifiedMode && qualityCounts.totalFlagsCount > 0 ? (
                  <section
                    aria-labelledby="estimate-display-quality-title"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        id="estimate-display-quality-title"
                        className="text-xs font-semibold uppercase tracking-[0.14em] text-warning"
                      >
                        Qualité
                      </h3>
                      <span className="text-xs text-warning">
                        {qualityCounts.totalFlagsCount} anomalie
                        {qualityCounts.totalFlagsCount > 1 ? "s" : ""}
                      </span>
                    </div>
                    <label
                      className="mt-2 block text-xs font-medium text-foreground-secondary"
                      htmlFor="estimate-display-quality-filter"
                    >
                      Lignes affichées
                    </label>
                    <NativeSelect
                      id="estimate-display-quality-filter"
                      size="sm"
                      wrapperClassName="mt-1"
                      value={qualityFilter}
                      onChange={(event) =>
                        onQualityFilterChange(
                          parseEstimateQualityFilter(event.target.value),
                        )
                      }
                    >
                      <option value="all_lines">
                        Toutes les lignes ({qualityCounts.linesCount})
                      </option>
                      <option value="with_anomalies">
                        Lignes concernées ({qualityCounts.linesWithAnomaliesCount})
                      </option>
                      {ESTIMATE_QUALITY_FLAG_KEYS.filter(
                        (flag) => qualityCounts.byFlag[flag] > 0,
                      ).map((flag) => (
                        <option key={flag} value={flag}>
                          {ESTIMATE_QUALITY_FLAG_META[flag].label} ({qualityCounts.byFlag[flag]})
                        </option>
                      ))}
                    </NativeSelect>
                  </section>
                ) : null}
                {!isSimplifiedMode ? (
                  <section
                    aria-labelledby="estimate-display-tools-title"
                  >
                    <h3
                      id="estimate-display-tools-title"
                      className={PANEL_SECTION_TITLE_CLASS}
                    >
                      Contrôles avancés
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Réglages de détection et traitements groupés du chiffrage.
                    </p>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                      <div>
                        <label
                          className="text-xs font-medium text-foreground-secondary"
                          htmlFor="estimate-outlier-method"
                        >
                          Détection des valeurs atypiques
                        </label>
                        <NativeSelect
                          id="estimate-outlier-method"
                          size="sm"
                          wrapperClassName="mt-1"
                          value={outlierDetectionMethod}
                          disabled={meta.isReadOnly}
                          onChange={(event) =>
                            onOutlierDetectionMethodChange(
                              parseOutlierMethod(event.target.value),
                            )
                          }
                        >
                          <option value="iqr">IQR</option>
                          <option value="zscore">Z-score</option>
                        </NativeSelect>
                      </div>
                      <div>
                        <label
                          className="text-xs font-medium text-foreground-secondary"
                          htmlFor="estimate-outlier-threshold"
                        >
                          Seuil
                        </label>
                        <Input
                          id="estimate-outlier-threshold"
                          size="sm"
                          className="mt-1"
                          type="number"
                          step="0.1"
                          min={0.1}
                          value={outlierThreshold}
                          disabled={meta.isReadOnly}
                          onChange={(event) => {
                            const value = parseNumberInput(event.target.value);
                            if (value !== null) onOutlierThresholdChange(value);
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      {bulkSuggestionEligibleCount > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left"
                          onClick={() => {
                            controlsClose();
                            onOpenBulkSuggestDialog();
                          }}
                          disabled={meta.isReadOnly}
                          data-testid="estimate-editor-bulk-suggestions-button"
                        >
                          Examiner {bulkSuggestionEligibleCount} suggestion
                          {bulkSuggestionEligibleCount > 1 ? "s" : ""}
                        </Button>
                      ) : null}
                      {supplierPreselectionEligibleCount > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left"
                          onClick={() => {
                            controlsClose();
                            onOpenSupplierPreselectionDialog();
                          }}
                          disabled={meta.isReadOnly}
                          data-testid="estimate-editor-supplier-preselection-button"
                        >
                          Présélectionner les fournisseurs ({supplierPreselectionEligibleCount})
                        </Button>
                      ) : null}
                      {onOpenPriceReuseDialog ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left"
                          onClick={() => {
                            controlsClose();
                            onOpenPriceReuseDialog();
                          }}
                          disabled={meta.isReadOnly}
                          data-testid="estimate-editor-price-reuse-button"
                        >
                          Reprendre les prix d’un devis
                        </Button>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="relative shrink-0" ref={displayContainerRef}>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-10"
            onClick={() => {
              insertClose();
              controlsClose();
              displayToggle();
            }}
            aria-expanded={displayOpen}
            aria-haspopup="dialog"
            aria-controls={DISPLAY_PANEL_ID}
            title="Choisir la structure visible et les colonnes, ouvrir le paramétrage."
            data-testid="estimate-editor-display-button"
          >
            Affichage
          </Button>
          {displayOpen ? (
            <div
              id={DISPLAY_PANEL_ID}
              role="dialog"
              aria-label="Options d’affichage du chiffrage"
              className={cn(RIGHT_PANEL_CLASS, SECTION_STACK_CLASS)}
            >
              <section
                aria-labelledby="estimate-display-structure-title"
              >
                <h3
                  id="estimate-display-structure-title"
                  className={PANEL_SECTION_TITLE_CLASS}
                >
                  Structure
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {onExpandAllSections ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      className="min-h-10"
                      onClick={onExpandAllSections}
                      data-testid="estimate-editor-expand-all-sections-button"
                    >
                      Tout déplier
                    </Button>
                  ) : null}
                  {onCollapseAllSections ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      className="min-h-10"
                      onClick={onCollapseAllSections}
                      data-testid="estimate-editor-collapse-all-sections-button"
                    >
                      Tout replier
                    </Button>
                  ) : null}
                </div>
              </section>
              <section
                aria-labelledby="estimate-display-columns-title"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3
                    id="estimate-display-columns-title"
                    className={PANEL_SECTION_TITLE_CLASS}
                  >
                    Colonnes
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {columnPresetLabels[columnPreset]}
                  </span>
                </div>
                {isSimplifiedMode && !isLaborSplitEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    className="mt-2 min-h-10 w-full justify-between"
                    onClick={onToggleAdvancedColumns}
                    data-testid="estimate-editor-toggle-advanced-columns-button"
                  >
                    Colonnes avancées
                    {hiddenAdvancedCount > 0 ? (
                      <Badge variant="brand" size="sm">
                        {hiddenAdvancedCount} masquées
                      </Badge>
                    ) : null}
                  </Button>
                ) : null}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {availableColumnPresets.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={columnPreset === preset ? "primary" : "outline"}
                      size="md"
                      className="min-h-10"
                      aria-pressed={columnPreset === preset}
                      onClick={() => onColumnPresetChange(preset)}
                    >
                      {columnPresetLabels[preset]}
                    </Button>
                  ))}
                </div>
                {columnPreset === "custom" ? (
                  <div className="mt-2 space-y-1 rounded-lg border border-border p-2">
                    {allAdvancedColumns.map((column) => (
                      <label
                        key={column}
                        className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground-secondary"
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={columnVisibleColumns.has(column)}
                          onChange={() => onToggleColumn(column)}
                        />
                        {columnLabels[column]}
                      </label>
                    ))}
                  </div>
                ) : null}
                {columnOrder && onMoveColumn ? (
                  <EstimateColumnOrderControls
                    order={columnOrder}
                    isLaborSplitEnabled={isLaborSplitEnabled}
                    onMoveColumn={onMoveColumn}
                  />
                ) : null}
                {onResetColumns ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    className="mt-3 h-auto min-h-9 w-full whitespace-normal py-2"
                    onClick={onResetColumns}
                  >
                    Réinitialiser les colonnes et leurs largeurs
                  </Button>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Préférences personnelles enregistrées sur ce navigateur. Le document client reste indépendant.
                </p>
              </section>
              {onOpenSettings ? (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="mt-4 h-auto min-h-11 w-full whitespace-normal py-2"
                  onClick={() => {
                    displayClose();
                    onOpenSettings();
                  }}
                  title="Ouvrir les paramètres de marge, TVA, arrondis et validité."
                  data-testid="estimate-editor-settings-button"
                >
                  Ouvrir le paramétrage du devis
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {commandButton}
      </div>

      <EstimateBulkSelectionBar
        bulkMoveDestinations={bulkMoveDestinations}
        categories={categories}
        laborRoles={laborRoles}
        onApplyBulkMove={onApplyBulkMove}
        onApplyBulkMajoration={onApplyBulkMajoration}
        onApplyBulkCategory={onApplyBulkCategory}
        onApplyBulkLaborRole={onApplyBulkLaborRole}
        onBulkDeleteSelection={onBulkDeleteSelection}
      />
    </div>
  );
}

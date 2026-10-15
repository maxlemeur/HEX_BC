"use client";

import { useState } from "react";
import { EstimateColumnOrderControls } from "@/components/estimates/components/EstimateColumnOrderControls";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  ESTIMATE_QUALITY_FLAG_KEYS,
  ESTIMATE_QUALITY_FLAG_META,
} from "@/lib/estimate-quality";
import {
  useEstimateEditorActions,
  useEstimateEditorContext,
  useEstimateEditorMeta,
} from "@/components/estimates/context/EstimateEditorContext";
import { usePopover } from "@/hooks/usePopover";
import { ProductionRibbonTabs } from "@/components/dashboard/ProductionRibbonTabs";
import type {
  EstimateEditorToolbarProps,
  EstimateQualityFilter,
} from "@/components/estimates/components/EstimateEditorToolbar";
import type { EstimateOutlierMethod } from "@/lib/estimates/outlier-detection";
import { parseNumberInput } from "@/lib/estimates/editor-values";
import { cn } from "@/lib/utils";

const ROOT_KEY = "root";
const INSERT_PANEL_ID = "estimate-editor-insert-panel";
const DISPLAY_PANEL_ID = "estimate-editor-display-panel";
const EDITOR_RIBBON_TABS = [
  {
    id: "chiffrage",
    label: "Chiffrage",
    panelId: "estimate-ribbon-panel-chiffrage",
  },
  {
    id: "insertion",
    label: "Insérer",
    panelId: "estimate-ribbon-panel-insertion",
  },
  {
    id: "display",
    label: "Affichage & contrôle",
    panelId: "estimate-ribbon-panel-display",
  },
] as const;

/** Full-width entries of the ribbon panels (long labels may wrap). */
const PANEL_ITEM_CLASS =
  "min-h-11 w-full justify-start whitespace-normal py-2 text-left text-foreground-secondary";
const PANEL_SECTION_TITLE_CLASS =
  "text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground";

type EditorRibbonTab = (typeof EDITOR_RIBBON_TABS)[number]["id"];

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
}: EstimateEditorToolbarProps) {
  const state = useEstimateEditorContext().state;
  const actions = useEstimateEditorActions();
  const meta = useEstimateEditorMeta();
  const isSimplifiedMode = uiMode === "simplified";
  const [activeRibbonTab, setActiveRibbonTab] =
    useState<EditorRibbonTab>("chiffrage");
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

  const commandButton = (
    <Button
      type="button"
      variant="outline"
      size="md"
      className="min-h-10"
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
        <ProductionRibbonTabs
          tabs={[
            {
              id: "consultation",
              label: "Consultation",
              panelId: "estimate-ribbon-panel-consultation",
            },
          ]}
          activeTab="consultation"
          onTabChange={() => undefined}
          ariaLabel="Onglets du ruban de consultation"
        />
        <div
          id="estimate-ribbon-panel-consultation"
          role="tabpanel"
          aria-labelledby="estimate-ribbon-panel-consultation-tab"
          className="production-ribbon__commands"
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
      <ProductionRibbonTabs
        tabs={EDITOR_RIBBON_TABS.map((tab) => ({
          ...tab,
          badge:
            tab.id === "display" ? qualityCounts.totalFlagsCount : undefined,
        }))}
        activeTab={activeRibbonTab}
        onTabChange={(tabId) => setActiveRibbonTab(tabId as EditorRibbonTab)}
        ariaLabel="Onglets métier du ruban de chiffrage"
      />
      <div
        id="estimate-ribbon-panel-chiffrage"
        role="tabpanel"
        aria-labelledby="estimate-ribbon-panel-chiffrage-tab"
        className="production-ribbon__commands"
        hidden={activeRibbonTab !== "chiffrage"}
      >
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
        {commandButton}
      </div>

      <div
        id="estimate-ribbon-panel-insertion"
        role="tabpanel"
        aria-labelledby="estimate-ribbon-panel-insertion-tab"
        className="production-ribbon__commands"
        hidden={activeRibbonTab !== "insertion"}
      >
        <div className="relative shrink-0" ref={insertContainerRef}>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-10"
            onClick={() => {
              displayClose();
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
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className={PANEL_ITEM_CLASS}
                  onClick={() => {
                    insertClose();
                    onToggleQuickTemplatePicker();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-quick-template-button"
                >
                  Insérer un modèle
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="md"
                className={PANEL_ITEM_CLASS}
                onClick={() => {
                  insertClose();
                  onOpenAssemblyPicker();
                }}
                disabled={meta.isReadOnly}
                data-testid="estimate-editor-assemblies-button"
              >
                Ajouter un ouvrage
              </Button>
              {onOpenImportFromEstimateDialog ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className={PANEL_ITEM_CLASS}
                  onClick={() => {
                    insertClose();
                    onOpenImportFromEstimateDialog();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-import-from-estimate-button"
                >
                  Importer depuis un autre devis
                </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className={PANEL_ITEM_CLASS}
                  onClick={() => {
                    insertClose();
                    onOpenEstimateStructureDraftDialog();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-open-structure-draft-button"
                >
                  Proposer une structure avec l’IA
                </Button>
              ) : null}
              {onOpenGeneratedOuvrageDialog ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className={PANEL_ITEM_CLASS}
                  onClick={() => {
                    insertClose();
                    onOpenGeneratedOuvrageDialog();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-open-generated-ouvrage-button"
                >
                  Générer des ouvrages à valider
                </Button>
              ) : null}
            </div>
          ) : null}
          {quickTemplatePickerNode}
        </div>
      </div>

      <div
        id="estimate-ribbon-panel-display"
        role="tabpanel"
        aria-labelledby="estimate-ribbon-panel-display-tab"
        className="production-ribbon__commands"
        hidden={activeRibbonTab !== "display"}
      >
        <div className="relative shrink-0" ref={displayContainerRef}>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-10"
            onClick={() => {
              insertClose();
              displayToggle();
            }}
            aria-expanded={displayOpen}
            aria-haspopup="dialog"
            aria-controls={DISPLAY_PANEL_ID}
            title="Choisir la structure visible, les colonnes et les contrôles qualité."
            data-testid="estimate-editor-display-button"
          >
            Afficher
            {qualityCounts.totalFlagsCount > 0 ? (
              <Badge variant="warning" size="sm">
                {qualityCounts.totalFlagsCount}
              </Badge>
            ) : null}
          </Button>
          {displayOpen ? (
            <div
              id={DISPLAY_PANEL_ID}
              role="dialog"
              aria-label="Options d’affichage du chiffrage"
              className="absolute left-0 top-full z-40 mt-2 max-h-[min(620px,calc(100vh-120px))] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-dropdown"
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
                        displayClose();
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

              <section
                className={
                  onToggleFinalizationPanel
                    ? "mt-4 border-t border-border pt-4"
                    : undefined
                }
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
                className="mt-4 border-t border-border pt-4"
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

              {!isSimplifiedMode && qualityCounts.totalFlagsCount > 0 ? (
                <section
                  className="mt-4 border-t border-border pt-4"
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
                  className="mt-4 border-t border-border pt-4"
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
                          displayClose();
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
                          displayClose();
                          onOpenSupplierPreselectionDialog();
                        }}
                        disabled={meta.isReadOnly}
                        data-testid="estimate-editor-supplier-preselection-button"
                      >
                        Présélectionner les fournisseurs ({supplierPreselectionEligibleCount})
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}

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
      </div>

      {state.hasSelectedLines ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-info-border bg-info-subtle px-3 py-2"
          role="group"
          data-testid="estimate-editor-bulk-selection-bar"
          aria-label="Actions sur les lignes sélectionnées"
        >
          <Badge variant="info">
            {state.selectedLineCount} ligne
            {state.selectedLineCount > 1 ? "s" : ""} sélectionnée
            {state.selectedLineCount > 1 ? "s" : ""}
          </Badge>

          <label className="sr-only" htmlFor="estimate-bulk-move-target">
            Déplacer les lignes sélectionnées vers
          </label>
          <NativeSelect
            id="estimate-bulk-move-target"
            size="sm"
            wrapperClassName="w-auto min-w-[170px]"
            value={state.bulkMoveParentId}
            onChange={(event) =>
              actions.setBulkMoveParentId(event.target.value)
            }
            disabled={meta.isReadOnly}
            title="Choisir le lot ou chapitre de destination."
          >
            {bulkMoveDestinations.map((destination) => (
              <option
                key={destination.id ?? ROOT_KEY}
                value={destination.id ?? ""}
              >
                {destination.label}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => void onApplyBulkMove()}
            disabled={meta.isReadOnly}
            title="Déplacer toutes les lignes sélectionnées vers la destination choisie."
            data-testid="estimate-editor-bulk-move-apply-button"
          >
            Déplacer
          </Button>

          <details className="relative">
            <summary
              className={cn(
                buttonVariants({ variant: "outline", size: "md" }),
                "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              )}
              title="Modifier la majoration, la catégorie ou le rôle de main-d’œuvre."
            >
              Modifier les attributs
            </summary>
            <div className="absolute right-0 top-full z-40 mt-2 w-[min(360px,calc(100vw-32px))] space-y-3 rounded-xl border border-border bg-surface p-3 shadow-dropdown">
              <div>
                <label
                  className="text-xs font-medium text-foreground-secondary"
                  htmlFor="estimate-bulk-majoration"
                >
                  Majoration MO (%)
                </label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="estimate-bulk-majoration"
                    size="sm"
                    className="min-w-0 flex-1"
                    type="number"
                    step="0.1"
                    min={0}
                    value={state.bulkMajorationPercent}
                    onChange={(event) =>
                      actions.setBulkMajorationPercent(event.target.value)
                    }
                    disabled={meta.isReadOnly}
                    aria-label="Majoration MO en pourcentage"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void onApplyBulkMajoration()}
                    disabled={meta.isReadOnly}
                    aria-label="Appliquer majoration"
                    data-testid="estimate-editor-bulk-majoration-apply-button"
                  >
                    Appliquer
                  </Button>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium text-foreground-secondary"
                  htmlFor="estimate-bulk-category"
                >
                  Catégorie
                </label>
                <div className="mt-1 flex gap-2">
                  <NativeSelect
                    id="estimate-bulk-category"
                    size="sm"
                    wrapperClassName="min-w-0 flex-1"
                    value={state.bulkCategoryId}
                    onChange={(event) =>
                      actions.setBulkCategoryId(event.target.value)
                    }
                    disabled={meta.isReadOnly}
                  >
                    <option value="">Aucune</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void onApplyBulkCategory()}
                    disabled={meta.isReadOnly}
                    aria-label="Appliquer la catégorie"
                    data-testid="estimate-editor-bulk-category-apply-button"
                  >
                    Appliquer
                  </Button>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium text-foreground-secondary"
                  htmlFor="estimate-bulk-labor-role"
                >
                  Rôle de main-d’œuvre
                </label>
                <div className="mt-1 flex gap-2">
                  <NativeSelect
                    id="estimate-bulk-labor-role"
                    size="sm"
                    wrapperClassName="min-w-0 flex-1"
                    value={state.bulkLaborRoleId}
                    onChange={(event) =>
                      actions.setBulkLaborRoleId(event.target.value)
                    }
                    disabled={meta.isReadOnly}
                  >
                    <option value="">Aucun</option>
                    {laborRoles.map((role) => (
                      <option
                        key={role.id}
                        value={role.id}
                        disabled={!role.is_active}
                      >
                        {role.name}
                        {!role.is_active ? " (inactif)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void onApplyBulkLaborRole()}
                    disabled={meta.isReadOnly}
                    aria-label="Appliquer le rôle de main-d’œuvre"
                    data-testid="estimate-editor-bulk-labor-role-apply-button"
                  >
                    Appliquer
                  </Button>
                </div>
              </div>
            </div>
          </details>

          <div className="min-w-0 flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={actions.clearLineSelection}
            disabled={meta.isReadOnly}
            title="Retirer la sélection sans modifier les lignes."
          >
            Désélectionner
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={() => void onBulkDeleteSelection()}
            disabled={meta.isReadOnly}
            title="Supprimer définitivement les lignes sélectionnées."
            data-testid="estimate-editor-bulk-delete-selection-button"
          >
            Supprimer
          </Button>
        </div>
      ) : null}
    </div>
  );
}

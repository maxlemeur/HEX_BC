"use client";

import {
  ESTIMATE_QUALITY_FLAG_KEYS,
  ESTIMATE_QUALITY_FLAG_META,
} from "@/lib/estimate-quality";
import {
  useEstimateEditorActions,
  useEstimateEditorMeta,
  useEstimateEditorState,
} from "@/components/estimates/context/EstimateEditorContext";
import { usePopover } from "@/hooks/usePopover";
import type {
  EstimateEditorToolbarProps,
  EstimateQualityFilter,
} from "@/components/estimates/components/EstimateEditorToolbar";
import type { EstimateOutlierMethod } from "@/lib/estimates/outlier-detection";

const ROOT_KEY = "root";
const INSERT_PANEL_ID = "estimate-editor-insert-panel";
const DISPLAY_PANEL_ID = "estimate-editor-display-panel";

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

function parseNumberInput(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
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
  isFinalizationPanelOpen = false,
  onToggleFinalizationPanel,
  isLaborSplitEnabled = false,
  onToggleQuickTemplatePicker,
  quickTemplatePickerNode,
}: EstimateEditorToolbarProps) {
  const state = useEstimateEditorState();
  const actions = useEstimateEditorActions();
  const meta = useEstimateEditorMeta();
  const isSimplifiedMode = uiMode === "simplified";
  const availableColumnPresets = isSimplifiedMode
    ? (["essential"] as const)
    : (Object.keys(columnPresetLabels) as Array<
        keyof typeof columnPresetLabels
      >);
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
    <button
      type="button"
      className="btn btn-secondary btn-sm min-h-10 shrink-0 whitespace-nowrap"
      onClick={openCommandPalette}
      title="Rechercher une action sans parcourir les menus. Raccourci : Ctrl+K."
      data-testid="estimate-editor-command-palette-button"
    >
      Commandes
      <kbd className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold">
        Ctrl K
      </kbd>
    </button>
  );

  if (isViewerMode) {
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="estimate-editor-table-toolbar"
      >
        <input
          type="search"
          className="form-input min-h-10 min-w-[220px] flex-1 text-sm"
          placeholder="Rechercher dans le chiffrage..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          data-testid="estimate-editor-search-input"
        />
        {onOpenSettings ? (
          <button
            className="btn btn-secondary btn-sm min-h-10"
            type="button"
            onClick={onOpenSettings}
            data-testid="estimate-editor-settings-button"
          >
            Paramétrage
          </button>
        ) : null}
        {commandButton}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="estimate-editor-table-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-subtle p-1">
          <button
            className="btn btn-ghost btn-sm min-h-9 px-2.5"
            type="button"
            onClick={() => void onUndo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canUndo}
            aria-label="Annuler la dernière action"
            title="Annuler la dernière modification. Raccourci : Ctrl+Z."
            data-testid="estimate-editor-undo-button"
          >
            Annuler
          </button>
          <button
            className="btn btn-ghost btn-sm min-h-9 px-2.5"
            type="button"
            onClick={() => void onRedo()}
            disabled={meta.isReadOnly || isUndoRedoBusy || !canRedo}
            aria-label="Rétablir la dernière action"
            title="Rétablir la modification annulée. Raccourci : Ctrl+Y."
            data-testid="estimate-editor-redo-button"
          >
            Rétablir
          </button>
        </div>

        <input
          type="search"
          className="form-input min-h-10 min-w-[220px] flex-1 text-sm"
          placeholder="Rechercher dans le chiffrage..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          data-testid="estimate-editor-search-input"
        />

        <div className="relative shrink-0" ref={insertContainerRef}>
          <button
            className="btn btn-secondary btn-sm min-h-10"
            type="button"
            onClick={() => {
              displayClose();
              insertToggle();
            }}
            aria-expanded={insertOpen}
            aria-haspopup="menu"
            aria-controls={INSERT_PANEL_ID}
            title="Ajouter du contenu ou importer une structure existante."
            data-testid="estimate-editor-insert-button"
          >
            Insérer
          </button>
          {insertOpen ? (
            <div
              id={INSERT_PANEL_ID}
              role="menu"
              aria-label="Insérer dans le chiffrage"
              className="absolute right-0 top-full z-40 mt-2 flex w-[min(320px,calc(100vw-32px))] flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-xl"
            >
              {!isSimplifiedMode && onToggleQuickTemplatePicker ? (
                <button
                  className="btn btn-ghost btn-sm min-h-11 w-full justify-start"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    insertClose();
                    onToggleQuickTemplatePicker();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-quick-template-button"
                >
                  Insérer un template
                </button>
              ) : null}
              <button
                className="btn btn-ghost btn-sm min-h-11 w-full justify-start"
                type="button"
                role="menuitem"
                onClick={() => {
                  insertClose();
                  onOpenAssemblyPicker();
                }}
                disabled={meta.isReadOnly}
                data-testid="estimate-editor-assemblies-button"
              >
                Ajouter un ouvrage
              </button>
              {onOpenImportFromEstimateDialog ? (
                <button
                  className="btn btn-ghost btn-sm min-h-11 w-full justify-start"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    insertClose();
                    onOpenImportFromEstimateDialog();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-import-from-estimate-button"
                >
                  Importer depuis un autre devis
                </button>
              ) : null}
              {onOpenEstimateStructureDraftDialog ||
              onOpenGeneratedOuvrageDialog ? (
                <div className="mt-1 border-t border-border px-2 pb-1 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Assistants optionnels
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Proposent un contenu que vous gardez libre de valider.
                  </p>
                </div>
              ) : null}
              {onOpenEstimateStructureDraftDialog ? (
                <button
                  className="btn btn-ghost btn-sm min-h-11 w-full justify-start"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    insertClose();
                    onOpenEstimateStructureDraftDialog();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-open-structure-draft-button"
                >
                  Proposer une structure avec l’IA
                </button>
              ) : null}
              {onOpenGeneratedOuvrageDialog ? (
                <button
                  className="btn btn-ghost btn-sm min-h-11 w-full justify-start"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    insertClose();
                    onOpenGeneratedOuvrageDialog();
                  }}
                  disabled={meta.isReadOnly}
                  data-testid="estimate-editor-open-generated-ouvrage-button"
                >
                  Générer des ouvrages à valider
                </button>
              ) : null}
            </div>
          ) : null}
          {quickTemplatePickerNode}
        </div>

        <div className="relative shrink-0" ref={displayContainerRef}>
          <button
            className="btn btn-secondary btn-sm min-h-10"
            type="button"
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
              <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                {qualityCounts.totalFlagsCount}
              </span>
            ) : null}
          </button>
          {displayOpen ? (
            <div
              id={DISPLAY_PANEL_ID}
              role="dialog"
              aria-label="Options d’affichage du chiffrage"
              className="absolute right-0 top-full z-40 mt-2 max-h-[min(620px,calc(100vh-120px))] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-xl"
            >
              {onToggleFinalizationPanel ? (
                <section aria-labelledby="estimate-display-finalization-title">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3
                        id="estimate-display-finalization-title"
                        className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        Finalisation
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Critères, blocages et anomalies avant l’envoi.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm min-h-10 shrink-0 ${
                        isFinalizationPanelOpen
                          ? "btn-primary"
                          : "btn-secondary"
                      }`}
                      onClick={() => {
                        displayClose();
                        onToggleFinalizationPanel();
                      }}
                      aria-pressed={isFinalizationPanelOpen}
                      data-testid="estimate-editor-toggle-finalization-button"
                    >
                      {isFinalizationPanelOpen ? "Masquer" : "Afficher"}
                    </button>
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
                  className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Structure
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {onExpandAllSections ? (
                    <button
                      className="btn btn-secondary btn-sm min-h-10"
                      type="button"
                      onClick={onExpandAllSections}
                      data-testid="estimate-editor-expand-all-sections-button"
                    >
                      Tout déplier
                    </button>
                  ) : null}
                  {onCollapseAllSections ? (
                    <button
                      className="btn btn-secondary btn-sm min-h-10"
                      type="button"
                      onClick={onCollapseAllSections}
                      data-testid="estimate-editor-collapse-all-sections-button"
                    >
                      Tout replier
                    </button>
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
                    className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Colonnes
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {columnPresetLabels[columnPreset]}
                  </span>
                </div>
                {isSimplifiedMode ? (
                  isLaborSplitEnabled ? null : (
                    <button
                      className="btn btn-secondary btn-sm mt-2 min-h-10 w-full justify-between"
                      type="button"
                      onClick={onToggleAdvancedColumns}
                      data-testid="estimate-editor-toggle-advanced-columns-button"
                    >
                      Colonnes avancées
                      {hiddenAdvancedCount > 0 ? (
                        <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
                          {hiddenAdvancedCount} masquées
                        </span>
                      ) : null}
                    </button>
                  )
                ) : (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {availableColumnPresets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`btn btn-sm min-h-10 ${
                            columnPreset === preset
                              ? "btn-primary"
                              : "btn-secondary"
                          }`}
                          onClick={() => onColumnPresetChange(preset)}
                        >
                          {columnPresetLabels[preset]}
                        </button>
                      ))}
                    </div>
                    {columnPreset === "custom" ? (
                      <div className="mt-2 space-y-1 rounded-lg border border-border p-2">
                        {allAdvancedColumns.map((column) => (
                          <label
                            key={column}
                            className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-secondary-foreground"
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
                  </>
                )}
              </section>

              {!isSimplifiedMode && qualityCounts.totalFlagsCount > 0 ? (
                <section
                  className="mt-4 border-t border-border pt-4"
                  aria-labelledby="estimate-display-quality-title"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3
                      id="estimate-display-quality-title"
                      className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700"
                    >
                      Qualité
                    </h3>
                    <span className="text-xs text-orange-700">
                      {qualityCounts.totalFlagsCount} anomalie
                      {qualityCounts.totalFlagsCount > 1 ? "s" : ""}
                    </span>
                  </div>
                  <label
                    className="mt-2 block text-xs font-medium text-secondary-foreground"
                    htmlFor="estimate-display-quality-filter"
                  >
                    Lignes affichées
                  </label>
                  <select
                    id="estimate-display-quality-filter"
                    className="estimate-input estimate-select mt-1 w-full"
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
                      Lignes concernées ({qualityCounts.linesWithAnomaliesCount}
                      )
                    </option>
                    {ESTIMATE_QUALITY_FLAG_KEYS.filter(
                      (flag) => qualityCounts.byFlag[flag] > 0,
                    ).map((flag) => (
                      <option key={flag} value={flag}>
                        {ESTIMATE_QUALITY_FLAG_META[flag].label} (
                        {qualityCounts.byFlag[flag]})
                      </option>
                    ))}
                  </select>
                </section>
              ) : null}

              {!isSimplifiedMode ? (
                <section
                  className="mt-4 border-t border-border pt-4"
                  aria-labelledby="estimate-display-tools-title"
                >
                  <h3
                    id="estimate-display-tools-title"
                    className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    title="Réglages de détection et traitements groupés du chiffrage."
                  >
                    Contrôles avancés
                  </h3>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                    <label
                      className="text-xs font-medium text-secondary-foreground"
                      htmlFor="estimate-outlier-method"
                    >
                      Détection des valeurs atypiques
                      <select
                        id="estimate-outlier-method"
                        className="estimate-input estimate-select mt-1 w-full"
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
                      </select>
                    </label>
                    <label
                      className="text-xs font-medium text-secondary-foreground"
                      htmlFor="estimate-outlier-threshold"
                    >
                      Seuil
                      <input
                        id="estimate-outlier-threshold"
                        className="estimate-input mt-1 w-full"
                        type="number"
                        step="0.1"
                        min={0.1}
                        value={outlierThreshold}
                        disabled={meta.isReadOnly}
                        onChange={(event) =>
                          onOutlierThresholdChange(
                            parseNumberInput(event.target.value),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {bulkSuggestionEligibleCount > 0 ? (
                      <button
                        className="btn btn-secondary btn-sm min-h-10 w-full justify-start"
                        type="button"
                        onClick={() => {
                          displayClose();
                          onOpenBulkSuggestDialog();
                        }}
                        disabled={meta.isReadOnly}
                        data-testid="estimate-editor-bulk-suggestions-button"
                      >
                        Examiner {bulkSuggestionEligibleCount} suggestion
                        {bulkSuggestionEligibleCount > 1 ? "s" : ""}
                      </button>
                    ) : null}
                    {supplierPreselectionEligibleCount > 0 ? (
                      <button
                        className="btn btn-secondary btn-sm min-h-10 w-full justify-start"
                        type="button"
                        onClick={() => {
                          displayClose();
                          onOpenSupplierPreselectionDialog();
                        }}
                        disabled={meta.isReadOnly}
                        data-testid="estimate-editor-supplier-preselection-button"
                      >
                        Présélectionner les fournisseurs (
                        {supplierPreselectionEligibleCount})
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {onOpenSettings ? (
                <button
                  className="btn btn-secondary btn-sm mt-4 min-h-11 w-full"
                  type="button"
                  onClick={() => {
                    displayClose();
                    onOpenSettings();
                  }}
                  title="Ouvrir les paramètres de marge, TVA, arrondis et validité."
                  data-testid="estimate-editor-settings-button"
                >
                  Ouvrir le paramétrage du devis
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {commandButton}
      </div>

      {state.hasSelectedLines ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2"
          data-testid="estimate-editor-bulk-selection-bar"
          aria-label="Actions sur les lignes sélectionnées"
        >
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
            {state.selectedLineCount} ligne
            {state.selectedLineCount > 1 ? "s" : ""} sélectionnée
            {state.selectedLineCount > 1 ? "s" : ""}
          </span>

          <label className="sr-only" htmlFor="estimate-bulk-move-target">
            Déplacer les lignes sélectionnées vers
          </label>
          <select
            id="estimate-bulk-move-target"
            className="estimate-input estimate-select min-h-9 min-w-[170px]"
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
          </select>
          <button
            className="btn btn-secondary btn-sm min-h-9"
            type="button"
            onClick={() => void onApplyBulkMove()}
            disabled={meta.isReadOnly}
            title="Déplacer toutes les lignes sélectionnées vers la destination choisie."
            data-testid="estimate-editor-bulk-move-apply-button"
          >
            Déplacer
          </button>

          <details className="relative">
            <summary
              className="btn btn-secondary btn-sm min-h-9 cursor-pointer list-none"
              title="Modifier la majoration, la catégorie ou le rôle de main-d’œuvre."
            >
              Modifier les attributs
            </summary>
            <div className="absolute right-0 top-full z-40 mt-2 w-[min(360px,calc(100vw-32px))] space-y-3 rounded-xl border border-border bg-surface p-3 shadow-xl">
              <div>
                <label
                  className="text-xs font-medium text-secondary-foreground"
                  htmlFor="estimate-bulk-majoration"
                >
                  Majoration MO (%)
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="estimate-bulk-majoration"
                    className="estimate-input min-w-0 flex-1"
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
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => void onApplyBulkMajoration()}
                    disabled={meta.isReadOnly}
                    aria-label="Appliquer majoration"
                    data-testid="estimate-editor-bulk-majoration-apply-button"
                  >
                    Appliquer
                  </button>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium text-secondary-foreground"
                  htmlFor="estimate-bulk-category"
                >
                  Catégorie
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    id="estimate-bulk-category"
                    className="estimate-input estimate-select min-w-0 flex-1"
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
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => void onApplyBulkCategory()}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-bulk-category-apply-button"
                  >
                    Appliquer
                  </button>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium text-secondary-foreground"
                  htmlFor="estimate-bulk-labor-role"
                >
                  Rôle de main-d’œuvre
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    id="estimate-bulk-labor-role"
                    className="estimate-input estimate-select min-w-0 flex-1"
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
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => void onApplyBulkLaborRole()}
                    disabled={meta.isReadOnly}
                    data-testid="estimate-editor-bulk-labor-role-apply-button"
                  >
                    Appliquer
                  </button>
                </div>
              </div>
            </div>
          </details>

          <div className="min-w-0 flex-1" />
          <button
            className="btn btn-ghost btn-sm min-h-9"
            type="button"
            onClick={actions.clearLineSelection}
            disabled={meta.isReadOnly}
            title="Retirer la sélection sans modifier les lignes."
          >
            Désélectionner
          </button>
          <button
            className="btn btn-danger btn-sm min-h-9"
            type="button"
            onClick={() => void onBulkDeleteSelection()}
            disabled={meta.isReadOnly}
            title="Supprimer définitivement les lignes sélectionnées."
            data-testid="estimate-editor-bulk-delete-selection-button"
          >
            Supprimer
          </button>
        </div>
      ) : null}
    </div>
  );
}

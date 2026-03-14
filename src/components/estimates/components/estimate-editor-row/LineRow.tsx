"use client";
/* eslint-disable react-hooks/refs */

import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { EditableCell } from "@/components/estimates/EditableCell";
import { TakeoffSourceBadge } from "@/components/takeoff/TakeoffSourceBadge";
import { EstimateLineTruthBadges } from "@/components/estimates/components/estimate-editor-row/EstimateLineTruthBadges";
import {
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  ESTIMATE_OUTLIER_FLAG_KEYS,
  type EstimateOutlierFlagKey,
} from "@/lib/estimates/outlier-detection";
import {
  buildTreeConnectorSegments,
  type TreeConnectorMeta,
} from "@/lib/estimates/tree-connectors";
import {
  formatCurrency,
  parseCurrencyToCents,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import {
  type SpreadsheetCell,
  type SpreadsheetCellProps,
  type SpreadsheetEditorProps,
  type SpreadsheetNavigationResult,
} from "@/hooks/useSpreadsheetNavigation";
import {
  CatalogueSuggestionsPopover,
} from "@/components/estimates/components/estimate-editor-row/CatalogueSuggestionsPopover";
import {
  LaborSplitCells,
} from "@/components/estimates/components/estimate-editor-row/LaborSplitCells";
import {
  StandardMoCells,
} from "@/components/estimates/components/estimate-editor-row/StandardMoCells";
import {
  type CataloguePriceSuggestion,
  type ColumnVisibilitySet,
  type EstimateItem,
  type ItemPatch,
  type LaborRole,
  type SupplierAlternative,
  formatCentsInput,
  formatNumberDisplay,
  getQualityFlagCellTarget,
  parseNumberInput,
  readLaborSplitFields,
  toCellClassName,
  toCellKeyDownHandler,
} from "@/components/estimates/components/estimate-editor-row/shared";

type LineRowProps = {
  versionId: string;
  item: EstimateItem;
  depth: number;
  estimateCurrency: SupportedEstimateCurrency;
  navigation: SpreadsheetNavigationResult;
  indentStyle: CSSProperties & { "--row-depth": string };
  style: CSSProperties;
  setNodeRef: (element: HTMLElement | null) => void;
  treeConnectorMeta: TreeConnectorMeta;
  titleCell: SpreadsheetCell;
  titleCellProps: SpreadsheetCellProps;
  titleEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  quantityCell: SpreadsheetCell;
  unitCell: SpreadsheetCell;
  unitCellProps: SpreadsheetCellProps;
  unitEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  unitPriceCell: SpreadsheetCell;
  supplyTypeCell: SpreadsheetCell;
  supplyTypeCellProps: SpreadsheetCellProps;
  supplyTypeEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  kFoCell: SpreadsheetCell;
  kFoCellProps: SpreadsheetCellProps;
  kFoEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoCell: SpreadsheetCell;
  hMoCellProps: SpreadsheetCellProps;
  hMoEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoMajorationCell: SpreadsheetCell;
  hMoMajorationCellProps: SpreadsheetCellProps;
  hMoMajorationEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  laborRoleCell: SpreadsheetCell;
  laborRoleCellProps: SpreadsheetCellProps;
  laborRoleEditorProps: SpreadsheetEditorProps<HTMLSelectElement>;
  kMoCell: SpreadsheetCell;
  kMoCellProps: SpreadsheetCellProps;
  kMoEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoAtelierCell: SpreadsheetCell;
  hMoAtelierCellProps: SpreadsheetCellProps;
  hMoAtelierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  laborRoleAtelierCell: SpreadsheetCell;
  laborRoleAtelierCellProps: SpreadsheetCellProps;
  laborRoleAtelierEditorProps: SpreadsheetEditorProps<HTMLSelectElement>;
  kMoAtelierCell: SpreadsheetCell;
  kMoAtelierCellProps: SpreadsheetCellProps;
  kMoAtelierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoChantierCell: SpreadsheetCell;
  hMoChantierCellProps: SpreadsheetCellProps;
  hMoChantierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  laborRoleChantierCell: SpreadsheetCell;
  laborRoleChantierCellProps: SpreadsheetCellProps;
  laborRoleChantierEditorProps: SpreadsheetEditorProps<HTMLSelectElement>;
  kMoChantierCell: SpreadsheetCell;
  kMoChantierCellProps: SpreadsheetCellProps;
  kMoChantierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  puCell: SpreadsheetCell;
  puCellProps: SpreadsheetCellProps;
  totalCell: SpreadsheetCell;
  totalCellProps: SpreadsheetCellProps;
  unitValue: string;
  supplyTypeValue: string;
  qualityFlags: EstimateQualityFlagKey[];
  detectedOutlierFlags: EstimateOutlierFlagKey[];
  dismissedOutlierFlags: EstimateOutlierFlagKey[];
  laborRoles: LaborRole[];
  visibleColumns?: ColumnVisibilitySet;
  isLineSelected: boolean;
  hasSupplierComparisonMismatch: boolean;
  isOutlierActionPending: boolean;
  isReadOnly: boolean;
  hideEditingActions: boolean;
  isLaborSplitEnabled: boolean;
  isPendingCreate: boolean;
  isSearchMatch?: boolean;
  lineTotal: number;
  kFoValue: number;
  hMoValue: number;
  hMoMajorationPercent: string;
  kMoValue: number;
  sourceLevel: string | null;
  sourceExtractedAt: string | null;
  sourceMetadata: unknown;
  showCatalogueSuggestions: boolean;
  catalogueListboxId: string;
  catalogueSuggestions: CataloguePriceSuggestion[];
  isCatalogueLoading: boolean;
  catalogueError: string | null;
  activeCatalogueSuggestionIndex: number;
  onApplyCatalogueSuggestion: (
    suggestion: CataloguePriceSuggestion,
    alternative?: SupplierAlternative
  ) => void;
  handleLineTitleFocus: (event: FocusEvent<HTMLInputElement>) => void;
  handleLineTitleBlur: (event: FocusEvent<HTMLInputElement>) => void;
  handleLineTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  aidInput: ReactNode;
  isAidEditorVisible: boolean;
  dragHandle: ReactNode;
  onRevealAidEditor: () => void;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onUnitChange: (itemId: string, value: string) => void;
  onUnitCommit: (itemId: string) => void;
  onSupplyTypeChange: (itemId: string, value: string) => void;
  onSupplyTypeCommit: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onOpenSupplierComparisonPanel: (itemId: string) => void;
  onOpenSupplierComparisonContextMenu: (
    itemId: string,
    position: { x: number; y: number }
  ) => void;
  onConvertLineToSection: (lineId: string) => void;
  onToggleOutlierDismiss: (
    itemId: string,
    flagKey: EstimateOutlierFlagKey,
    dismissed: boolean
  ) => void;
  onLineSelectionInteraction: (interaction: {
    id: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) => void;
};

export function LineRow({
  versionId,
  item,
  depth,
  estimateCurrency,
  navigation,
  indentStyle,
  style,
  setNodeRef,
  treeConnectorMeta,
  titleCell,
  titleCellProps,
  titleEditorProps,
  quantityCell,
  unitCell,
  unitCellProps,
  unitEditorProps,
  unitPriceCell,
  supplyTypeCell,
  supplyTypeCellProps,
  supplyTypeEditorProps,
  kFoCell,
  kFoCellProps,
  kFoEditorProps,
  hMoCell,
  hMoCellProps,
  hMoEditorProps,
  hMoMajorationCell,
  hMoMajorationCellProps,
  hMoMajorationEditorProps,
  laborRoleCell,
  laborRoleCellProps,
  laborRoleEditorProps,
  kMoCell,
  kMoCellProps,
  kMoEditorProps,
  hMoAtelierCell,
  hMoAtelierCellProps,
  hMoAtelierEditorProps,
  laborRoleAtelierCell,
  laborRoleAtelierCellProps,
  laborRoleAtelierEditorProps,
  kMoAtelierCell,
  kMoAtelierCellProps,
  kMoAtelierEditorProps,
  hMoChantierCell,
  hMoChantierCellProps,
  hMoChantierEditorProps,
  laborRoleChantierCell,
  laborRoleChantierCellProps,
  laborRoleChantierEditorProps,
  kMoChantierCell,
  kMoChantierCellProps,
  kMoChantierEditorProps,
  puCell,
  puCellProps,
  totalCell,
  totalCellProps,
  unitValue,
  supplyTypeValue,
  qualityFlags,
  detectedOutlierFlags,
  dismissedOutlierFlags,
  laborRoles,
  visibleColumns,
  isLineSelected,
  hasSupplierComparisonMismatch,
  isOutlierActionPending,
  isReadOnly,
  hideEditingActions,
  isLaborSplitEnabled,
  isPendingCreate,
  isSearchMatch,
  lineTotal,
  kFoValue,
  hMoValue,
  hMoMajorationPercent,
  kMoValue,
  sourceLevel,
  sourceExtractedAt,
  sourceMetadata,
  showCatalogueSuggestions,
  catalogueListboxId,
  catalogueSuggestions,
  isCatalogueLoading,
  catalogueError,
  activeCatalogueSuggestionIndex,
  onApplyCatalogueSuggestion,
  handleLineTitleFocus,
  handleLineTitleBlur,
  handleLineTitleKeyDown,
  aidInput,
  isAidEditorVisible,
  dragHandle,
  onRevealAidEditor,
  onPatchItem,
  onUnitChange,
  onUnitCommit,
  onSupplyTypeChange,
  onSupplyTypeCommit,
  onDeleteItem,
  onOpenSupplierComparisonPanel,
  onOpenSupplierComparisonContextMenu,
  onConvertLineToSection,
  onToggleOutlierDismiss,
  onLineSelectionInteraction,
}: LineRowProps) {
  const treeConnectorSegments = buildTreeConnectorSegments(treeConnectorMeta);
  const hasTreeConnectors =
    treeConnectorSegments.verticalSegments.length > 0 ||
    treeConnectorSegments.horizontalSegment !== null;
  const splitFields = readLaborSplitFields(item);
  const dismissedOutlierSet = new Set(dismissedOutlierFlags);
  const quantityOutlierActive =
    detectedOutlierFlags.includes("quantity_outlier") &&
    !dismissedOutlierSet.has("quantity_outlier");
  const priceOutlierActive =
    detectedOutlierFlags.includes("price_outlier") &&
    !dismissedOutlierSet.has("price_outlier");
  const dismissedOutlierBadges = detectedOutlierFlags.filter((flag, index, flags) => {
    return dismissedOutlierSet.has(flag) && flags.indexOf(flag) === index;
  });
  const actionableOutlierFlags = detectedOutlierFlags.filter((flag, index, flags) => {
    return ESTIMATE_OUTLIER_FLAG_KEYS.includes(flag) && flags.indexOf(flag) === index;
  });
  const isLaborRoleVisible =
    isLaborSplitEnabled || !visibleColumns || visibleColumns.has("labor_role");

  const handleLineSelectionCheckboxClick = (
    event: ReactMouseEvent<HTMLInputElement>
  ) => {
    if (isReadOnly) {
      return;
    }

    event.preventDefault();
    onLineSelectionInteraction({
      id: item.id,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey || !event.shiftKey,
      metaKey: event.metaKey,
    });
  };

  const handleRowModifierSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isReadOnly) {
      return;
    }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      return;
    }

    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
      )
    ) {
      return;
    }

    event.preventDefault();
    onLineSelectionInteraction({
      id: item.id,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  };

  const handleLineContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
      )
    ) {
      return;
    }

    event.preventDefault();
    onOpenSupplierComparisonContextMenu(item.id, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`estimate-row${
        isLineSelected ? " estimate-row--selected" : ""
      }${isSearchMatch ? " ring-2 ring-yellow-300 rounded" : ""}`}
      data-estimate-item-id={item.id}
      data-testid="estimate-line-row"
      data-depth={depth}
      role="row"
      onMouseDown={handleRowModifierSelection}
      onContextMenu={handleLineContextMenu}
    >
      <div
        {...titleCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          titleCell,
          `estimate-cell estimate-cell--designation${
            !item.title.trim() && !showCatalogueSuggestions
              ? " estimate-cell--required-empty"
              : ""
          }`
        )}
        style={indentStyle}
      >
        {hasTreeConnectors ? (
          <span className="estimate-tree-connectors" aria-hidden="true">
            {treeConnectorSegments.verticalSegments.map((segment) => (
              <span
                key={`line-v-${segment.column}-${segment.from}-${segment.to}`}
                className={`estimate-tree-segment estimate-tree-segment--v estimate-tree-segment--${segment.tone}`}
                style={{
                  left: `calc(${segment.column} * var(--tree-indent) + var(--tree-offset))`,
                  top: segment.from === "top" ? "0" : "50%",
                  bottom: segment.to === "bottom" ? "0" : "50%",
                }}
              />
            ))}
            {treeConnectorSegments.horizontalSegment ? (
              <span
                className={`estimate-tree-segment estimate-tree-segment--h estimate-tree-segment--${treeConnectorSegments.horizontalSegment.tone}`}
                style={{
                  left: `calc(${treeConnectorSegments.horizontalSegment.column} * var(--tree-indent) + var(--tree-offset))`,
                }}
              />
            ) : null}
          </span>
        ) : null}
        <div className="estimate-cell__content">
          <input
            type="checkbox"
            className="estimate-line-checkbox"
            checked={isLineSelected}
            onClick={handleLineSelectionCheckboxClick}
            readOnly
            disabled={isReadOnly}
            aria-label={`Sélectionner la ligne ${item.title || "sans titre"}`}
            data-testid="estimate-line-checkbox"
          />
          {!hideEditingActions ? dragHandle : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="estimate-designation-meta">{aidInput}</div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input
                className="estimate-input estimate-input--title"
                ref={titleEditorProps.ref}
                tabIndex={titleEditorProps.tabIndex}
                value={item.title}
                title={item.title}
                disabled={isReadOnly}
                data-testid="estimate-line-title-input"
                placeholder="Obligatoire"
                onFocus={handleLineTitleFocus}
                onKeyDown={handleLineTitleKeyDown}
                onChange={(event) =>
                  onPatchItem(
                    item.id,
                    { title: event.target.value },
                    { persist: false }
                  )
                }
                onBlur={handleLineTitleBlur}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showCatalogueSuggestions}
                aria-controls={
                  showCatalogueSuggestions ? catalogueListboxId : undefined
                }
                aria-activedescendant={
                  showCatalogueSuggestions &&
                  catalogueSuggestions[activeCatalogueSuggestionIndex]
                    ? `${catalogueListboxId}-option-${activeCatalogueSuggestionIndex}`
                    : undefined
                }
              />
              <EstimateLineTruthBadges item={item} />
              <TakeoffSourceBadge
                versionId={versionId}
                estimateItemId={item.id}
                lineLabel={item.title}
                sourceProvider={item.source_provider}
                sourceJobId={item.source_job_id}
                sourceFileName={item.source_file_name}
                sourcePage={item.source_page}
                sourceLevel={sourceLevel}
                extractedAt={sourceExtractedAt}
                sourceVersionNumber={item.source_version_number}
                sourceMetadata={sourceMetadata}
                cacheToken={item.updated_at}
              />
              {qualityFlags.length > 0 || dismissedOutlierBadges.length > 0 ? (
                <div className="estimate-quality-dots">
                  {qualityFlags.slice(0, 3).map((flag) => {
                    const targetColumn = getQualityFlagCellTarget(flag, {
                      isLaborSplitEnabled,
                      isLaborRoleVisible,
                    });
                    const isClickable = Boolean(targetColumn);
                    const focusTargetCell = () => {
                      if (!targetColumn) {
                        return;
                      }

                      const cellId = `${item.id}::${targetColumn}`;
                      const el = document.querySelector<HTMLElement>(
                        `[data-cell-id="${cellId}"]`
                      );
                      el?.focus();
                    };

                    if (isClickable) {
                      return (
                        <span
                          key={flag}
                          className={`estimate-quality-dot estimate-quality-dot--${flag.replace(/_/g, "-")}`}
                          title={`${ESTIMATE_QUALITY_FLAG_META[flag].label} — Cliquer pour aller au champ`}
                          role="button"
                          tabIndex={0}
                          onClick={focusTargetCell}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              focusTargetCell();
                            }
                          }}
                        />
                      );
                    }

                    return (
                      <span
                        key={flag}
                        className={`estimate-quality-dot estimate-quality-dot--${flag.replace(/_/g, "-")}`}
                        title={ESTIMATE_QUALITY_FLAG_META[flag].label}
                      />
                    );
                  })}
                  {qualityFlags.length > 3 ? (
                    <span
                      className="estimate-quality-overflow"
                      title={qualityFlags
                        .slice(3)
                        .map((flag) => ESTIMATE_QUALITY_FLAG_META[flag].label)
                        .join(", ")}
                    >
                      +{qualityFlags.length - 3}
                    </span>
                  ) : null}
                  {dismissedOutlierBadges.map((flag) => (
                    <span
                      key={`dismissed:${flag}`}
                      className="estimate-quality-dot estimate-quality-dot--dismissed"
                      title={`${ESTIMATE_QUALITY_FLAG_META[flag].label} (accepté)`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
            {showCatalogueSuggestions ? (
              <CatalogueSuggestionsPopover
                itemId={item.id}
                estimateCurrency={estimateCurrency}
                catalogueListboxId={catalogueListboxId}
                isCatalogueLoading={isCatalogueLoading}
                catalogueError={catalogueError}
                catalogueSuggestions={catalogueSuggestions}
                activeCatalogueSuggestionIndex={activeCatalogueSuggestionIndex}
                isReadOnly={isReadOnly}
                onApplySuggestion={onApplyCatalogueSuggestion}
              />
            ) : null}
            {hasSupplierComparisonMismatch ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="estimate-supplier-comparison-row-badge">
                  Meilleur prix fournisseur disponible
                </span>
              </div>
            ) : null}
            {actionableOutlierFlags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {actionableOutlierFlags.map((flag) => {
                  const isDismissed = dismissedOutlierSet.has(flag);
                  return (
                    <button
                      key={`toggle:${flag}`}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        onToggleOutlierDismiss(item.id, flag, !isDismissed)
                      }
                      disabled={isReadOnly || isOutlierActionPending}
                      title={ESTIMATE_QUALITY_FLAG_META[flag].description}
                    >
                      {isDismissed
                        ? `Réactiver ${ESTIMATE_QUALITY_FLAG_META[flag].label}`
                        : `Accepter ${ESTIMATE_QUALITY_FLAG_META[flag].label}`}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {!isAidEditorVisible ? (
            <div className="estimate-line-hover-actions">
              <button
                className="estimate-section-hover-btn"
                type="button"
                onClick={onRevealAidEditor}
                disabled={isReadOnly}
                data-testid="estimate-line-add-aid-button"
              >
                + AID
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <EditableCell
        cell={quantityCell}
        navigation={navigation}
        value={item.quantity ?? 0}
        readOnly={isReadOnly}
        className={toCellClassName(
          navigation,
          quantityCell,
          `estimate-cell estimate-editable-cell${
            quantityOutlierActive
              ? " bg-orange-50 ring-1 ring-inset ring-orange-300"
              : ""
          }${!item.quantity ? " estimate-cell--required-empty" : ""}`
        )}
        inputClassName="estimate-input"
        type="number"
        step="0.001"
        min={0}
        placeholder="Obligatoire"
        ariaLabel={`Quantite pour ${item.title || "sans titre"}`}
        formatDisplayValue={(value) =>
          formatNumberDisplay(parseNumberInput(String(value ?? "0")), {
            minDecimals: 0,
            maxDecimals: 3,
          })
        }
        onChange={(value) =>
          onPatchItem(
            item.id,
            { quantity: parseNumberInput(value) },
            { persist: false }
          )
        }
        onCommit={(value) =>
          onPatchItem(
            item.id,
            { quantity: parseNumberInput(value) },
            { persist: true }
          )
        }
      />
      <div
        {...unitCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(unitCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          unitCell,
          `estimate-cell${!unitValue.trim() ? " estimate-cell--required-empty" : ""}`
        )}
      >
        <input
          className="estimate-input"
          ref={unitEditorProps.ref}
          tabIndex={unitEditorProps.tabIndex}
          list="estimate-unit-options"
          value={unitValue}
          onFocus={unitEditorProps.onFocus}
          onKeyDown={unitEditorProps.onKeyDown}
          onChange={(event) => onUnitChange(item.id, event.target.value)}
          onBlur={(event) => {
            unitEditorProps.onBlur(event);
            onUnitCommit(item.id);
          }}
          placeholder="Obligatoire"
          disabled={isReadOnly}
        />
      </div>
      <EditableCell
        cell={unitPriceCell}
        navigation={navigation}
        value={formatCentsInput(item.unit_price_ht_cents)}
        readOnly={isReadOnly}
        className={toCellClassName(
          navigation,
          unitPriceCell,
          `estimate-cell estimate-editable-cell estimate-col--fo${
            priceOutlierActive
              ? " bg-orange-50 ring-1 ring-inset ring-orange-300"
              : ""
          }${!item.unit_price_ht_cents ? " estimate-cell--required-empty" : ""}`
        )}
        inputClassName="estimate-input"
        type="number"
        step="0.01"
        min={0}
        placeholder="Obligatoire"
        ariaLabel={`Prix unitaire pour ${item.title || "sans titre"}`}
        formatDisplayValue={(value) =>
          formatNumberDisplay(parseNumberInput(String(value ?? "0")), {
            minDecimals: 2,
            maxDecimals: 2,
          })
        }
        onChange={(value) =>
          onPatchItem(
            item.id,
            {
              unit_price_ht_cents:
                parseCurrencyToCents(value, estimateCurrency) ?? 0,
            },
            { persist: false }
          )
        }
        onCommit={(value) =>
          onPatchItem(
            item.id,
            {
              unit_price_ht_cents:
                parseCurrencyToCents(value, estimateCurrency) ?? 0,
            },
            { persist: true }
          )
        }
      />
      {(!visibleColumns || visibleColumns.has("supply_type") || isLaborSplitEnabled) ? (
        <div
          {...supplyTypeCellProps}
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(supplyTypeCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            supplyTypeCell,
            "estimate-cell estimate-col--fo"
          )}
        >
          <input
            className="estimate-input"
            ref={supplyTypeEditorProps.ref}
            tabIndex={supplyTypeEditorProps.tabIndex}
            list="estimate-fo-type-options"
            value={supplyTypeValue}
            onFocus={supplyTypeEditorProps.onFocus}
            onKeyDown={supplyTypeEditorProps.onKeyDown}
            onChange={(event) => onSupplyTypeChange(item.id, event.target.value)}
            onBlur={(event) => {
              supplyTypeEditorProps.onBlur(event);
              onSupplyTypeCommit(item.id);
            }}
            placeholder="Tube"
            disabled={isReadOnly}
          />
        </div>
      ) : null}
      {(!visibleColumns || visibleColumns.has("k_fo") || isLaborSplitEnabled) ? (
        <div
          {...kFoCellProps}
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(kFoCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            kFoCell,
            "estimate-cell estimate-col--fo"
          )}
        >
          <input
            className="estimate-input"
            ref={kFoEditorProps.ref}
            tabIndex={kFoEditorProps.tabIndex}
            type="number"
            step="0.01"
            min={0}
            value={kFoValue}
            onFocus={kFoEditorProps.onFocus}
            onKeyDown={kFoEditorProps.onKeyDown}
            onChange={(event) =>
              onPatchItem(
                item.id,
                { k_fo: parseNumberInput(event.target.value) },
                { persist: false }
              )
            }
            onBlur={(event) => {
              kFoEditorProps.onBlur(event);
              onPatchItem(
                item.id,
                { k_fo: parseNumberInput(event.target.value) },
                { persist: true }
              );
            }}
            placeholder="1.00"
            disabled={isReadOnly}
          />
        </div>
      ) : null}
      {isLaborSplitEnabled ? (
        <LaborSplitCells
          navigation={navigation}
          item={item}
          splitFields={splitFields}
          qualityFlags={qualityFlags}
          laborRoles={laborRoles}
          isReadOnly={isReadOnly}
          hMoMajorationPercent={hMoMajorationPercent}
          hMoMajorationCell={hMoMajorationCell}
          hMoMajorationCellProps={hMoMajorationCellProps}
          hMoMajorationEditorProps={hMoMajorationEditorProps}
          hMoAtelierCell={hMoAtelierCell}
          hMoAtelierCellProps={hMoAtelierCellProps}
          hMoAtelierEditorProps={hMoAtelierEditorProps}
          laborRoleAtelierCell={laborRoleAtelierCell}
          laborRoleAtelierCellProps={laborRoleAtelierCellProps}
          laborRoleAtelierEditorProps={laborRoleAtelierEditorProps}
          kMoAtelierCell={kMoAtelierCell}
          kMoAtelierCellProps={kMoAtelierCellProps}
          kMoAtelierEditorProps={kMoAtelierEditorProps}
          hMoChantierCell={hMoChantierCell}
          hMoChantierCellProps={hMoChantierCellProps}
          hMoChantierEditorProps={hMoChantierEditorProps}
          laborRoleChantierCell={laborRoleChantierCell}
          laborRoleChantierCellProps={laborRoleChantierCellProps}
          laborRoleChantierEditorProps={laborRoleChantierEditorProps}
          kMoChantierCell={kMoChantierCell}
          kMoChantierCellProps={kMoChantierCellProps}
          kMoChantierEditorProps={kMoChantierEditorProps}
          onPatchItem={onPatchItem}
        />
      ) : (
        <StandardMoCells
          navigation={navigation}
          item={item}
          qualityFlags={qualityFlags}
          laborRoles={laborRoles}
          visibleColumns={visibleColumns}
          isReadOnly={isReadOnly}
          hMoValue={hMoValue}
          hMoMajorationPercent={hMoMajorationPercent}
          kMoValue={kMoValue}
          hMoCell={hMoCell}
          hMoCellProps={hMoCellProps}
          hMoEditorProps={hMoEditorProps}
          hMoMajorationCell={hMoMajorationCell}
          hMoMajorationCellProps={hMoMajorationCellProps}
          hMoMajorationEditorProps={hMoMajorationEditorProps}
          laborRoleCell={laborRoleCell}
          laborRoleCellProps={laborRoleCellProps}
          laborRoleEditorProps={laborRoleEditorProps}
          kMoCell={kMoCell}
          kMoCellProps={kMoCellProps}
          kMoEditorProps={kMoEditorProps}
          onPatchItem={onPatchItem}
        />
      )}
      <div
        {...puCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(puCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          puCell,
          "estimate-cell estimate-cell--readonly estimate-cell--pu-separator"
        )}
      >
        <input
          className="estimate-input"
          type="text"
          value={formatNumberDisplay((item.pu_ht_cents ?? 0) / 100, {
            minDecimals: 2,
            maxDecimals: 2,
          })}
          placeholder="0.00"
          readOnly
          tabIndex={-1}
          aria-readonly
        />
      </div>
      <div
        {...totalCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(totalCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          totalCell,
          "estimate-cell estimate-cell--total estimate-cell--readonly"
        )}
      >
        <span>{formatCurrency(lineTotal, estimateCurrency)}</span>
      </div>
      <div className="estimate-cell estimate-cell--actions">
        {hideEditingActions ? (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => onOpenSupplierComparisonPanel(item.id)}
            title="Comparer fournisseurs"
          >
            Comparer
          </button>
        ) : (
          <details className="relative">
            <summary
              className="btn btn-ghost btn-sm cursor-pointer list-none select-none"
              title="Plus d'actions"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </summary>
            <div
              className="absolute right-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-xl border border-[var(--slate-200)] bg-surface p-2 shadow-xl"
              style={{ minWidth: "140px" }}
            >
              <button
                className="btn btn-ghost btn-sm w-full justify-start"
                type="button"
                onClick={() => onOpenSupplierComparisonPanel(item.id)}
              >
                Comparer
              </button>
              <button
                className="btn btn-ghost btn-sm w-full justify-start"
                type="button"
                onClick={() => onConvertLineToSection(item.id)}
                disabled={isReadOnly || isPendingCreate}
              >
                Convertir en section
              </button>
              <button
                className="btn btn-danger btn-sm w-full justify-start"
                type="button"
                onClick={() => onDeleteItem(item.id)}
                disabled={isReadOnly}
              >
                Supprimer
              </button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

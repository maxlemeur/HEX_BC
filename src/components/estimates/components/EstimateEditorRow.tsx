"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
} from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  type SectionTotals,
} from "@/lib/estimate-calculations";
import {
  useEstimateEditorRowActions,
} from "@/components/estimates/context/EstimateEditorRowActionsContext";
import { useEstimateSpreadsheetNavigation } from "@/components/estimates/context/EstimateSpreadsheetContext";
import {
  LineRow,
} from "@/components/estimates/components/estimate-editor-row/LineRow";
import {
  SectionRow,
} from "@/components/estimates/components/estimate-editor-row/SectionRow";
import {
  useCatalogueSuggestions,
} from "@/components/estimates/components/estimate-editor-row/useCatalogueSuggestions";
import {
  type ColumnVisibilitySet,
  type EstimateItem,
  type LaborRole,
  type SupplyType,
  SPREADSHEET_COLUMN_KEYS,
  formatMajorationPercentInput,
  getSpreadsheetColumnKeys,
  normalizeAidInput,
  readSourceMetadataText,
} from "@/components/estimates/components/estimate-editor-row/shared";
import {
  type SpreadsheetCell,
} from "@/hooks/useSpreadsheetNavigation";
import {
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  type EstimateOutlierFlagKey,
} from "@/lib/estimates/outlier-detection";
import {
  type SupportedEstimateCurrency,
} from "@/lib/money";
import {
  type TreeConnectorMeta,
} from "@/lib/estimates/tree-connectors";

export { getSpreadsheetColumnKeys };

type SortableReturn = ReturnType<typeof useSortable>;

type DragHandleProps = {
  listeners?: SortableReturn["listeners"];
  attributes?: SortableReturn["attributes"];
  disabled?: boolean;
};

const DragHandle = memo(function DragHandle({
  listeners,
  attributes,
  disabled,
}: DragHandleProps) {
  return (
    <button
      type="button"
      className="estimate-drag-handle"
      {...attributes}
      {...listeners}
      disabled={disabled}
      aria-label="Glisser pour réordonner"
      data-testid="estimate-row-drag-handle"
    >
      <svg viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="4" r="1.2" />
        <circle cx="11" cy="4" r="1.2" />
        <circle cx="5" cy="8" r="1.2" />
        <circle cx="11" cy="8" r="1.2" />
        <circle cx="5" cy="12" r="1.2" />
        <circle cx="11" cy="12" r="1.2" />
      </svg>
    </button>
  );
});

export type EstimateEditorRowProps = {
  versionId: string;
  estimateCurrency: SupportedEstimateCurrency;
  item: EstimateItem;
  itemNumber?: string | null;
  depth: number;
  unitValue: string;
  supplyTypeValue: string;
  qualityFlags: EstimateQualityFlagKey[];
  detectedOutlierFlags: EstimateOutlierFlagKey[];
  dismissedOutlierFlags: EstimateOutlierFlagKey[];
  supplyTypeById: Map<string, SupplyType>;
  laborRoles: LaborRole[];
  isLineSelected: boolean;
  hasSupplierComparisonMismatch: boolean;
  visibleColumns?: ColumnVisibilitySet;
  sectionTotals: SectionTotals | null;
  isDragDisabled: boolean;
  isOutlierActionPending: boolean;
  isReadOnly: boolean;
  hideEditingActions?: boolean;
  isLaborSplitEnabled: boolean;
  isPendingCreate?: boolean;
  isSearchMatch?: boolean;
  treeConnectorMeta?: TreeConnectorMeta;
  sectionLevel?: number | null;
  canAddLine?: boolean;
  canAddSection?: boolean;
  addLineLabel?: string;
  addSectionLabel?: string;
  isSectionCollapsed?: boolean;
  onToggleSectionCollapsed?: (sectionId: string) => void;
  isHighlighted?: boolean;
};

function areStringArraysEqual(left: string[], right: string[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function areBooleanArraysEqual(left: boolean[], right: boolean[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function areTreeConnectorMetaEqual(
  left: TreeConnectorMeta | undefined,
  right: TreeConnectorMeta | undefined
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.depth === right.depth &&
    left.isLastChild === right.isLastChild &&
    left.hasVisibleChildren === right.hasVisibleChildren &&
    areBooleanArraysEqual(left.ancestorLastChildFlags, right.ancestorLastChildFlags)
  );
}

function areSectionTotalsEqual(
  left: SectionTotals | null,
  right: SectionTotals | null
) {
  if (left === right) return true;
  if (!left || !right) return false;

  if (
    left.foTotalCents !== right.foTotalCents ||
    left.moTotalCents !== right.moTotalCents ||
    left.moAtelierTotalCents !== right.moAtelierTotalCents ||
    left.moChantierTotalCents !== right.moChantierTotalCents ||
    left.totalHtCents !== right.totalHtCents ||
    left.totalTtcCents !== right.totalTtcCents
  ) {
    return false;
  }

  const leftSupplyTypeTotals = left.supplyTypeFoTotalsCents ?? {};
  const rightSupplyTypeTotals = right.supplyTypeFoTotalsCents ?? {};
  const leftKeys = Object.keys(leftSupplyTypeTotals);
  const rightKeys = Object.keys(rightSupplyTypeTotals);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (leftSupplyTypeTotals[key] !== rightSupplyTypeTotals[key]) {
      return false;
    }
  }
  return true;
}

function areEstimateEditorRowPropsEqual(
  previous: EstimateEditorRowProps,
  next: EstimateEditorRowProps
) {
  return (
    previous.versionId === next.versionId &&
    previous.estimateCurrency === next.estimateCurrency &&
    previous.item === next.item &&
    previous.itemNumber === next.itemNumber &&
    previous.depth === next.depth &&
    previous.unitValue === next.unitValue &&
    previous.supplyTypeValue === next.supplyTypeValue &&
    areStringArraysEqual(previous.qualityFlags, next.qualityFlags) &&
    areStringArraysEqual(previous.detectedOutlierFlags, next.detectedOutlierFlags) &&
    areStringArraysEqual(previous.dismissedOutlierFlags, next.dismissedOutlierFlags) &&
    previous.supplyTypeById === next.supplyTypeById &&
    previous.laborRoles === next.laborRoles &&
    previous.isLineSelected === next.isLineSelected &&
    previous.hasSupplierComparisonMismatch === next.hasSupplierComparisonMismatch &&
    previous.visibleColumns === next.visibleColumns &&
    areSectionTotalsEqual(previous.sectionTotals, next.sectionTotals) &&
    previous.isDragDisabled === next.isDragDisabled &&
    previous.isOutlierActionPending === next.isOutlierActionPending &&
    previous.isReadOnly === next.isReadOnly &&
    previous.hideEditingActions === next.hideEditingActions &&
    previous.isLaborSplitEnabled === next.isLaborSplitEnabled &&
    previous.isPendingCreate === next.isPendingCreate &&
    previous.isHighlighted === next.isHighlighted &&
    previous.isSearchMatch === next.isSearchMatch &&
    areTreeConnectorMetaEqual(previous.treeConnectorMeta, next.treeConnectorMeta) &&
    previous.sectionLevel === next.sectionLevel &&
    previous.canAddLine === next.canAddLine &&
    previous.canAddSection === next.canAddSection &&
    previous.addLineLabel === next.addLineLabel &&
    previous.addSectionLabel === next.addSectionLabel &&
    previous.isSectionCollapsed === next.isSectionCollapsed &&
    previous.onToggleSectionCollapsed === next.onToggleSectionCollapsed
  );
}

export const EstimateEditorRow = memo(function EstimateEditorRow({
  versionId,
  estimateCurrency,
  item,
  itemNumber,
  depth,
  unitValue,
  supplyTypeValue,
  qualityFlags,
  detectedOutlierFlags,
  dismissedOutlierFlags,
  supplyTypeById,
  laborRoles,
  isLineSelected,
  hasSupplierComparisonMismatch,
  sectionTotals,
  isDragDisabled,
  isOutlierActionPending,
  isReadOnly,
  hideEditingActions = false,
  isLaborSplitEnabled,
  visibleColumns,
  isPendingCreate = false,
  isHighlighted = false,
  isSearchMatch,
  treeConnectorMeta,
  sectionLevel = null,
  canAddLine = true,
  canAddSection = true,
  addLineLabel = "+ Ligne",
  addSectionLabel = "+ Section",
  isSectionCollapsed = false,
  onToggleSectionCollapsed,
}: EstimateEditorRowProps) {
  const navigation = useEstimateSpreadsheetNavigation();
  const {
    onDeleteItem,
    onOpenSupplierComparisonPanel,
    onOpenSupplierComparisonContextMenu,
    onOpenSectionContextMenu,
    onPatchItem,
    onUnitChange,
    onUnitCommit,
    onSupplyTypeChange,
    onSupplyTypeCommit,
    onAddLine,
    onAddSection,
    onConvertLineToSection,
    onToggleOutlierDismiss,
    onLineSelectionInteraction,
  } = useEstimateEditorRowActions();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { parentId: item.parent_id ?? null },
    disabled: isReadOnly || isDragDisabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.65 : 1,
  };

  const indentStyle: CSSProperties & { "--row-depth": string } = {
    "--row-depth": String(depth),
    paddingLeft: "calc(var(--tree-indent) * var(--row-depth))",
  };
  const resolvedTreeConnectorMeta: TreeConnectorMeta = treeConnectorMeta ?? {
    depth,
    isLastChild: false,
    ancestorLastChildFlags: [],
    hasVisibleChildren: false,
  };

  const aidValue = typeof item.aid === "string" ? item.aid : "";
  const normalizedAidValue = aidValue.trim();
  const [isAidEditorRequested, setIsAidEditorRequested] = useState(false);
  const aidInputRef = useRef<HTMLInputElement | null>(null);
  const isAidEditorVisible = normalizedAidValue.length > 0 || isAidEditorRequested;
  const titleCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.title,
  };
  const titleCellProps = navigation.getCellProps(titleCell);
  const titleEditorProps = navigation.getEditorProps<HTMLInputElement>(titleCell);

  const {
    catalogueSuggestions,
    isCatalogueLoading,
    catalogueError,
    activeCatalogueSuggestionIndex,
    catalogueListboxId,
    showCatalogueSuggestions,
    applyCatalogueSuggestion,
    handleLineTitleFocus,
    handleLineTitleBlur,
    handleLineTitleKeyDown,
  } = useCatalogueSuggestions({
    versionId,
    item,
    isReadOnly,
    titleEditorProps,
    onPatchItem,
  });

  const handleRevealAidEditor = useCallback(() => {
    if (isReadOnly) return;
    setIsAidEditorRequested(true);
    window.requestAnimationFrame(() => {
      aidInputRef.current?.focus();
    });
  }, [isReadOnly]);

  const handleAidFocus = useCallback(() => {
    setIsAidEditorRequested(true);
  }, []);

  const handleAidBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      const nextAid = normalizeAidInput(event.target.value);
      onPatchItem(item.id, { aid: nextAid }, { persist: true });
      if (!nextAid) {
        setIsAidEditorRequested(false);
      }
    },
    [item.id, onPatchItem]
  );

  const aidInput = isAidEditorVisible ? (
    <input
      ref={aidInputRef}
      className="estimate-input estimate-aid-inline"
      value={aidValue}
      title={aidValue || "AID"}
      disabled={isReadOnly}
      placeholder="AID"
      onFocus={handleAidFocus}
      onChange={(event) =>
        onPatchItem(item.id, { aid: event.target.value }, { persist: false })
      }
      onBlur={handleAidBlur}
    />
  ) : null;

  const dragHandle = (
    <DragHandle
      listeners={listeners}
      attributes={attributes}
      disabled={isReadOnly || isDragDisabled}
    />
  );

  if (item.item_type === "section") {
    return (
      <SectionRow
        item={item}
        itemNumber={itemNumber}
        depth={depth}
        estimateCurrency={estimateCurrency}
        navigation={navigation}
        titleCell={titleCell}
        titleCellProps={titleCellProps}
        titleEditorProps={titleEditorProps}
        indentStyle={indentStyle}
        isReadOnly={isReadOnly}
        hideEditingActions={hideEditingActions}
        isPendingCreate={isPendingCreate}
        isHighlighted={isHighlighted}
        isAidEditorVisible={isAidEditorVisible}
        sectionTotals={sectionTotals}
        supplyTypeById={supplyTypeById}
        isLaborSplitEnabled={isLaborSplitEnabled}
        visibleColumns={visibleColumns}
        sectionLevel={sectionLevel}
        canAddLine={canAddLine}
        canAddSection={canAddSection}
        addLineLabel={addLineLabel}
        addSectionLabel={addSectionLabel}
        isSectionCollapsed={isSectionCollapsed}
        onToggleSectionCollapsed={onToggleSectionCollapsed}
        onOpenSectionContextMenu={onOpenSectionContextMenu}
        onPatchItem={onPatchItem}
        onAddLine={onAddLine}
        onAddSection={onAddSection}
        onRevealAidEditor={handleRevealAidEditor}
        aidInput={aidInput}
        dragHandle={dragHandle}
        style={style}
        setNodeRef={setNodeRef}
        treeConnectorMeta={resolvedTreeConnectorMeta}
      />
    );
  }

  const hMoMajorationPercent = formatMajorationPercentInput(item.h_mo_majoration);
  const sourceLevel = readSourceMetadataText(item, [
    "source_level",
    "takeoff_level",
    "level",
  ]);
  const sourceExtractedAt = readSourceMetadataText(item, [
    "source_extracted_at",
    "source_extraction_date",
    "takeoff_extracted_at",
    "extracted_at",
    "extraction_date",
  ]);
  const sourceMetadata = (item as Record<string, unknown>).source_metadata ?? null;

  const quantityCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.quantity,
  };
  const unitCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.unit,
  };
  const unitCellProps = navigation.getCellProps(unitCell);
  const unitEditorProps = navigation.getEditorProps<HTMLInputElement>(unitCell);
  const unitPriceCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.unitPrice,
  };
  const supplyTypeCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.supplyType,
  };
  const supplyTypeCellProps = navigation.getCellProps(supplyTypeCell);
  const supplyTypeEditorProps = navigation.getEditorProps<HTMLInputElement>(supplyTypeCell);
  const kFoCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kFo,
  };
  const kFoCellProps = navigation.getCellProps(kFoCell);
  const kFoEditorProps = navigation.getEditorProps<HTMLInputElement>(kFoCell);
  const hMoCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMo,
  };
  const hMoCellProps = navigation.getCellProps(hMoCell);
  const hMoEditorProps = navigation.getEditorProps<HTMLInputElement>(hMoCell);
  const hMoMajorationCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMoMajoration,
  };
  const hMoMajorationCellProps = navigation.getCellProps(hMoMajorationCell);
  const hMoMajorationEditorProps = navigation.getEditorProps<HTMLInputElement>(
    hMoMajorationCell
  );
  const laborRoleCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.laborRole,
  };
  const laborRoleCellProps = navigation.getCellProps(laborRoleCell);
  const laborRoleEditorProps = navigation.getEditorProps<HTMLSelectElement>(
    laborRoleCell
  );
  const kMoCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kMo,
  };
  const kMoCellProps = navigation.getCellProps(kMoCell);
  const kMoEditorProps = navigation.getEditorProps<HTMLInputElement>(kMoCell);
  const hMoAtelierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMoAtelier,
  };
  const hMoAtelierCellProps = navigation.getCellProps(hMoAtelierCell);
  const hMoAtelierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    hMoAtelierCell
  );
  const laborRoleAtelierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.laborRoleAtelier,
  };
  const laborRoleAtelierCellProps = navigation.getCellProps(laborRoleAtelierCell);
  const laborRoleAtelierEditorProps = navigation.getEditorProps<HTMLSelectElement>(
    laborRoleAtelierCell
  );
  const kMoAtelierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kMoAtelier,
  };
  const kMoAtelierCellProps = navigation.getCellProps(kMoAtelierCell);
  const kMoAtelierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    kMoAtelierCell
  );
  const hMoChantierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMoChantier,
  };
  const hMoChantierCellProps = navigation.getCellProps(hMoChantierCell);
  const hMoChantierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    hMoChantierCell
  );
  const laborRoleChantierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.laborRoleChantier,
  };
  const laborRoleChantierCellProps = navigation.getCellProps(laborRoleChantierCell);
  const laborRoleChantierEditorProps = navigation.getEditorProps<HTMLSelectElement>(
    laborRoleChantierCell
  );
  const kMoChantierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kMoChantier,
  };
  const kMoChantierCellProps = navigation.getCellProps(kMoChantierCell);
  const kMoChantierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    kMoChantierCell
  );
  const puCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.pu,
  };
  const puCellProps = navigation.getCellProps(puCell, { editable: false });
  const totalCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.total,
  };
  const totalCellProps = navigation.getCellProps(totalCell, { editable: false });

  return (
    <LineRow
      versionId={versionId}
      item={item}
      depth={depth}
      estimateCurrency={estimateCurrency}
      navigation={navigation}
      indentStyle={indentStyle}
      style={style}
      setNodeRef={setNodeRef}
      treeConnectorMeta={resolvedTreeConnectorMeta}
      titleCell={titleCell}
      titleCellProps={titleCellProps}
      titleEditorProps={titleEditorProps}
      quantityCell={quantityCell}
      unitCell={unitCell}
      unitCellProps={unitCellProps}
      unitEditorProps={unitEditorProps}
      unitPriceCell={unitPriceCell}
      supplyTypeCell={supplyTypeCell}
      supplyTypeCellProps={supplyTypeCellProps}
      supplyTypeEditorProps={supplyTypeEditorProps}
      kFoCell={kFoCell}
      kFoCellProps={kFoCellProps}
      kFoEditorProps={kFoEditorProps}
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
      puCell={puCell}
      puCellProps={puCellProps}
      totalCell={totalCell}
      totalCellProps={totalCellProps}
      unitValue={unitValue}
      supplyTypeValue={supplyTypeValue}
      qualityFlags={qualityFlags}
      detectedOutlierFlags={detectedOutlierFlags}
      dismissedOutlierFlags={dismissedOutlierFlags}
      laborRoles={laborRoles}
      visibleColumns={visibleColumns}
      isLineSelected={isLineSelected}
      hasSupplierComparisonMismatch={hasSupplierComparisonMismatch}
      isOutlierActionPending={isOutlierActionPending}
      isReadOnly={isReadOnly}
      hideEditingActions={hideEditingActions}
      isLaborSplitEnabled={isLaborSplitEnabled}
      isPendingCreate={isPendingCreate}
      isHighlighted={isHighlighted}
      isSearchMatch={isSearchMatch}
      lineTotal={item.line_total_ht_cents ?? 0}
      kFoValue={item.k_fo ?? 1}
      hMoValue={item.h_mo ?? 0}
      hMoMajorationPercent={hMoMajorationPercent}
      kMoValue={item.k_mo ?? 1}
      sourceLevel={sourceLevel}
      sourceExtractedAt={sourceExtractedAt}
      sourceMetadata={sourceMetadata}
      showCatalogueSuggestions={showCatalogueSuggestions}
      catalogueListboxId={catalogueListboxId}
      catalogueSuggestions={catalogueSuggestions}
      isCatalogueLoading={isCatalogueLoading}
      catalogueError={catalogueError}
      activeCatalogueSuggestionIndex={activeCatalogueSuggestionIndex}
      onApplyCatalogueSuggestion={applyCatalogueSuggestion}
      handleLineTitleFocus={handleLineTitleFocus}
      handleLineTitleBlur={handleLineTitleBlur}
      handleLineTitleKeyDown={handleLineTitleKeyDown}
      dragHandle={dragHandle}
      onPatchItem={onPatchItem}
      onUnitChange={onUnitChange}
      onUnitCommit={onUnitCommit}
      onSupplyTypeChange={onSupplyTypeChange}
      onSupplyTypeCommit={onSupplyTypeCommit}
      onDeleteItem={onDeleteItem}
      onOpenSupplierComparisonPanel={onOpenSupplierComparisonPanel}
      onOpenSupplierComparisonContextMenu={onOpenSupplierComparisonContextMenu}
      onConvertLineToSection={onConvertLineToSection}
      onToggleOutlierDismiss={onToggleOutlierDismiss}
      onLineSelectionInteraction={onLineSelectionInteraction}
    />
  );
}, areEstimateEditorRowPropsEqual);

DragHandle.displayName = "DragHandle";
EstimateEditorRow.displayName = "EstimateEditorRow";

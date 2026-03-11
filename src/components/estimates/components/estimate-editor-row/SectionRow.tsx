"use client";
/* eslint-disable react-hooks/refs */

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { type SectionTotals, UNASSIGNED_SUPPLY_TYPE_KEY } from "@/lib/estimate-calculations";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import { type TreeConnectorMeta, buildTreeConnectorSegments } from "@/lib/estimates/tree-connectors";
import {
  type SpreadsheetCell,
  type SpreadsheetCellProps,
  type SpreadsheetEditorProps,
  type SpreadsheetNavigationResult,
} from "@/hooks/useSpreadsheetNavigation";

import {
  type ColumnVisibilitySet,
  type EstimateItem,
  type SupplyType,
  toCellClassName,
  toCellKeyDownHandler,
} from "./shared";

type SectionRowProps = {
  item: EstimateItem;
  itemNumber?: string | null;
  depth: number;
  estimateCurrency: SupportedEstimateCurrency;
  navigation: SpreadsheetNavigationResult;
  titleCell: SpreadsheetCell;
  titleCellProps: SpreadsheetCellProps;
  titleEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  indentStyle: CSSProperties & { "--row-depth": string };
  isReadOnly: boolean;
  hideEditingActions: boolean;
  isPendingCreate: boolean;
  isAidEditorVisible: boolean;
  sectionTotals: SectionTotals | null;
  supplyTypeById: Map<string, SupplyType>;
  isLaborSplitEnabled: boolean;
  visibleColumns?: ColumnVisibilitySet;
  sectionLevel: number | null;
  canAddLine: boolean;
  canAddSection: boolean;
  addLineLabel: string;
  addSectionLabel: string;
  isSectionCollapsed: boolean;
  onToggleSectionCollapsed?: (sectionId: string) => void;
  onOpenSectionContextMenu: (
    sectionId: string,
    position: { x: number; y: number }
  ) => void;
  onPatchItem: (
    itemId: string,
    patch: { title: string },
    options: { persist: boolean }
  ) => void;
  onAddLine: (parentId: string | null) => void;
  onAddSection: (parentId: string | null) => void;
  onRevealAidEditor: () => void;
  aidInput: ReactNode;
  dragHandle: ReactNode;
  style: CSSProperties;
  setNodeRef: (element: HTMLElement | null) => void;
  treeConnectorMeta: TreeConnectorMeta;
};

function renderTreeConnectors(
  prefix: string,
  treeConnectorMeta: TreeConnectorMeta
) {
  const treeConnectorSegments = buildTreeConnectorSegments(treeConnectorMeta);
  const hasTreeConnectors =
    treeConnectorSegments.verticalSegments.length > 0 ||
    treeConnectorSegments.horizontalSegment !== null;

  if (!hasTreeConnectors) {
    return null;
  }

  return (
    <span className="estimate-tree-connectors" aria-hidden="true">
      {treeConnectorSegments.verticalSegments.map((segment) => (
        <span
          key={`${prefix}-v-${segment.column}-${segment.from}-${segment.to}`}
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
  );
}

export function SectionRow({
  item,
  itemNumber,
  depth,
  estimateCurrency,
  navigation,
  titleCell,
  titleCellProps,
  titleEditorProps,
  indentStyle,
  isReadOnly,
  hideEditingActions,
  isPendingCreate,
  isAidEditorVisible,
  sectionTotals,
  supplyTypeById,
  isLaborSplitEnabled,
  visibleColumns,
  sectionLevel,
  canAddLine,
  canAddSection,
  addLineLabel,
  addSectionLabel,
  isSectionCollapsed,
  onToggleSectionCollapsed,
  onOpenSectionContextMenu,
  onPatchItem,
  onAddLine,
  onAddSection,
  onRevealAidEditor,
  aidInput,
  dragHandle,
  style,
  setNodeRef,
  treeConnectorMeta,
}: SectionRowProps) {
  const supplyTypeTotals = sectionTotals?.supplyTypeFoTotalsCents ?? {};
  const supplyTypeEntries = Object.entries(supplyTypeTotals).sort(
    ([, leftValue], [, rightValue]) => rightValue - leftValue
  );

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
      )
    ) {
      return;
    }
    if (hideEditingActions || isPendingCreate) {
      return;
    }

    event.preventDefault();
    onOpenSectionContextMenu(item.id, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="estimate-row estimate-row--section"
      data-estimate-item-id={item.id}
      data-testid="estimate-section-row"
      data-depth={depth}
      data-section-level={sectionLevel ?? undefined}
      role="row"
      onContextMenu={handleContextMenu}
    >
      <div
        {...titleCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          titleCell,
          "estimate-cell estimate-cell--designation"
        )}
        style={indentStyle}
      >
        {renderTreeConnectors("section", treeConnectorMeta)}
        <div className="estimate-cell__content">
          {!hideEditingActions ? dragHandle : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {onToggleSectionCollapsed ? (
              <button
                type="button"
                className="estimate-section-collapse-btn"
                onClick={() => onToggleSectionCollapsed(item.id)}
                aria-label={
                  isSectionCollapsed ? "Deplier la section" : "Replier la section"
                }
                title={isSectionCollapsed ? "Deplier" : "Replier"}
              >
                {isSectionCollapsed ? "▸" : "▾"}
              </button>
            ) : null}
            <div className="estimate-designation-meta">
              {itemNumber ? (
                <span className="font-mono text-[11px] font-semibold text-[var(--slate-500)]">
                  {itemNumber}
                </span>
              ) : null}
              {aidInput}
            </div>
            <div className="min-w-0 flex-1">
              <input
                className="estimate-input estimate-input--title"
                ref={titleEditorProps.ref}
                tabIndex={titleEditorProps.tabIndex}
                value={item.title}
                title={item.title}
                disabled={isReadOnly}
                data-testid="estimate-section-title-input"
                onFocus={titleEditorProps.onFocus}
                onKeyDown={titleEditorProps.onKeyDown}
                onChange={(event) =>
                  onPatchItem(item.id, { title: event.target.value }, { persist: false })
                }
                onBlur={(event) => {
                  titleEditorProps.onBlur(event);
                  const nextTitle = event.target.value.trim() || "Sans titre";
                  onPatchItem(item.id, { title: nextTitle }, { persist: true });
                }}
              />
            </div>
          </div>
          {!hideEditingActions ? (
            <div className="estimate-section-hover-actions">
              {canAddLine ? (
                <button
                  className="estimate-section-hover-btn"
                  type="button"
                  onClick={() => onAddLine(item.id)}
                  disabled={isReadOnly}
                  data-testid="estimate-section-add-line-button"
                >
                  {addLineLabel}
                </button>
              ) : null}
              {canAddSection ? (
                <button
                  className="estimate-section-hover-btn"
                  type="button"
                  onClick={() => onAddSection(item.id)}
                  disabled={isReadOnly}
                  data-testid="estimate-section-add-section-button"
                >
                  {addSectionLabel}
                </button>
              ) : null}
              {!isAidEditorVisible ? (
                <button
                  className="estimate-section-hover-btn"
                  type="button"
                  onClick={onRevealAidEditor}
                  disabled={isReadOnly}
                  data-testid="estimate-section-add-aid-button"
                >
                  + AID
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div />
      <div />
      <div
        className="estimate-section-total-cell estimate-section-total-cell--fo"
        title={
          supplyTypeEntries.length > 0
            ? supplyTypeEntries
                .map(([id, cents]) => {
                  const isUnassigned = id === UNASSIGNED_SUPPLY_TYPE_KEY;
                  const label = isUnassigned
                    ? "Sans catégorie FO"
                    : (supplyTypeById.get(id)?.name ?? "Type inconnu");
                  return `${label} : ${formatCurrency(cents, estimateCurrency)}`;
                })
                .join("\n")
            : undefined
        }
      >
        FO {formatCurrency(sectionTotals?.foTotalCents ?? 0, estimateCurrency)}
      </div>
      {isLaborSplitEnabled ? (
        <>
          <div />
          <div />
          <div />
          <div className="estimate-section-total-cell estimate-section-total-cell--mo">
            MO at. {formatCurrency(sectionTotals?.moAtelierTotalCents ?? 0, estimateCurrency)}
          </div>
          <div />
          <div />
          <div className="estimate-section-total-cell estimate-section-total-cell--mo">
            MO ch. {formatCurrency(sectionTotals?.moChantierTotalCents ?? 0, estimateCurrency)}
          </div>
          <div />
          <div />
        </>
      ) : (
        <>
          {(!visibleColumns || visibleColumns.has("supply_type")) ? <div /> : null}
          {(!visibleColumns || visibleColumns.has("k_fo")) ? <div /> : null}
          <div className="estimate-section-total-cell estimate-section-total-cell--mo">
            MO {formatCurrency(sectionTotals?.moTotalCents ?? 0, estimateCurrency)}
          </div>
          {(!visibleColumns || visibleColumns.has("h_mo_majoration")) ? <div /> : null}
          {(!visibleColumns || visibleColumns.has("labor_role")) ? <div /> : null}
          {(!visibleColumns || visibleColumns.has("k_mo")) ? <div /> : null}
        </>
      )}
      <div />
      <div
        className="estimate-section-total-cell estimate-section-total-cell--ht"
        title={`TTC ${formatCurrency(sectionTotals?.totalTtcCents ?? 0, estimateCurrency)}`}
      >
        HT {formatCurrency(sectionTotals?.totalHtCents ?? 0, estimateCurrency)}
      </div>
      <div className="estimate-cell estimate-cell--actions">
        <button
          className="estimate-section-more-btn"
          type="button"
          onClick={(event) => {
            if (isPendingCreate) {
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenSectionContextMenu(item.id, {
              x: rect.right,
              y: rect.bottom + 4,
            });
          }}
          disabled={isReadOnly || isPendingCreate}
          aria-label="Actions"
          data-testid="estimate-section-actions-button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

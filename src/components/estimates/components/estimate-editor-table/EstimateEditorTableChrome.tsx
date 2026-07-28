"use client";

import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { EstimateEditorBody } from "@/components/estimates/components/EstimateEditorBody";
import { EstimateColumnsHelpPanel } from "@/components/estimates/components/EstimateColumnsHelpPanel";
import { ProductionRibbon } from "@/components/dashboard/ProductionRibbon";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import { type ColumnKey } from "@/hooks/useColumnVisibility";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateEditorBodyProps = ComponentProps<typeof EstimateEditorBody>;

function ColumnHeaderLabel({
  label,
  allowWrap = false,
}: Readonly<{ label: string; allowWrap?: boolean }>) {
  return (
    <span
      className={`inline-flex items-center text-[10px] ${
        allowWrap ? "whitespace-normal" : "whitespace-nowrap"
      }`}
    >
      {label}
    </span>
  );
}

type EstimateEditorTableChromeProps = {
  tableCardRef: RefObject<HTMLDivElement | null>;
  headerRight?: ReactNode;
  toolbarNode: ReactNode;
  ribbonHeaderNode?: ReactNode;
  ribbonAlertsNode?: ReactNode;
  mobileListNode?: ReactNode;
  showFullTableOnMobile?: boolean;
  activeLineBreadcrumb: string | null;
  actionError: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  isLaborSplitEnabled?: boolean;
  dynamicGridStyle?: CSSProperties;
  superHeaderSpans: {
    foStart: number;
    foSpan: number;
    moStart: number;
    moSpan: number;
    puStart: number;
  };
  visibleColumns: ReadonlySet<ColumnKey>;
  allVisibleSelected: boolean;
  onToggleAllVisibleLines: (checked: boolean) => void;
  visibleLineIdCount: number;
  items: EstimateItem[];
  hasVisibleRowsForRender: boolean;
  isReadOnly: boolean;
  isViewerMode?: boolean;
  onAddRootSection: () => void;
  rootAddSectionLabel: string;
  onResetQualityFilter: () => void;
  sensors: EstimateEditorBodyProps["sensors"];
  onDragEnd: EstimateEditorBodyProps["onDragEnd"];
  isVirtualized: boolean;
  virtualizedSortableIds: EstimateEditorBodyProps["virtualizedSortableIds"];
  virtualTotalSize: EstimateEditorBodyProps["virtualTotalSize"];
  virtualItems: EstimateEditorBodyProps["virtualItems"];
  flattenedRows: EstimateEditorBodyProps["flattenedRows"];
  measureElement: EstimateEditorBodyProps["measureElement"];
  virtualScrollRef: EstimateEditorBodyProps["virtualScrollRef"];
  virtualBodyStyle: EstimateEditorBodyProps["virtualBodyStyle"];
  onBodyMouseDown: EstimateEditorBodyProps["onBodyMouseDown"];
  spreadsheetRowCount: number;
  renderVirtualRow: EstimateEditorBodyProps["renderVirtualRow"];
  renderList: EstimateEditorBodyProps["renderList"];
  grandTotals: {
    foTotal: number;
    moTotal: number;
    htTotal: number;
  };
  currency?: SupportedEstimateCurrency;
};

export function EstimateEditorTableChrome({
  tableCardRef,
  headerRight,
  toolbarNode,
  ribbonHeaderNode,
  ribbonAlertsNode,
  mobileListNode,
  showFullTableOnMobile = false,
  activeLineBreadcrumb,
  actionError,
  scrollContainerRef,
  isLaborSplitEnabled,
  dynamicGridStyle,
  superHeaderSpans,
  visibleColumns,
  allVisibleSelected,
  onToggleAllVisibleLines,
  visibleLineIdCount,
  items,
  hasVisibleRowsForRender,
  isReadOnly,
  isViewerMode,
  onAddRootSection,
  rootAddSectionLabel,
  onResetQualityFilter,
  sensors,
  onDragEnd,
  isVirtualized,
  virtualizedSortableIds,
  virtualTotalSize,
  virtualItems,
  flattenedRows,
  measureElement,
  virtualScrollRef,
  virtualBodyStyle,
  onBodyMouseDown,
  spreadsheetRowCount,
  renderVirtualRow,
  renderList,
  grandTotals,
  currency = "EUR",
}: EstimateEditorTableChromeProps) {
  return (
    <>
      <div
        ref={tableCardRef}
        className={
          headerRight
            ? "grid gap-2 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start xl:gap-x-3"
            : undefined
        }
        data-testid="estimate-editor-table-shell"
        data-density="compact"
        data-has-side-panel={headerRight ? "true" : "false"}
      >
        <div
          className={
            ribbonHeaderNode
              ? "relative z-10"
              : "dashboard-card relative z-10 p-3 sm:p-4"
          }
          data-testid="estimate-editor-table-card"
        >
          {ribbonHeaderNode ? (
            <ProductionRibbon
              ariaLabel="Ruban métier du chiffrage"
              testId="estimate-editor-production-ribbon"
            >
              {ribbonHeaderNode}
              {toolbarNode}
            </ProductionRibbon>
          ) : (
            <div className="w-full min-w-0">{toolbarNode}</div>
          )}

          {ribbonAlertsNode ? (
            <div className="mt-3">{ribbonAlertsNode}</div>
          ) : null}

          {activeLineBreadcrumb ? (
            <div className="mt-2 text-xs text-[var(--slate-500)]">
              Chemin actif: {activeLineBreadcrumb}
            </div>
          ) : null}

          {actionError ? (
            <div
              className="alert alert-error mt-4"
              data-testid="estimate-editor-table-error-alert"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6" />
                <path d="m9 9 6 6" />
              </svg>
              {actionError}
            </div>
          ) : null}

        </div>

        {headerRight ? (
          <div className="w-full xl:col-start-2 xl:row-span-2 xl:row-start-1">
            {headerRight}
          </div>
        ) : null}

        {mobileListNode}

        <div
          ref={scrollContainerRef}
          className={
            headerRight
              ? "estimate-table-scroll overflow-x-auto xl:col-start-1 xl:row-start-2"
              : "estimate-table-scroll mt-2 overflow-x-auto"
          }
          data-mobile-view={showFullTableOnMobile ? "table" : "compact"}
          data-testid="estimate-editor-table-scroll"
        >
          <div
            className={`estimate-table${isLaborSplitEnabled ? " estimate-table--labor-split" : ""}`}
            style={dynamicGridStyle}
            data-testid="estimate-editor-table"
          >
            <div
              className="estimate-table__super-head"
              aria-label="Groupes de colonnes"
            >
              <div
                className="estimate-super-head__spacer estimate-super-head__spacer--help"
                style={{ gridColumn: "1 / span 3" }}
              >
                <EstimateColumnsHelpPanel />
              </div>
              <div
                className="estimate-super-head__group estimate-super-head__group--fo"
                style={{
                  gridColumn: `${superHeaderSpans.foStart} / span ${superHeaderSpans.foSpan}`,
                }}
                aria-hidden="true"
              >
                Fournitures
              </div>
              <div
                className="estimate-super-head__group estimate-super-head__group--mo"
                style={{
                  gridColumn: `${superHeaderSpans.moStart} / span ${superHeaderSpans.moSpan}`,
                }}
                aria-hidden="true"
              >
                Main d&apos;oeuvre
              </div>
              <div
                className="estimate-super-head__group estimate-super-head__group--sale"
                style={{
                  gridColumn: `${superHeaderSpans.puStart} / span 2`,
                }}
                aria-hidden="true"
              >
                Vente
              </div>
              <div
                className="estimate-super-head__spacer"
                style={{
                  gridColumn: `${superHeaderSpans.puStart + 2} / span ${
                    1 +
                    (visibleColumns.has("ds") ? 1 : 0) +
                    (visibleColumns.has("marge") ? 1 : 0) +
                    (visibleColumns.has("marque") ? 1 : 0)
                  }`,
                }}
              />
            </div>

            <div
              className="estimate-table__head"
              data-testid="estimate-editor-table-head"
            >
              <div className="relative flex items-center gap-2">
                <input
                  type="checkbox"
                  className="estimate-line-checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) =>
                    onToggleAllVisibleLines(event.target.checked)
                  }
                  disabled={isReadOnly || visibleLineIdCount === 0}
                  aria-label="Sélectionner toutes les lignes visibles"
                  data-testid="estimate-editor-select-all-visible-lines-checkbox"
                />
                <ColumnHeaderLabel label="Désignation" />
              </div>
              <div className="relative">
                <ColumnHeaderLabel label="Qté" />
              </div>
              <div className="relative">
                <ColumnHeaderLabel label="U" />
              </div>
              <div className="relative estimate-col--fo">
                <ColumnHeaderLabel label="PR FO" />
              </div>
              {isLaborSplitEnabled ? (
                <>
                  <div className="relative estimate-col--fo">
                    <ColumnHeaderLabel label="Type FO" />
                  </div>
                  <div className="relative estimate-col--fo">
                    <ColumnHeaderLabel label="K FO" />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="Majoration MO (%)" allowWrap />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="h MO atelier" allowWrap />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="Type MO atelier" allowWrap />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="K MO atelier" allowWrap />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="h MO chantier" allowWrap />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="Type MO chantier" allowWrap />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="K MO chantier" allowWrap />
                  </div>
                </>
              ) : (
                <>
                  {visibleColumns.has("supply_type") ? (
                    <div className="relative estimate-col--fo">
                      <ColumnHeaderLabel label="Type FO" />
                    </div>
                  ) : null}
                  {visibleColumns.has("k_fo") ? (
                    <div className="relative estimate-col--fo">
                      <ColumnHeaderLabel label="K FO" />
                    </div>
                  ) : null}
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderLabel label="h MO" />
                  </div>
                  {visibleColumns.has("h_mo_majoration") ? (
                    <div className="relative estimate-col--mo">
                      <ColumnHeaderLabel label="Majoration MO (%)" allowWrap />
                    </div>
                  ) : null}
                  {visibleColumns.has("labor_role") ? (
                    <div className="relative estimate-col--mo">
                      <ColumnHeaderLabel label="Type MO" />
                    </div>
                  ) : null}
                  {visibleColumns.has("k_mo") ? (
                    <div className="relative estimate-col--mo">
                      <ColumnHeaderLabel label="K MO" />
                    </div>
                  ) : null}
                </>
              )}
              <div className="relative estimate-cell--pu-separator estimate-col--sale">
                <ColumnHeaderLabel label="PU" />
              </div>
              <div className="relative estimate-col--sale">
                <ColumnHeaderLabel label="Prix total" />
              </div>
              {/* EST-E15 increment 1 — sous-detail de prix, en lecture seule. */}
              {visibleColumns.has("ds") ? (
                <div className="relative estimate-col--margin">
                  <ColumnHeaderLabel label="Deboursé sec" allowWrap />
                </div>
              ) : null}
              {visibleColumns.has("marge") ? (
                <div className="relative estimate-col--margin">
                  <ColumnHeaderLabel label="Marge €" />
                </div>
              ) : null}
              {visibleColumns.has("marque") ? (
                <div className="relative estimate-col--margin">
                  <ColumnHeaderLabel label="Marque %" />
                </div>
              ) : null}
              <div></div>
            </div>

            <EstimateEditorBody
              items={items}
              hasVisibleRows={hasVisibleRowsForRender}
              isReadOnly={isReadOnly}
              hideEditingActions={isViewerMode}
              onAddRootSection={onAddRootSection}
              rootAddSectionLabel={rootAddSectionLabel}
              onResetQualityFilter={onResetQualityFilter}
              sensors={sensors}
              onDragEnd={onDragEnd}
              isVirtualized={isVirtualized}
              virtualizedSortableIds={virtualizedSortableIds}
              virtualTotalSize={virtualTotalSize}
              virtualItems={virtualItems}
              flattenedRows={flattenedRows}
              measureElement={measureElement}
              virtualScrollRef={virtualScrollRef}
              virtualBodyStyle={virtualBodyStyle}
              onBodyMouseDown={onBodyMouseDown}
              spreadsheetRowCount={spreadsheetRowCount}
              renderVirtualRow={renderVirtualRow}
              renderList={renderList}
            />

            {hasVisibleRowsForRender ? (
              <div
                className="estimate-table__footer"
                data-testid="estimate-editor-table-footer"
              >
                <div className="font-semibold text-[var(--slate-800)]">
                  Total
                </div>
                <div></div>
                <div></div>
                <div
                  className="text-right font-medium text-[var(--slate-700)]"
                  title="Total Fournitures"
                >
                  {formatCurrency(grandTotals.foTotal, currency)}
                </div>
                {isLaborSplitEnabled ? (
                  <>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                  </>
                ) : (
                  <>
                    {visibleColumns.has("supply_type") ? <div></div> : null}
                    {visibleColumns.has("k_fo") ? <div></div> : null}
                    <div
                      className="text-right font-medium text-[var(--slate-700)]"
                      title="Total Main d'œuvre"
                    >
                      {formatCurrency(grandTotals.moTotal, currency)}
                    </div>
                    {visibleColumns.has("h_mo_majoration") ? <div></div> : null}
                    {visibleColumns.has("labor_role") ? <div></div> : null}
                    {visibleColumns.has("k_mo") ? <div></div> : null}
                  </>
                )}
                <div className="estimate-col--sale"></div>
                <div
                  className="estimate-col--sale text-right font-semibold text-[var(--slate-900)]"
                  title="Total HT"
                >
                  {formatCurrency(grandTotals.htTotal, currency)}
                </div>
                <div></div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

"use client";

import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { ColumnHeaderHelp, COLUMN_HEADER_TOOLTIPS } from "@/components/estimates/components/ColumnHeaderHelp";
import { EstimateEditorBody } from "@/components/estimates/components/EstimateEditorBody";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import { type ColumnKey } from "@/hooks/useColumnVisibility";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateEditorBodyProps = ComponentProps<typeof EstimateEditorBody>;

type EstimateEditorTableChromeProps = {
  tableCardRef: RefObject<HTMLDivElement | null>;
  headerRight?: ReactNode;
  toolbarNode: ReactNode;
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
  visibleColumns: Set<ColumnKey>;
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
        data-testid="estimate-editor-table-shell"
        data-density="compact"
      >
        <div
          className="dashboard-card relative z-10 p-3 sm:p-4 lg:p-6"
          data-testid="estimate-editor-table-card"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
            <div className="order-2 w-full min-w-0 flex-1 md:order-1">
              {toolbarNode}
              {activeLineBreadcrumb ? (
                <div className="mt-2 text-xs text-[var(--slate-500)]">
                  Chemin actif: {activeLineBreadcrumb}
                </div>
              ) : null}
            </div>
            {headerRight ? (
              <div className="order-1 w-full md:order-2 md:w-auto md:shrink-0">
                {headerRight}
              </div>
            ) : null}
          </div>

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

        <div
          ref={scrollContainerRef}
          className="estimate-table-scroll mt-2 overflow-x-auto"
          data-testid="estimate-editor-table-scroll"
        >
          <div
            className={`estimate-table${isLaborSplitEnabled ? " estimate-table--labor-split" : ""}`}
            style={dynamicGridStyle}
            data-testid="estimate-editor-table"
          >
            <div className="estimate-table__super-head" aria-hidden="true">
              <div
                className="estimate-super-head__spacer"
                style={{ gridColumn: "1 / span 3" }}
              />
              <div
                className="estimate-super-head__group estimate-super-head__group--fo"
                style={{
                  gridColumn: `${superHeaderSpans.foStart} / span ${superHeaderSpans.foSpan}`,
                }}
              >
                Fournitures
              </div>
              <div
                className="estimate-super-head__group estimate-super-head__group--mo"
                style={{
                  gridColumn: `${superHeaderSpans.moStart} / span ${superHeaderSpans.moSpan}`,
                }}
              >
                Main d&apos;oeuvre
              </div>
              <div
                className="estimate-super-head__spacer"
                style={{
                  gridColumn: `${superHeaderSpans.puStart} / span 3`,
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
                <ColumnHeaderHelp
                  label="Désignation"
                  tooltip={COLUMN_HEADER_TOOLTIPS["Désignation"]}
                />
              </div>
              <div className="relative">
                <ColumnHeaderHelp
                  label="Qté"
                  tooltip={COLUMN_HEADER_TOOLTIPS["Qté"]}
                />
              </div>
              <div className="relative">
                <ColumnHeaderHelp
                  label="U"
                  tooltip={COLUMN_HEADER_TOOLTIPS["U"]}
                />
              </div>
              <div className="relative estimate-col--fo">
                <ColumnHeaderHelp
                  label="PR. FO"
                  tooltip={COLUMN_HEADER_TOOLTIPS["PR. FO"]}
                />
              </div>
              {isLaborSplitEnabled ? (
                <>
                  <div className="relative estimate-col--fo">
                    <ColumnHeaderHelp
                      label="Type FO"
                      tooltip={COLUMN_HEADER_TOOLTIPS["Type FO"]}
                    />
                  </div>
                  <div className="relative estimate-col--fo">
                    <ColumnHeaderHelp
                      label="K FO"
                      tooltip={COLUMN_HEADER_TOOLTIPS["K FO"]}
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="Majoration MO (%)"
                      tooltip={COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"]}
                      allowWrap
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="h MO atelier"
                      tooltip={COLUMN_HEADER_TOOLTIPS["h MO atelier"]}
                      allowWrap
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="Type MO atelier"
                      tooltip={COLUMN_HEADER_TOOLTIPS["Type MO atelier"]}
                      allowWrap
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="K MO atelier"
                      tooltip={COLUMN_HEADER_TOOLTIPS["K MO atelier"]}
                      allowWrap
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="h MO chantier"
                      tooltip={COLUMN_HEADER_TOOLTIPS["h MO chantier"]}
                      allowWrap
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="Type MO chantier"
                      tooltip={COLUMN_HEADER_TOOLTIPS["Type MO chantier"]}
                      allowWrap
                    />
                  </div>
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="K MO chantier"
                      tooltip={COLUMN_HEADER_TOOLTIPS["K MO chantier"]}
                      allowWrap
                    />
                  </div>
                </>
              ) : (
                <>
                  {visibleColumns.has("supply_type") ? (
                    <div className="relative estimate-col--fo">
                      <ColumnHeaderHelp
                        label="Type FO"
                        tooltip={COLUMN_HEADER_TOOLTIPS["Type FO"]}
                      />
                    </div>
                  ) : null}
                  {visibleColumns.has("k_fo") ? (
                    <div className="relative estimate-col--fo">
                      <ColumnHeaderHelp
                        label="K FO"
                        tooltip={COLUMN_HEADER_TOOLTIPS["K FO"]}
                      />
                    </div>
                  ) : null}
                  <div className="relative estimate-col--mo">
                    <ColumnHeaderHelp
                      label="h MO"
                      tooltip={COLUMN_HEADER_TOOLTIPS["h MO"]}
                    />
                  </div>
                  {visibleColumns.has("h_mo_majoration") ? (
                    <div className="relative estimate-col--mo">
                      <ColumnHeaderHelp
                        label="Majoration MO (%)"
                        tooltip={COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"]}
                        allowWrap
                      />
                    </div>
                  ) : null}
                  {visibleColumns.has("labor_role") ? (
                    <div className="relative estimate-col--mo">
                      <ColumnHeaderHelp
                        label="Type MO"
                        tooltip={COLUMN_HEADER_TOOLTIPS["Type MO"]}
                      />
                    </div>
                  ) : null}
                  {visibleColumns.has("k_mo") ? (
                    <div className="relative estimate-col--mo">
                      <ColumnHeaderHelp
                        label="K MO"
                        tooltip={COLUMN_HEADER_TOOLTIPS["K MO"]}
                      />
                    </div>
                  ) : null}
                </>
              )}
              <div className="relative estimate-cell--pu-separator">
                <ColumnHeaderHelp
                  label="P.U."
                  tooltip={COLUMN_HEADER_TOOLTIPS["P.U."]}
                />
              </div>
              <div className="relative">
                <ColumnHeaderHelp
                  label="Prix total"
                  tooltip={COLUMN_HEADER_TOOLTIPS["Prix total"]}
                />
              </div>
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
                <div className="font-semibold text-[var(--slate-800)]">Total</div>
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
                <div></div>
                <div
                  className="text-right font-semibold text-[var(--slate-900)]"
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

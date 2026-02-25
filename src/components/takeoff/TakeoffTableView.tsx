"use client";

import {
  useCallback,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EditableCell } from "@/components/estimates/EditableCell";
import {
  useSpreadsheetNavigation,
  type SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";
import { detectAnomalies } from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import type { TakeoffTable } from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TakeoffTableViewProps = {
  tables: TakeoffTable[];
  items: ReviewItem[];
  onUpdateItem: (itemId: string, field: string, value: unknown) => void;
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
};

type TableCardData = {
  tableIndex: number;
  table: TakeoffTable;
  items: ReviewItem[];
};

type InclusionStatusFilter = "all" | "included" | "excluded" | "mixed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTableHealthBadge(tableItems: ReviewItem[]): {
  variant: "success" | "warning" | "error";
  label: string;
  pct: number;
} {
  if (tableItems.length === 0) {
    return { variant: "neutral" as never, label: "-", pct: 0 };
  }
  const clean = tableItems.filter((i) => detectAnomalies(i).length === 0).length;
  const pct = Math.round((clean / tableItems.length) * 100);
  const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "error";
  return { variant, label: `${pct}%`, pct };
}

function isTableExcluded(tableItems: ReviewItem[]): boolean {
  return tableItems.length > 0 && tableItems.every((i) => i.is_excluded);
}

function isTableIncluded(tableItems: ReviewItem[]): boolean {
  return tableItems.length > 0 && tableItems.every((i) => !i.is_excluded);
}

// ---------------------------------------------------------------------------
// Table card component
// ---------------------------------------------------------------------------

function TableCard({
  card,
  collapsed,
  onToggleCollapse,
  onUpdateItem,
  onExcludeItems,
  onIncludeItems,
}: {
  card: TableCardData;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onUpdateItem: (itemId: string, field: string, value: unknown) => void;
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
}) {
  const { table, items: tableItems, tableIndex } = card;
  const title = table.title ?? `Table ${tableIndex + 1}`;
  const health = getTableHealthBadge(tableItems);
  const excluded = isTableExcluded(tableItems);
  const anomalyCount = tableItems.filter((i) => detectAnomalies(i).length > 0).length;

  // Spreadsheet navigation scoped to this card
  const navigationRows: SpreadsheetNavigationRow[] = useMemo(
    () =>
      tableItems.map((item) => ({
        rowId: item.id,
        columnKeys: table.headers.map((_, ci) => `col_${ci}`),
      })),
    [tableItems, table.headers]
  );

  const navigation = useSpreadsheetNavigation({
    rows: navigationRows,
    disabled: collapsed || excluded,
  });

  const handleExcludeTable = useCallback(() => {
    const ids = tableItems.filter((i) => !i.is_excluded).map((i) => i.id);
    if (ids.length > 0) onExcludeItems(ids);
  }, [tableItems, onExcludeItems]);

  const handleIncludeTable = useCallback(() => {
    const ids = tableItems.filter((i) => i.is_excluded).map((i) => i.id);
    if (ids.length > 0) onIncludeItems(ids);
  }, [tableItems, onIncludeItems]);

  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-white transition-opacity ${
        excluded ? "opacity-60" : ""
      }`}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="text-[var(--slate-500)] hover:text-[var(--slate-700)]"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Deplier" : "Replier"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-5 w-5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--slate-800)]">
              {title}
            </span>
            <Badge variant={health.variant} size="sm">
              {health.label}
            </Badge>
            {excluded && (
              <Badge variant="neutral" size="sm">
                Exclue
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--slate-500)]">
            <span>Page {table.page}</span>
            <span>{table.headers.length} col</span>
            <span>{tableItems.length} lignes</span>
            {anomalyCount > 0 && (
              <span className="text-[var(--warning)]">{anomalyCount} anomalie{anomalyCount > 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        {excluded ? (
          <Button variant="secondary" size="sm" onClick={handleIncludeTable}>
            Inclure
          </Button>
        ) : (
          <Button variant="danger" size="sm" onClick={handleExcludeTable}>
            Exclure
          </Button>
        )}
      </div>

      {/* Card body */}
      {!collapsed && (
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="data-table w-full" role="grid">
            <thead>
              <tr>
                {table.headers.map((header, ci) => (
                  <th key={ci} className="text-xs">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableItems.map((item) => {
                const anomalies = detectAnomalies(item);
                const isExcluded = item.is_excluded;
                // Map item's table row data from the table.rows array
                const rowData = table.rows.find(
                  (r) =>
                    typeof item.metadata.row_index === "number" &&
                    r.row_index === item.metadata.row_index
                );

                return (
                  <tr
                    key={item.id}
                    className={[
                      isExcluded && "opacity-50",
                      item._error && "bg-[var(--error-light)]",
                      anomalies.length > 0 && !isExcluded && "bg-[var(--warning-light)]",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={
                      isExcluded && item.exclusion_reason
                        ? `Exclu: ${item.exclusion_reason}`
                        : anomalies.length > 0
                          ? `Anomalies: ${anomalies.length}`
                          : undefined
                    }
                  >
                    {table.headers.map((_, ci) => {
                      const cellValue = rowData?.cells[ci] ?? "";
                      // Map first column to designation, use raw cells for other columns
                      // The editable fields are: designation (mapped), quantity, unit
                      // For the table view, we show raw cell values with inline editing
                      const colKey = `col_${ci}`;

                      if (ci === 0) {
                        // First column: editable as designation
                        return (
                          <td key={ci}>
                            <EditableCell
                              cell={{ rowId: item.id, columnKey: colKey }}
                              navigation={navigation}
                              value={item.designation}
                              onChange={(val) => onUpdateItem(item.id, "designation", val)}
                              onCommit={(val) => onUpdateItem(item.id, "designation", val)}
                              readOnly={isExcluded}
                              placeholder="Designation..."
                              ariaLabel={`${table.headers[ci]} - ${item.designation}`}
                              className="editable-cell"
                            />
                            {item._saving && (
                              <span className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border border-[var(--info)] border-t-transparent" />
                            )}
                          </td>
                        );
                      }

                      // Check if this column looks like quantity (number)
                      const numVal = parseFloat(cellValue);
                      const isQuantityColumn =
                        Number.isFinite(numVal) &&
                        ci === 1 &&
                        table.headers.length >= 2;

                      if (isQuantityColumn) {
                        return (
                          <td key={ci}>
                            <EditableCell
                              cell={{ rowId: item.id, columnKey: colKey }}
                              navigation={navigation}
                              value={item.quantity}
                              onChange={(val) => {
                                const num = parseFloat(val);
                                if (Number.isFinite(num)) {
                                  onUpdateItem(item.id, "quantity", num);
                                }
                              }}
                              onCommit={(val: string) => {
                                const num = parseFloat(val);
                                if (Number.isFinite(num) && num > 0) {
                                  onUpdateItem(item.id, "quantity", num);
                                }
                              }}
                              readOnly={isExcluded}
                              type="number"
                              step="0.001"
                              min="0.001"
                              ariaLabel={`${table.headers[ci]}`}
                              className="editable-cell"
                            />
                          </td>
                        );
                      }

                      // Other columns: show raw cell value (read-only display)
                      return (
                        <td key={ci} className="text-sm text-[var(--slate-700)]">
                          {cellValue || (
                            <span className="text-[var(--slate-400)]">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TakeoffTableView
// ---------------------------------------------------------------------------

export function TakeoffTableView({
  tables,
  items,
  onUpdateItem,
  onExcludeItems,
  onIncludeItems,
}: TakeoffTableViewProps) {
  // ---- Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<InclusionStatusFilter>("all");
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());

  // ---- Build card data: associate items with tables
  const cards: TableCardData[] = useMemo(() => {
    return tables.map((table, tableIndex) => {
      const tableItems = items.filter(
        (item) =>
          typeof item.metadata.table_index === "number" &&
          item.metadata.table_index === tableIndex
      );
      return { tableIndex, table, items: tableItems };
    });
  }, [tables, items]);

  // ---- Unique pages
  const allPages = useMemo(() => {
    const pages = new Set<number>();
    for (const table of tables) {
      pages.add(table.page);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }, [tables]);

  // ---- Filter cards
  const filteredCards = useMemo(() => {
    let result = cards;

    // Search by title
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((c) => {
        const title = c.table.title ?? `Table ${c.tableIndex + 1}`;
        return title.toLowerCase().includes(q);
      });
    }

    // Filter by page
    if (pageFilter !== "all") {
      const pageNum = Number(pageFilter);
      result = result.filter((c) => c.table.page === pageNum);
    }

    // Filter by status
    if (statusFilter === "included") {
      result = result.filter((c) => isTableIncluded(c.items));
    } else if (statusFilter === "excluded") {
      result = result.filter((c) => isTableExcluded(c.items));
    } else if (statusFilter === "mixed") {
      result = result.filter(
        (c) => !isTableIncluded(c.items) && !isTableExcluded(c.items) && c.items.length > 0
      );
    }

    return result;
  }, [cards, searchQuery, pageFilter, statusFilter]);

  // ---- Group by page
  const groupedByPage = useMemo(() => {
    const groups = new Map<number, TableCardData[]>();
    for (const card of filteredCards) {
      const page = card.table.page;
      const group = groups.get(page) ?? [];
      group.push(card);
      groups.set(page, group);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [filteredCards]);

  // ---- Collapse/expand
  const toggleCollapse = useCallback((tableIndex: number) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(tableIndex)) {
        next.delete(tableIndex);
      } else {
        next.add(tableIndex);
      }
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedCards(new Set(filteredCards.map((c) => c.tableIndex)));
  }, [filteredCards]);

  const expandAll = useCallback(() => {
    setCollapsedCards(new Set());
  }, []);

  // ---- Empty state
  if (tables.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-white px-6 py-12 text-center">
        <p className="text-sm text-[var(--slate-500)]">
          Aucune table extraite pour ce job.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Rechercher par titre..."
          className="h-9 w-64 rounded-lg border border-[var(--border)] bg-white px-3 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {allPages.length > 1 && (
          <select
            className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value)}
          >
            <option value="all">Toutes pages</option>
            {allPages.map((p) => (
              <option key={p} value={String(p)}>
                Page {p}
              </option>
            ))}
          </select>
        )}

        <select
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as InclusionStatusFilter)}
        >
          <option value="all">Toutes</option>
          <option value="included">Incluses</option>
          <option value="excluded">Exclues</option>
          <option value="mixed">Mixtes</option>
        </select>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="text-xs text-[var(--slate-600)] hover:underline"
            onClick={collapseAll}
          >
            Tout replier
          </button>
          <button
            type="button"
            className="text-xs text-[var(--slate-600)] hover:underline"
            onClick={expandAll}
          >
            Tout deplier
          </button>
        </div>

        <span className="text-xs text-[var(--slate-500)]">
          {filteredCards.length} / {cards.length} table(s)
        </span>
      </div>

      {/* ---- Grouped cards ---- */}
      {filteredCards.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-white px-6 py-8 text-center">
          <p className="text-sm text-[var(--slate-500)]">
            Aucune table ne correspond aux filtres.
          </p>
        </div>
      ) : (
        groupedByPage.map(([page, pageCards]) => (
          <div key={page}>
            {/* Page separator */}
            {allPages.length > 1 && (
              <div className="sticky top-0 z-10 mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-xs font-medium text-[var(--slate-500)]">
                  Page {page}
                </span>
                <div className="h-px flex-1 bg-[var(--border)]" />
              </div>
            )}

            <div className="space-y-3">
              {pageCards.map((card) => (
                <TableCard
                  key={card.tableIndex}
                  card={card}
                  collapsed={collapsedCards.has(card.tableIndex)}
                  onToggleCollapse={() => toggleCollapse(card.tableIndex)}
                  onUpdateItem={onUpdateItem}
                  onExcludeItems={onExcludeItems}
                  onIncludeItems={onIncludeItems}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

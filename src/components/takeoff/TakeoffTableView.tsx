"use client";

import {
  useCallback,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EditableCell } from "@/components/estimates/EditableCell";
import {
  useSpreadsheetNavigation,
  type SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";
import { detectAnomalies } from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import type { TakeoffTable } from "@/lib/takeoff/types";
import { ChevronDownIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TakeoffTableViewProps = {
  tables: TakeoffTable[];
  items: ReviewItem[];
  onUpdateItem: (itemId: string, field: string, value: unknown) => void;
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
  onSyncToItems?: (itemIds: string[]) => void;
};

type TableCardData = {
  tableIndex: number;
  table: TakeoffTable;
  items: ReviewItem[];
  itemRowIndexById: Map<string, number>;
};

type InclusionStatusFilter = "all" | "included" | "excluded" | "mixed";
type EditableColumnField = "designation" | "quantity" | "unit" | "evidence";

const EDITABLE_COLUMN_HEADER_HINTS: Record<EditableColumnField, string[]> = {
  designation: ["designation", "description", "libelle", "article", "item"],
  quantity: ["quantite", "quantity", "qty", "qte", "qt"],
  unit: ["unite", "unit", "uom", "udm"],
  evidence: ["evidence", "source", "commentaire", "comment"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeHeaderLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveEditableField(header: string): EditableColumnField | null {
  const normalizedHeader = normalizeHeaderLabel(header);

  for (const field of Object.keys(EDITABLE_COLUMN_HEADER_HINTS) as EditableColumnField[]) {
    if (
      EDITABLE_COLUMN_HEADER_HINTS[field].some((hint) =>
        normalizedHeader.includes(hint)
      )
    ) {
      return field;
    }
  }

  return null;
}

function buildEditableColumnMap(headers: string[]) {
  const editableByIndex = new Map<number, EditableColumnField>();
  const takenFields = new Set<EditableColumnField>();
  const assignFallbackField = (index: number, field: EditableColumnField) => {
    if (takenFields.has(field)) return;
    if (index >= headers.length) return;
    if (editableByIndex.has(index)) return;

    editableByIndex.set(index, field);
    takenFields.add(field);
  };

  headers.forEach((header, index) => {
    const resolvedField = resolveEditableField(header);
    if (!resolvedField || takenFields.has(resolvedField)) return;

    editableByIndex.set(index, resolvedField);
    takenFields.add(resolvedField);
  });

  // Fallback to the default first columns when headers are ambiguous.
  assignFallbackField(0, "designation");
  assignFallbackField(1, "quantity");
  assignFallbackField(2, "unit");

  return editableByIndex;
}

function getTableHealthBadge(tableItems: ReviewItem[]): {
  variant: "success" | "warning" | "danger" | "neutral";
  label: string;
  pct: number;
} {
  if (tableItems.length === 0) {
    return { variant: "neutral", label: "—", pct: 0 };
  }
  const clean = tableItems.filter((i) => detectAnomalies(i).length === 0).length;
  const pct = Math.round((clean / tableItems.length) * 100);
  const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger";
  return { variant, label: `${pct} % conformes`, pct };
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
  onSyncToItems,
}: {
  card: TableCardData;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onUpdateItem: (itemId: string, field: string, value: unknown) => void;
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
  onSyncToItems?: (itemIds: string[]) => void;
}) {
  const { table, items: tableItems, tableIndex, itemRowIndexById } = card;
  const title = table.title ?? `Table ${tableIndex + 1}`;
  const health = getTableHealthBadge(tableItems);
  const excluded = isTableExcluded(tableItems);
  const anomalyCount = tableItems.filter((i) => detectAnomalies(i).length > 0).length;
  const tableRowsByIndex = useMemo(
    () => new Map(table.rows.map((row) => [row.row_index, row])),
    [table.rows]
  );
  const editableByColumnIndex = useMemo(
    () => buildEditableColumnMap(table.headers),
    [table.headers]
  );

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

  const handleSyncTable = useCallback(() => {
    if (!onSyncToItems) return;
    onSyncToItems(tableItems.map((item) => item.id));
  }, [onSyncToItems, tableItems]);

  return (
    <div
      className={`rounded-lg border border-border transition-colors ${
        excluded ? "bg-surface-subtle" : "bg-surface"
      }`}
    >
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapse}
          aria-label={`${collapsed ? "Déplier" : "Replier"} ${title}`}
          aria-expanded={!collapsed}
        >
          <ChevronDownIcon aria-hidden="true" className={`size-5 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
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
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Page {table.page}</span>
            <span>{table.headers.length} col</span>
            <span>{tableItems.length} lignes</span>
            {anomalyCount > 0 && (
              <span className="text-warning">{anomalyCount} anomalie{anomalyCount > 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSyncTable}
            disabled={!onSyncToItems || tableItems.length === 0}
          >
            Synchroniser items
          </Button>
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
      </div>

      {/* Card body */}
      {!collapsed && (
        <div
          className="relative overflow-x-auto border-t border-border"
          role="region"
          aria-label={title}
          tabIndex={0}
        >
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
                const rowIndex = itemRowIndexById.get(item.id);
                const rowData =
                  typeof rowIndex === "number"
                    ? tableRowsByIndex.get(rowIndex)
                    : undefined;

                return (
                  <tr
                    key={item.id}
                    className={[
                      isExcluded && "bg-surface-subtle text-muted-foreground",
                      item._error && "bg-danger-light",
                      anomalies.length > 0 && !isExcluded && "bg-warning-light",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={
                      isExcluded && item.exclusion_reason
                        ? `Exclu : ${item.exclusion_reason}`
                        : undefined
                    }
                  >
                    {table.headers.map((_, ci) => {
                      const cellValue = rowData?.cells[ci] ?? "";
                      const editableField = editableByColumnIndex.get(ci);
                      const colKey = `col_${ci}`;

                      if (editableField === "designation") {
                        return (
                          <td key={ci} role="presentation">
                            <EditableCell
                              cell={{ rowId: item.id, columnKey: colKey }}
                              navigation={navigation}
                              value={item.designation}
                              onChange={(val) => onUpdateItem(item.id, "designation", val)}
                              onCommit={(val) => onUpdateItem(item.id, "designation", val)}
                              readOnly={isExcluded}
                              placeholder="Désignation…"
                              ariaLabel={`${table.headers[ci]} - ${item.designation}`}
                              className="editable-cell"
                            />
                            {item._saving && (
                              <span
                                role="status"
                                aria-label="Sauvegarde en cours"
                                className="ml-1 inline-block size-3 animate-spin rounded-full border border-info border-t-transparent motion-reduce:animate-none"
                              />
                            )}
                          </td>
                        );
                      }

                      if (editableField === "quantity") {
                        return (
                          <td key={ci} role="presentation">
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
                              ariaLabel={table.headers[ci]}
                              className="editable-cell"
                            />
                          </td>
                        );
                      }

                      if (editableField === "unit") {
                        return (
                          <td key={ci} role="presentation">
                            <EditableCell
                              cell={{ rowId: item.id, columnKey: colKey }}
                              navigation={navigation}
                              value={item.unit}
                              onChange={(val) => onUpdateItem(item.id, "unit", val)}
                              onCommit={(val) => onUpdateItem(item.id, "unit", val)}
                              readOnly={isExcluded}
                              placeholder="Unité…"
                              ariaLabel={table.headers[ci]}
                              className="editable-cell"
                            />
                          </td>
                        );
                      }

                      if (editableField === "evidence") {
                        return (
                          <td key={ci} role="presentation">
                            <EditableCell
                              cell={{ rowId: item.id, columnKey: colKey }}
                              navigation={navigation}
                              value={item.evidence ?? ""}
                              onChange={(val) =>
                                onUpdateItem(item.id, "evidence", val.trim() || null)
                              }
                              onCommit={(val) =>
                                onUpdateItem(item.id, "evidence", val.trim() || null)
                              }
                              readOnly={isExcluded}
                              placeholder="Preuve…"
                              ariaLabel={table.headers[ci]}
                              className="editable-cell"
                            />
                          </td>
                        );
                      }

                      // Other columns: show raw cell value (read-only display)
                      return (
                        <td key={ci} className="text-sm text-foreground-secondary">
                          {cellValue || (
                            <span className="text-muted-foreground">—</span>
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
  onSyncToItems,
}: TakeoffTableViewProps) {
  // ---- Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<InclusionStatusFilter>("all");
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());

  // ---- Build card data: associate items with tables
  const cards: TableCardData[] = useMemo(() => {
    type AssignedItem = {
      item: ReviewItem;
      originalIndex: number;
      rowIndex: number | null;
    };

    const assignedByTable = new Map<number, AssignedItem[]>();
    const pendingByPage = new Map<number, AssignedItem[]>();

    const addAssignedItem = (tableIndex: number, assignedItem: AssignedItem) => {
      const current = assignedByTable.get(tableIndex);
      if (current) {
        current.push(assignedItem);
      } else {
        assignedByTable.set(tableIndex, [assignedItem]);
      }
    };

    // First pass: use metadata mapping when available.
    items.forEach((item, originalIndex) => {
      const tableIndex =
        typeof item.metadata.table_index === "number"
          ? item.metadata.table_index
          : null;
      const rowIndex =
        typeof item.metadata.row_index === "number"
          ? item.metadata.row_index
          : null;
      const assignedItem: AssignedItem = {
        item,
        originalIndex,
        rowIndex,
      };

      if (
        typeof tableIndex === "number" &&
        Number.isInteger(tableIndex) &&
        tableIndex >= 0 &&
        tableIndex < tables.length
      ) {
        addAssignedItem(tableIndex, assignedItem);
        return;
      }

      if (item.source_page === null) {
        return;
      }

      const pageItems = pendingByPage.get(item.source_page) ?? [];
      pageItems.push(assignedItem);
      pendingByPage.set(item.source_page, pageItems);
    });

    // Legacy fallback (items without table metadata):
    // correlate by source_page and sequential row order for tables on that page.
    pendingByPage.forEach((pageItems, page) => {
      const tableIndexesOnPage = tables
        .map((table, tableIndex) => ({ table, tableIndex }))
        .filter(({ table }) => table.page === page)
        .map(({ tableIndex }) => tableIndex);

      if (tableIndexesOnPage.length === 0) {
        return;
      }

      const rowSlots: Array<{ tableIndex: number; rowIndex: number | null }> = [];
      tableIndexesOnPage.forEach((tableIndex) => {
        const sortedRows = [...tables[tableIndex].rows].sort(
          (a, b) => a.row_index - b.row_index
        );
        if (sortedRows.length === 0) {
          rowSlots.push({ tableIndex, rowIndex: null });
          return;
        }
        sortedRows.forEach((row) => {
          rowSlots.push({ tableIndex, rowIndex: row.row_index });
        });
      });

      const overflowTableIndex = tableIndexesOnPage[tableIndexesOnPage.length - 1];
      pageItems.forEach((pageItem, itemOffset) => {
        const rowSlot = rowSlots[itemOffset];
        const resolvedTableIndex = rowSlot?.tableIndex ?? overflowTableIndex;
        const resolvedRowIndex = pageItem.rowIndex ?? rowSlot?.rowIndex ?? null;
        addAssignedItem(resolvedTableIndex, {
          ...pageItem,
          rowIndex: resolvedRowIndex,
        });
      });
    });

    return tables.map((table, tableIndex) => {
      const tableItems = assignedByTable.get(tableIndex) ?? [];
      const sortedItems = [...tableItems].sort((a, b) => {
        const aHasRow = typeof a.rowIndex === "number";
        const bHasRow = typeof b.rowIndex === "number";
        if (aHasRow && bHasRow) {
          const aRowIndex = a.rowIndex as number;
          const bRowIndex = b.rowIndex as number;
          if (aRowIndex !== bRowIndex) {
            return aRowIndex - bRowIndex;
          }
        }
        if (aHasRow !== bHasRow) {
          return aHasRow ? -1 : 1;
        }
        return a.originalIndex - b.originalIndex;
      });

      const itemRowIndexById = new Map<string, number>();
      sortedItems.forEach(({ item, rowIndex }) => {
        if (typeof rowIndex === "number") {
          itemRowIndexById.set(item.id, rowIndex);
        }
      });

      return {
        tableIndex,
        table,
        items: sortedItems.map(({ item }) => item),
        itemRowIndexById,
      };
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

  // ---- Unique table options for filter
  const allTableOptions = useMemo(() => {
    return cards.map((card) => {
      const title = card.table.title?.trim();
      const suffix = title && title.length > 0 ? ` - ${title}` : "";
      return {
        value: String(card.tableIndex),
        label: `Table ${card.tableIndex + 1}${suffix}`,
      };
    });
  }, [cards]);

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

    // Filter by table
    if (tableFilter !== "all") {
      const selectedTable = Number(tableFilter);
      result = result.filter((c) => c.tableIndex === selectedTable);
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
  }, [cards, searchQuery, pageFilter, tableFilter, statusFilter]);

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
      <EmptyState
        title="Aucune table extraite"
        description="Cette extraction ne contient aucune table structurée."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          size="sm"
          placeholder="Rechercher par titre…"
          aria-label="Rechercher une table"
          className="w-full sm:w-64"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {allPages.length > 1 && (
          <NativeSelect
            size="sm"
            wrapperClassName="w-auto"
            aria-label="Filtrer par page"
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value)}
          >
            <option value="all">Toutes pages</option>
            {allPages.map((p) => (
              <option key={p} value={String(p)}>
                Page {p}
              </option>
            ))}
          </NativeSelect>
        )}

        {allTableOptions.length > 1 && (
          <NativeSelect
            size="sm"
            wrapperClassName="w-auto"
            aria-label="Filtrer par table"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          >
            <option value="all">Toutes tables</option>
            {allTableOptions.map((tableOption) => (
              <option key={tableOption.value} value={tableOption.value}>
                {tableOption.label}
              </option>
            ))}
          </NativeSelect>
        )}

        <NativeSelect
          size="sm"
          wrapperClassName="w-auto"
          aria-label="Filtrer par statut"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as InclusionStatusFilter)}
        >
          <option value="all">Toutes</option>
          <option value="included">Incluses</option>
          <option value="excluded">Exclues</option>
          <option value="mixed">Mixtes</option>
        </NativeSelect>

        <div className="flex gap-2 sm:ml-auto">
          <Button variant="ghost" size="xs" onClick={collapseAll}>
            Tout replier
          </Button>
          <Button variant="ghost" size="xs" onClick={expandAll}>
            Tout déplier
          </Button>
        </div>

        <span className="text-xs text-muted-foreground">
          {filteredCards.length} / {cards.length} table(s)
        </span>
      </div>

      {/* ---- Grouped cards ---- */}
      {filteredCards.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Aucune table ne correspond aux filtres"
        />
      ) : (
        groupedByPage.map(([page, pageCards]) => (
          <div key={page}>
            {/* Page separator */}
            {allPages.length > 1 && (
              <div className="sticky top-0 z-10 mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-muted-foreground">
                  Page {page}
                </span>
                <div className="h-px flex-1 bg-border" />
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
                  onSyncToItems={onSyncToItems}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

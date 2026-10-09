"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDownIcon, ArrowUpIcon, FileTextIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EditableCell } from "@/components/estimates/EditableCell";
import {
  useSpreadsheetNavigation,
  type SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import {
  DEFAULT_REVIEW_TABLE_FILTERS,
  TakeoffReviewFilters,
  type ReviewTableFilters,
  type SortDirection,
  type SortField,
} from "@/components/takeoff/review/TakeoffReviewFilters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TakeoffReviewTableProps = {
  items: ReviewItem[];
  onUpdateItem: (itemId: string, field: string, value: unknown) => void;
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
  onOpenEvidencePanel?: (itemId: string) => void;
};

export type AnomalyType =
  | "low_confidence"
  | "missing_evidence"
  | "zero_quantity"
  | "empty_designation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDITABLE_COLUMNS = ["designation", "quantity", "unit"] as const;

export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  low_confidence: "Confiance faible (< 50 %)",
  missing_evidence: "Aucune preuve ni source",
  zero_quantity: "Quantité nulle ou négative",
  empty_designation: "Désignation vide",
};

function compareConfidence(
  a: number | null,
  b: number | null,
  sortDirection: SortDirection
): number {
  // Always place missing confidence rows last, regardless of direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const cmp = a - b;
  return sortDirection === "asc" ? cmp : -cmp;
}

function getCategory(item: ReviewItem): string | null {
  return typeof item.metadata.category === "string" ? item.metadata.category : null;
}

// ---------------------------------------------------------------------------
// Anomaly detection (exported for reuse)
// ---------------------------------------------------------------------------

export function detectAnomalies(item: ReviewItem): AnomalyType[] {
  const anomalies: AnomalyType[] = [];
  if (item.confidence !== null && item.confidence < 0.5) {
    anomalies.push("low_confidence");
  }
  if (!item.evidence) {
    anomalies.push("missing_evidence");
  }
  if (item.quantity <= 0) {
    anomalies.push("zero_quantity");
  }
  if (!item.designation.trim()) {
    anomalies.push("empty_designation");
  }
  return anomalies;
}

export function hasBlockingAnomaly(item: ReviewItem): boolean {
  return !item.designation.trim() || item.quantity <= 0;
}

function matchesFilters(item: ReviewItem, filters: ReviewTableFilters): boolean {
  const query = filters.search.trim().toLowerCase();
  if (query && !item.designation.toLowerCase().includes(query)) return false;

  if (filters.inclusion === "included" && item.is_excluded) return false;
  if (filters.inclusion === "excluded" && !item.is_excluded) return false;

  if (filters.verification === "verified" && !item.is_verified) return false;
  if (filters.verification === "unverified" && item.is_verified) return false;

  if (filters.category !== "all" && getCategory(item) !== filters.category) return false;
  if (filters.page !== "all" && item.source_page !== Number(filters.page)) return false;
  if (
    filters.table !== "all" &&
    item.metadata.table_index !== Number(filters.table)
  ) {
    return false;
  }

  if (filters.anomaly !== "all") {
    const hasAnomalies = detectAnomalies(item).length > 0;
    if (filters.anomaly === "with_anomalies" && !hasAnomalies) return false;
    if (filters.anomaly === "without_anomalies" && hasAnomalies) return false;
  }

  const confidence = item.confidence;
  switch (filters.confidence) {
    case "high":
      return confidence !== null && confidence >= 0.8;
    case "medium":
      return confidence !== null && confidence >= 0.5 && confidence < 0.8;
    case "low":
      return confidence !== null && confidence < 0.5;
    case "missing":
      return confidence === null;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) {
    return (
      <Badge variant="neutral" size="sm">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Non évaluée</span>
      </Badge>
    );
  }
  const pct = Math.round(confidence * 100);
  const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger";
  return (
    <Badge variant={variant} size="sm">
      {pct} %
    </Badge>
  );
}

function ClickableConfidenceBadge({
  confidence,
  hasEvidence,
  onClick,
}: {
  confidence: number | null;
  hasEvidence: boolean;
  onClick?: () => void;
}) {
  const pct = confidence !== null ? Math.round(confidence * 100) : null;
  const barClass =
    pct === null
      ? "bg-border-strong"
      : pct >= 80
        ? "bg-success"
        : pct >= 50
          ? "bg-warning"
          : "bg-danger";
  const label = `${pct !== null ? `Confiance ${pct} %` : "Confiance non évaluée"}, ${
    hasEvidence ? "preuve disponible" : "aucune preuve"
  } — ouvrir la preuve`;

  return (
    <button
      type="button"
      className="group flex items-center gap-1.5 rounded-control px-1 py-0.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={onClick}
      aria-label={label}
    >
      <span aria-hidden="true" className="contents">
        <ConfidenceBadge confidence={confidence} />
        <span className="h-1.5 w-8 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full transition-all duration-300 ${barClass}`}
            style={{ width: pct !== null ? `${pct}%` : "0%" }}
          />
        </span>
        <FileTextIcon
          className={`size-3.5 ${hasEvidence ? "text-info" : "text-subtle-foreground"}`}
        />
      </span>
    </button>
  );
}

/** Anomaly count with an accessible, clickable detail list (was a title tooltip only). */
function AnomalyDetails({
  anomalies,
  designation,
}: {
  anomalies: AnomalyType[];
  designation: string;
}) {
  if (anomalies.length === 0) return null;
  const countLabel = `${anomalies.length} anomalie${anomalies.length > 1 ? "s" : ""}`;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`${countLabel} pour ${designation || "cet item"} : voir le détail`}
            className="inline-flex items-center gap-1 rounded-control px-1 py-0.5 text-xs font-semibold text-warning hover:bg-warning-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        }
      >
        <TriangleAlertIcon aria-hidden="true" className="size-4" />
        <span aria-hidden="true">{anomalies.length}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <PopoverTitle className="text-sm">{countLabel}</PopoverTitle>
        <ul className="list-disc space-y-1 pl-4 text-sm text-foreground-secondary">
          {anomalies.map((anomaly) => (
            <li key={anomaly}>{ANOMALY_LABELS[anomaly]}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function CategoryTag({ category }: { category: string | null }) {
  if (!category) {
    return (
      <span className="text-xs text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Sans catégorie</span>
      </span>
    );
  }
  return <Badge variant="neutral" size="sm">{category}</Badge>;
}

function SourceReference({
  sourceFileName,
  sourcePage,
}: {
  sourceFileName: string | null;
  sourcePage: number | null;
}) {
  if (!sourceFileName && sourcePage === null) {
    return (
      <span className="text-xs text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Source non localisée</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
      {sourceFileName ? (
        <span className="block max-w-[9rem] truncate" title={sourceFileName}>
          {sourceFileName}
        </span>
      ) : null}
      {sourcePage !== null && <span className="shrink-0">p. {sourcePage}</span>}
    </span>
  );
}

function SortableHeader({
  field,
  label,
  sortField,
  sortDirection,
  onSort,
  className,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const isActive = sortField === field;
  return (
    <th
      className={className}
      aria-sort={isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-control hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => onSort(field)}
      >
        {label}
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUpIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <ArrowDownIcon aria-hidden="true" className="size-3.5" />
          )
        ) : null}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main component (controlled)
// ---------------------------------------------------------------------------

export default function TakeoffReviewTable({
  items,
  onUpdateItem,
  onExcludeItems,
  onIncludeItems,
  onOpenEvidencePanel,
}: TakeoffReviewTableProps) {
  // ---- Filter/sort state
  const [filters, setFilters] = useState<ReviewTableFilters>(DEFAULT_REVIEW_TABLE_FILTERS);
  const [sortField, setSortField] = useState<SortField>("confidence");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const updateFilters = useCallback((patch: Partial<ReviewTableFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  // ---- Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Filter options
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of items) {
      const cat = getCategory(item);
      if (cat) cats.add(cat);
    }
    return Array.from(cats).sort();
  }, [items]);

  const allPages = useMemo(() => {
    const pages = new Set<number>();
    for (const item of items) {
      if (item.source_page !== null) pages.add(item.source_page);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }, [items]);

  const allTableIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const item of items) {
      const ti = item.metadata.table_index;
      if (typeof ti === "number") indices.add(ti);
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [items]);

  // ---- Filter + sort
  const filteredItems = useMemo(() => {
    const result = items.filter((item) => matchesFilters(item, filters));
    return result.sort((a, b) => {
      if (sortField === "confidence") {
        return compareConfidence(a.confidence, b.confidence, sortDirection);
      }
      let cmp = 0;
      if (sortField === "designation") {
        cmp = a.designation.localeCompare(b.designation, "fr");
      } else if (sortField === "quantity") {
        cmp = a.quantity - b.quantity;
      } else if (sortField === "category") {
        cmp = (getCategory(a) ?? "").localeCompare(getCategory(b) ?? "", "fr");
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [items, filters, sortField, sortDirection]);

  // ---- Spreadsheet navigation
  const navigationRows: SpreadsheetNavigationRow[] = useMemo(
    () =>
      filteredItems.map((item) => ({
        rowId: item.id,
        columnKeys: [...EDITABLE_COLUMNS],
      })),
    [filteredItems]
  );

  const navigation = useSpreadsheetNavigation({
    rows: navigationRows,
    disabled: false,
  });

  // ---- Selection
  const toggleSelection = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const filteredIds = new Set(filteredItems.map((i) => i.id));
    const allSelected = filteredItems.every((i) => selectedIds.has(i.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [filteredItems, selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // ---- Exclusion actions
  const handleExcludeSelected = useCallback(() => {
    const ids = Array.from(selectedIds).filter((id) => {
      const item = items.find((i) => i.id === id);
      return item && !item.is_excluded;
    });
    if (ids.length === 0) return;
    onExcludeItems(ids);
    clearSelection();
  }, [selectedIds, items, onExcludeItems, clearSelection]);

  const handleIncludeSelected = useCallback(() => {
    const ids = Array.from(selectedIds).filter((id) => {
      const item = items.find((i) => i.id === id);
      return item && item.is_excluded;
    });
    if (ids.length === 0) return;
    onIncludeItems(ids);
    clearSelection();
  }, [selectedIds, items, onIncludeItems, clearSelection]);

  // ---- Sort
  const handleSortChange = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField]
  );

  const handleSortFieldSelect = useCallback(
    (field: SortField) => {
      if (field === sortField) return;
      setSortField(field);
      setSortDirection("asc");
    },
    [sortField]
  );

  const selectedCount = selectedIds.size;
  const filteredSelectedCount = filteredItems.filter((i) =>
    selectedIds.has(i.id)
  ).length;

  // ---- Keyboard shortcuts for row actions
  const containerRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Only fire when not editing a cell
      if (navigation.editingCell) return;

      const activeRowId = navigation.activeCell?.rowId;
      if (!activeRowId) return;

      const activeItem = items.find((i) => i.id === activeRowId);
      if (!activeItem) return;

      const key = e.key.toLowerCase();

      if (key === "e") {
        e.preventDefault();
        if (activeItem.is_excluded) {
          onIncludeItems([activeRowId]);
        } else {
          onExcludeItems([activeRowId]);
        }
      } else if (key === "v") {
        e.preventDefault();
        onUpdateItem(activeRowId, "is_verified", !activeItem.is_verified);
      } else if (key === "p") {
        e.preventDefault();
        onOpenEvidencePanel?.(activeRowId);
      }
    },
    [navigation.editingCell, navigation.activeCell, items, onIncludeItems, onExcludeItems, onUpdateItem, onOpenEvidencePanel]
  );

  const sortHeaderProps = { sortField, sortDirection, onSort: handleSortChange };

  return (
    // Row shortcuts (E/V/P) bubble up from the focused grid cell.
    <div className="space-y-4" ref={containerRef} onKeyDown={handleKeyDown}>
      <TakeoffReviewFilters
        filters={filters}
        onFiltersChange={updateFilters}
        categories={allCategories}
        pages={allPages}
        tableIndices={allTableIndices}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortFieldChange={handleSortFieldSelect}
        onToggleSortDirection={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
        filteredCount={filteredItems.length}
        totalCount={items.length}
      />

      {/* ---- Keyboard shortcuts hint ---- */}
      <p className="text-xs text-muted-foreground">
        Raccourcis : <kbd className="rounded border border-border px-1">E</kbd> exclure/inclure,{" "}
        <kbd className="rounded border border-border px-1">V</kbd> vérifier,{" "}
        <kbd className="rounded border border-border px-1">P</kbd> preuve
      </p>

      {/* ---- Bulk actions bar ---- */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-info-border bg-info-subtle px-4 py-2 text-sm">
          <span className="font-medium text-foreground">
            {filteredSelectedCount} sélectionné{filteredSelectedCount > 1 ? "s" : ""}
          </span>
          <Button variant="danger" size="sm" onClick={handleExcludeSelected}>
            Exclure
          </Button>
          <Button variant="secondary" size="sm" onClick={handleIncludeSelected}>
            Inclure
          </Button>
          <Button variant="link" size="sm" onClick={clearSelection}>
            Tout désélectionner
          </Button>
        </div>
      )}

      {/* ---- Table ---- */}
      <div
        className="relative overflow-x-auto rounded-lg border border-border"
        role="region"
        aria-label="Items extraits"
        tabIndex={0}
      >
        <table role="grid" className="data-table w-full">
          <thead>
            <tr>
              <th className="w-[40px] text-center">
                <input
                  type="checkbox"
                  checked={
                    filteredItems.length > 0 &&
                    filteredItems.every((i) => selectedIds.has(i.id))
                  }
                  onChange={toggleSelectAll}
                  aria-label="Tout sélectionner"
                />
              </th>
              <SortableHeader field="designation" label="Désignation" {...sortHeaderProps} />
              <SortableHeader field="quantity" label="Quantité" className="w-[100px]" {...sortHeaderProps} />
              <th className="w-[80px]">Unité</th>
              <SortableHeader field="confidence" label="Confiance" className="w-[90px]" {...sortHeaderProps} />
              <th className="w-[60px]">Alertes</th>
              <SortableHeader field="category" label="Catégorie" className="w-[120px]" {...sortHeaderProps} />
              <th className="w-[140px]">Source</th>
              <th className="w-[120px]">Statut</th>
              <th className="w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  Aucun item ne correspond aux filtres.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const anomalies = detectAnomalies(item);
                const isExcluded = item.is_excluded;
                const rowClassName = [
                  isExcluded && "bg-surface-subtle",
                  item._error && "bg-danger-light",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <tr key={item.id} className={rowClassName}>
                    {/* Checkbox */}
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelection(item.id)}
                        aria-label={`Sélectionner ${item.designation}`}
                      />
                    </td>

                    {/* Editable cells: the inner element is the grid cell. */}
                    <td role="presentation">
                      <EditableCell
                        cell={{ rowId: item.id, columnKey: "designation" }}
                        navigation={navigation}
                        value={item.designation}
                        onChange={(val) =>
                          onUpdateItem(item.id, "designation", val)
                        }
                        onCommit={(val) =>
                          onUpdateItem(item.id, "designation", val)
                        }
                        readOnly={isExcluded}
                        placeholder="Désignation…"
                        ariaLabel="Désignation"
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

                    <td role="presentation">
                      <EditableCell
                        cell={{ rowId: item.id, columnKey: "quantity" }}
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
                        ariaLabel="Quantité"
                        className="editable-cell"
                      />
                    </td>

                    <td role="presentation">
                      <EditableCell
                        cell={{ rowId: item.id, columnKey: "unit" }}
                        navigation={navigation}
                        value={item.unit}
                        onChange={(val) =>
                          onUpdateItem(item.id, "unit", val)
                        }
                        onCommit={(val) =>
                          onUpdateItem(item.id, "unit", val)
                        }
                        readOnly={isExcluded}
                        placeholder="Unité"
                        ariaLabel="Unité"
                        className="editable-cell"
                      />
                    </td>

                    {/* Confidence */}
                    <td>
                      {onOpenEvidencePanel ? (
                        <ClickableConfidenceBadge
                          confidence={item.confidence}
                          hasEvidence={!!item.evidence}
                          onClick={() => onOpenEvidencePanel(item.id)}
                        />
                      ) : (
                        <ConfidenceBadge confidence={item.confidence} />
                      )}
                    </td>

                    {/* Anomalies */}
                    <td>
                      <AnomalyDetails anomalies={anomalies} designation={item.designation} />
                    </td>

                    {/* Category */}
                    <td>
                      <CategoryTag category={getCategory(item)} />
                    </td>

                    {/* Source */}
                    <td>
                      <SourceReference
                        sourceFileName={item.source_file_name}
                        sourcePage={item.source_page}
                      />
                    </td>

                    {/* Status badges */}
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {isExcluded ? (
                          <Badge variant="neutral" size="sm">
                            Exclu
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm">
                            Inclus
                          </Badge>
                        )}
                        {item.is_verified && (
                          <Badge variant="info" size="sm">
                            Vérifié
                          </Badge>
                        )}
                      </div>
                      {isExcluded && item.exclusion_reason ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          Motif : {item.exclusion_reason}
                        </p>
                      ) : null}
                    </td>

                    {/* Actions */}
                    <td>
                      {isExcluded ? (
                        <Button
                          variant="link"
                          size="xs"
                          aria-label={`Inclure ${item.designation || "cet item"}`}
                          onClick={() => onIncludeItems([item.id])}
                        >
                          Inclure
                        </Button>
                      ) : (
                        <Button
                          variant="link"
                          size="xs"
                          className="text-danger"
                          aria-label={`Exclure ${item.designation || "cet item"}`}
                          onClick={() => onExcludeItems([item.id])}
                        >
                          Exclure
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

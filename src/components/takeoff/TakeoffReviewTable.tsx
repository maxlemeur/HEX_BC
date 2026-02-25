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
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

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

type InclusionFilter = "all" | "included" | "excluded";
type AnomalyFilter = "all" | "with_anomalies" | "without_anomalies";
type ConfidenceFilter = "all" | "high" | "medium" | "low" | "missing";
type SortField = "designation" | "quantity" | "category" | "confidence";
type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDITABLE_COLUMNS = ["designation", "quantity", "unit"] as const;

export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  low_confidence: "Confiance faible (< 50%)",
  missing_evidence: "Aucune evidence/source",
  zero_quantity: "Quantite nulle ou negative",
  empty_designation: "Designation vide",
};

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

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) {
    return <Badge variant="neutral" size="sm">-</Badge>;
  }
  const pct = Math.round(confidence * 100);
  const variant =
    pct >= 80 ? "success" : pct >= 50 ? "warning" : "error";
  return (
    <Badge variant={variant} size="sm">
      {pct}%
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
  const barColor =
    pct === null
      ? "var(--slate-300)"
      : pct >= 80
        ? "var(--success)"
        : pct >= 50
          ? "var(--warning)"
          : "var(--danger)";
  const barWidth = pct !== null ? `${pct}%` : "0%";
  const tooltip = pct !== null
    ? `Confiance: ${pct}% — Cliquer pour voir l'evidence`
    : "Confiance non evaluee — Cliquer pour voir l'evidence";

  return (
    <button
      type="button"
      className="group flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-[var(--slate-100)]"
      onClick={onClick}
      title={tooltip}
    >
      <ConfidenceBadge confidence={confidence} />
      {/* Mini confidence bar */}
      <div className="h-1.5 w-8 overflow-hidden rounded-full bg-[var(--slate-100)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: barWidth, backgroundColor: barColor }}
        />
      </div>
      {/* Evidence icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-3.5 w-3.5 ${hasEvidence ? "text-[var(--info)]" : "text-[var(--slate-300)]"}`}
        aria-label={hasEvidence ? "Evidence disponible" : "Pas d'evidence"}
      >
        <path
          fillRule="evenodd"
          d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Anomaly warnings
// ---------------------------------------------------------------------------

function AnomalyWarnings({ anomalies }: { anomalies: AnomalyType[] }) {
  if (anomalies.length === 0) return null;
  return (
    <span className="inline-flex gap-0.5" title={anomalies.map((a) => ANOMALY_LABELS[a]).join(", ")}>
      {anomalies.length > 0 && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-[var(--warning)]"
          aria-label={`${anomalies.length} anomalie(s)`}
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Category tag
// ---------------------------------------------------------------------------

function CategoryTag({ metadata }: { metadata: Record<string, unknown> }) {
  const category =
    typeof metadata.category === "string" ? metadata.category : null;
  if (!category) return <span className="text-xs text-[var(--slate-400)]">-</span>;
  return <Badge variant="neutral" size="sm">{category}</Badge>;
}

// ---------------------------------------------------------------------------
// Source reference
// ---------------------------------------------------------------------------

function SourceReference({
  sourceFileName,
  sourcePage,
}: {
  sourceFileName: string | null;
  sourcePage: number | null;
}) {
  if (!sourceFileName && sourcePage === null) {
    return <span className="text-xs text-[var(--slate-400)]">-</span>;
  }
  return (
    <span className="text-xs text-[var(--slate-600)]" title={sourceFileName ?? undefined}>
      {sourceFileName ? sourceFileName.slice(0, 20) : ""}
      {sourcePage !== null && (
        <span className="ml-1 text-[var(--slate-400)]">p.{sourcePage}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component (now controlled)
// ---------------------------------------------------------------------------

export default function TakeoffReviewTable({
  items,
  onUpdateItem,
  onExcludeItems,
  onIncludeItems,
  onOpenEvidencePanel,
}: TakeoffReviewTableProps) {
  // ---- Filter/sort state
  const [searchQuery, setSearchQuery] = useState("");
  const [inclusionFilter, setInclusionFilter] = useState<InclusionFilter>("all");
  const [anomalyFilter, setAnomalyFilter] = useState<AnomalyFilter>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [sortField, setSortField] = useState<SortField>("designation");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");

  // ---- Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Category filter
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of items) {
      const cat =
        typeof item.metadata.category === "string"
          ? item.metadata.category
          : null;
      if (cat) cats.add(cat);
    }
    return Array.from(cats).sort();
  }, [items]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // ---- Unique pages for filter
  const allPages = useMemo(() => {
    const pages = new Set<number>();
    for (const item of items) {
      if (item.source_page !== null) pages.add(item.source_page);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }, [items]);

  // ---- Unique table indices for filter
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
    let result = items;

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((i) =>
        i.designation.toLowerCase().includes(q)
      );
    }

    // Inclusion filter
    if (inclusionFilter === "included") {
      result = result.filter((i) => !i.is_excluded);
    } else if (inclusionFilter === "excluded") {
      result = result.filter((i) => i.is_excluded);
    }

    // Category filter
    if (categoryFilter !== "all") {
      result = result.filter(
        (i) =>
          typeof i.metadata.category === "string" &&
          i.metadata.category === categoryFilter
      );
    }

    // Page filter
    if (pageFilter !== "all") {
      const pageNum = Number(pageFilter);
      result = result.filter((i) => i.source_page === pageNum);
    }

    // Table filter
    if (tableFilter !== "all") {
      const tableIdx = Number(tableFilter);
      result = result.filter(
        (i) => typeof i.metadata.table_index === "number" && i.metadata.table_index === tableIdx
      );
    }

    // Anomaly filter
    if (anomalyFilter === "with_anomalies") {
      result = result.filter((i) => detectAnomalies(i).length > 0);
    } else if (anomalyFilter === "without_anomalies") {
      result = result.filter((i) => detectAnomalies(i).length === 0);
    }

    // Confidence filter
    if (confidenceFilter === "high") {
      result = result.filter((i) => i.confidence !== null && i.confidence >= 0.8);
    } else if (confidenceFilter === "medium") {
      result = result.filter((i) => i.confidence !== null && i.confidence >= 0.5 && i.confidence < 0.8);
    } else if (confidenceFilter === "low") {
      result = result.filter((i) => i.confidence !== null && i.confidence < 0.5);
    } else if (confidenceFilter === "missing") {
      result = result.filter((i) => i.confidence === null);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === "designation") {
        cmp = a.designation.localeCompare(b.designation, "fr");
      } else if (sortField === "quantity") {
        cmp = a.quantity - b.quantity;
      } else if (sortField === "category") {
        const ca = (typeof a.metadata.category === "string" ? a.metadata.category : "") as string;
        const cb = (typeof b.metadata.category === "string" ? b.metadata.category : "") as string;
        cmp = ca.localeCompare(cb, "fr");
      } else if (sortField === "confidence") {
        cmp = (a.confidence ?? 0) - (b.confidence ?? 0);
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [items, searchQuery, inclusionFilter, categoryFilter, pageFilter, tableFilter, anomalyFilter, confidenceFilter, sortField, sortDirection]);

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
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of filteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of filteredIds) next.add(id);
        return next;
      });
    }
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

  // ---- Sort toggle
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

  const selectedCount = selectedIds.size;
  const filteredSelectedCount = filteredItems.filter((i) =>
    selectedIds.has(i.id)
  ).length;

  return (
    <div className="space-y-4">
      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          type="search"
          placeholder="Rechercher par designation..."
          className="h-9 w-64 rounded-lg border border-[var(--border)] bg-white px-3 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {/* Inclusion filter */}
        <select
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          value={inclusionFilter}
          onChange={(e) => setInclusionFilter(e.target.value as InclusionFilter)}
        >
          <option value="all">Toutes</option>
          <option value="included">Incluses</option>
          <option value="excluded">Exclues</option>
        </select>

        {/* Category filter */}
        {allCategories.length > 0 && (
          <select
            className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">Toutes categories</option>
            {allCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        )}

        {/* Page filter */}
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

        {/* Table filter */}
        {allTableIndices.length > 1 && (
          <select
            className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          >
            <option value="all">Toutes tables</option>
            {allTableIndices.map((ti) => (
              <option key={ti} value={String(ti)}>
                Table {ti + 1}
              </option>
            ))}
          </select>
        )}

        {/* Anomaly filter */}
        <select
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          value={anomalyFilter}
          onChange={(e) => setAnomalyFilter(e.target.value as AnomalyFilter)}
        >
          <option value="all">Toutes</option>
          <option value="with_anomalies">Avec anomalies</option>
          <option value="without_anomalies">Sans anomalies</option>
        </select>

        {/* Confidence filter */}
        <select
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          value={confidenceFilter}
          onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceFilter)}
        >
          <option value="all">Toute confiance</option>
          <option value="high">Fiable (&gt;80%)</option>
          <option value="medium">A verifier (50-80%)</option>
          <option value="low">Problematique (&lt;50%)</option>
          <option value="missing">Non evaluee</option>
        </select>

        {/* Sort */}
        <select
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          value={sortField}
          onChange={(e) => handleSortChange(e.target.value as SortField)}
        >
          <option value="designation">Tri: Designation</option>
          <option value="quantity">Tri: Quantite</option>
          <option value="category">Tri: Categorie</option>
          <option value="confidence">Tri: Confiance</option>
        </select>
        <button
          type="button"
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm hover:bg-[var(--slate-50)]"
          onClick={() =>
            setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
          }
          title={sortDirection === "asc" ? "Croissant" : "Decroissant"}
        >
          {sortDirection === "asc" ? "\u2191" : "\u2193"}
        </button>

        <span className="ml-auto text-xs text-[var(--slate-500)]">
          {filteredItems.length} / {items.length} affiche(s)
        </span>
      </div>

      {/* ---- Bulk actions bar ---- */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--info)] bg-[var(--info-light)] px-4 py-2 text-sm">
          <span className="font-medium">
            {filteredSelectedCount} selectionne(s)
          </span>
          <Button
            variant="danger"
            size="sm"
            onClick={handleExcludeSelected}
          >
            Exclure
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleIncludeSelected}
          >
            Inclure
          </Button>
          <button
            type="button"
            className="text-xs text-[var(--slate-600)] hover:underline"
            onClick={clearSelection}
          >
            Tout deselectionner
          </button>
        </div>
      )}

      {/* ---- Table ---- */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
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
                  aria-label="Tout selectionner"
                />
              </th>
              <th
                className="cursor-pointer select-none"
                onClick={() => handleSortChange("designation")}
              >
                Designation
                {sortField === "designation" && (
                  <span className="ml-1">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                )}
              </th>
              <th
                className="w-[100px] cursor-pointer select-none"
                onClick={() => handleSortChange("quantity")}
              >
                Quantite
                {sortField === "quantity" && (
                  <span className="ml-1">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                )}
              </th>
              <th className="w-[80px]">Unite</th>
              <th className="w-[70px]">Confiance</th>
              <th className="w-[50px]">Alertes</th>
              <th
                className="w-[120px] cursor-pointer select-none"
                onClick={() => handleSortChange("category")}
              >
                Categorie
                {sortField === "category" && (
                  <span className="ml-1">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                )}
              </th>
              <th className="w-[120px]">Source</th>
              <th className="w-[100px]">Statut</th>
              <th className="w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-sm text-[var(--slate-500)]">
                  Aucun item ne correspond aux filtres.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const anomalies = detectAnomalies(item);
                const isExcluded = item.is_excluded;
                const rowClassName = [
                  isExcluded && "opacity-50",
                  item._error && "bg-[var(--error-light)]",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <tr
                    key={item.id}
                    className={rowClassName}
                    title={
                      isExcluded && item.exclusion_reason
                        ? `Exclu: ${item.exclusion_reason}`
                        : undefined
                    }
                  >
                    {/* Checkbox */}
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelection(item.id)}
                        aria-label={`Selectionner ${item.designation}`}
                      />
                    </td>

                    {/* Designation */}
                    <td>
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
                        placeholder="Designation..."
                        ariaLabel="Designation"
                        className="editable-cell"
                      />
                      {item._saving && (
                        <span className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border border-[var(--info)] border-t-transparent" />
                      )}
                    </td>

                    {/* Quantity */}
                    <td>
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
                        ariaLabel="Quantite"
                        className="editable-cell"
                      />
                    </td>

                    {/* Unit */}
                    <td>
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
                        placeholder="Unite"
                        ariaLabel="Unite"
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
                      <AnomalyWarnings anomalies={anomalies} />
                    </td>

                    {/* Category */}
                    <td>
                      <CategoryTag metadata={item.metadata} />
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
                            Verifie
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td>
                      {isExcluded ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--info)] hover:underline"
                          onClick={() => onIncludeItems([item.id])}
                        >
                          Inclure
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--danger)] hover:underline"
                          onClick={() => onExcludeItems([item.id])}
                        >
                          Exclure
                        </button>
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

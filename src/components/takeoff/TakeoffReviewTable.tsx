"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EditableCell } from "@/components/estimates/EditableCell";
import {
  useSpreadsheetNavigation,
  type SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";
import {
  fetchTakeoffJob,
  isTakeoffApiError,
  patchTakeoffItems,
} from "@/lib/takeoff/client";
import type {
  TakeoffItemBatchPatchRequest,
  TakeoffItemPatchEntry,
  TakeoffJobItem,
} from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TakeoffReviewTableProps = {
  jobId: string;
  versionId: string;
};

type AnomalyType =
  | "low_confidence"
  | "missing_evidence"
  | "zero_quantity"
  | "empty_designation";

type ReviewItem = TakeoffJobItem & {
  _dirty: boolean;
  _saving: boolean;
  _error: string | null;
};

type InclusionFilter = "all" | "included" | "excluded";
type AnomalyFilter = "all" | "with_anomalies" | "without_anomalies";
type SortField = "designation" | "quantity" | "category";
type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SAVE_DEBOUNCE_MS = 500;

const EDITABLE_COLUMNS = ["designation", "quantity", "unit"] as const;

const ANOMALY_LABELS: Record<AnomalyType, string> = {
  low_confidence: "Confiance faible (< 50%)",
  missing_evidence: "Aucune evidence/source",
  zero_quantity: "Quantite nulle ou negative",
  empty_designation: "Designation vide",
};

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function detectAnomalies(item: ReviewItem): AnomalyType[] {
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

function hasBlockingAnomaly(item: ReviewItem): boolean {
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
// Summary stats bar
// ---------------------------------------------------------------------------

function SummaryStatsBar({ items }: { items: ReviewItem[] }) {
  const total = items.length;
  const included = items.filter((i) => !i.is_excluded).length;
  const excluded = items.filter((i) => i.is_excluded).length;
  const verified = items.filter((i) => i.is_verified).length;
  const withAnomalies = items.filter((i) => detectAnomalies(i).length > 0).length;

  return (
    <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--border)] bg-[var(--slate-50)] px-4 py-3 text-sm">
      <span>
        <span className="font-medium text-[var(--slate-800)]">{total}</span>{" "}
        <span className="text-[var(--slate-500)]">Total</span>
      </span>
      <span>
        <span className="font-medium text-[var(--success)]">{included}</span>{" "}
        <span className="text-[var(--slate-500)]">Inclus</span>
      </span>
      <span>
        <span className="font-medium text-[var(--slate-500)]">{excluded}</span>{" "}
        <span className="text-[var(--slate-500)]">Exclus</span>
      </span>
      <span>
        <span className="font-medium text-[var(--info)]">{verified}</span>{" "}
        <span className="text-[var(--slate-500)]">Verifies</span>
      </span>
      <span>
        <span className="font-medium text-[var(--warning)]">{withAnomalies}</span>{" "}
        <span className="text-[var(--slate-500)]">Anomalies</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exclusion reason modal
// ---------------------------------------------------------------------------

function ExclusionReasonModal({
  open,
  onOpenChange,
  count,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length > 0;

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            Exclure {count} item{count > 1 ? "s" : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="block text-sm font-medium text-[var(--slate-700)]">
            Motif d&apos;exclusion (obligatoire)
          </label>
          <textarea
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Indiquer le motif d'exclusion..."
            maxLength={500}
          />
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          <Button
            variant="danger"
            size="sm"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(reason.trim());
              onOpenChange(false);
            }}
          >
            Exclure
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TakeoffReviewTable({
  jobId,
  versionId,
}: TakeoffReviewTableProps) {
  const toast = useToast();

  // ---- Data state
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobFileName, setJobFileName] = useState<string | null>(null);

  // ---- Filter/sort state
  const [searchQuery, setSearchQuery] = useState("");
  const [inclusionFilter, setInclusionFilter] = useState<InclusionFilter>("all");
  const [anomalyFilter, setAnomalyFilter] = useState<AnomalyFilter>("all");
  const [sortField, setSortField] = useState<SortField>("designation");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // ---- Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Exclusion modal state
  const [exclusionModalOpen, setExclusionModalOpen] = useState(false);
  const [exclusionTargetIds, setExclusionTargetIds] = useState<string[]>([]);

  // ---- Auto-save
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

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

  // ---- Fetch data
  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);
        const response = await fetchTakeoffJob(jobId);
        if (canceled) return;
        setJobFileName(response.job.source_file_name);
        setItems(
          response.items.data.map((item) => ({
            ...item,
            _dirty: false,
            _saving: false,
            _error: null,
          }))
        );
      } catch (err) {
        if (canceled) return;
        setLoadError(
          isTakeoffApiError(err) ? err.message : "Impossible de charger les items."
        );
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    load();
    return () => {
      canceled = true;
    };
  }, [jobId]);

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

    // Anomaly filter
    if (anomalyFilter === "with_anomalies") {
      result = result.filter((i) => detectAnomalies(i).length > 0);
    } else if (anomalyFilter === "without_anomalies") {
      result = result.filter((i) => detectAnomalies(i).length === 0);
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
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [items, searchQuery, inclusionFilter, categoryFilter, anomalyFilter, sortField, sortDirection]);

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

  // ---- Item update helpers
  const updateItemField = useCallback(
    (itemId: string, field: string, value: unknown) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          return { ...item, [field]: value, _dirty: true, _error: null };
        })
      );
    },
    []
  );

  // ---- Auto-save logic
  const performSave = useCallback(async () => {
    if (savingRef.current) return;

    const dirtyItems = items.filter((i) => i._dirty && !i._saving);
    if (dirtyItems.length === 0) return;

    savingRef.current = true;

    // Mark saving
    setItems((prev) =>
      prev.map((item) =>
        item._dirty ? { ...item, _saving: true } : item
      )
    );

    const patchEntries: TakeoffItemPatchEntry[] = dirtyItems.map((item) => {
      const fields: TakeoffItemPatchEntry["fields"] = {};

      // We send all editable fields that may have changed
      // The comparison with original is done by the fact that _dirty is set
      fields.designation = item.designation;
      fields.quantity = item.quantity;
      fields.unit = item.unit;
      fields.is_excluded = item.is_excluded;
      if (item.is_excluded) {
        fields.exclusion_reason = item.exclusion_reason;
      }
      fields.is_verified = item.is_verified;

      return {
        item_id: item.id,
        updated_at: item.updated_at,
        fields,
      };
    });

    try {
      const response = await patchTakeoffItems(jobId, { items: patchEntries });

      setItems((prev) =>
        prev.map((item) => {
          const result = response.results.find((r) => r.item_id === item.id);
          if (!result) return item;

          if (result.success && result.item) {
            return {
              ...result.item,
              _dirty: false,
              _saving: false,
              _error: null,
            };
          }

          return {
            ...item,
            _saving: false,
            _error: result.error ?? "Erreur inconnue.",
          };
        })
      );

      if (response.failed > 0) {
        toast.warning({
          title: `${response.failed} item(s) non sauvegarde(s)`,
          description: "Verifiez les items en erreur.",
        });
      } else {
        toast.success({
          title: "Sauvegarde automatique",
          durationMs: 2000,
        });
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((item) =>
          item._saving
            ? { ...item, _saving: false, _error: "Echec de sauvegarde." }
            : item
        )
      );
      toast.error({
        title: "Erreur de sauvegarde",
        description: isTakeoffApiError(err) ? err.message : "Erreur inconnue.",
      });
    } finally {
      savingRef.current = false;
    }
  }, [items, jobId, toast]);

  // Trigger auto-save debounce when items change
  const hasDirty = items.some((i) => i._dirty);
  useEffect(() => {
    if (!hasDirty) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasDirty, performSave]);

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
    setExclusionTargetIds(ids);
    setExclusionModalOpen(true);
  }, [selectedIds, items]);

  const handleIncludeSelected = useCallback(() => {
    setItems((prev) =>
      prev.map((item) => {
        if (!selectedIds.has(item.id) || !item.is_excluded) return item;
        return {
          ...item,
          is_excluded: false,
          exclusion_reason: null,
          _dirty: true,
          _error: null,
        };
      })
    );
    clearSelection();
  }, [selectedIds, clearSelection]);

  const handleExcludeItem = useCallback((itemId: string) => {
    setExclusionTargetIds([itemId]);
    setExclusionModalOpen(true);
  }, []);

  const handleIncludeItem = useCallback(
    (itemId: string) => {
      updateItemField(itemId, "is_excluded", false);
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            is_excluded: false,
            exclusion_reason: null,
            _dirty: true,
            _error: null,
          };
        })
      );
    },
    [updateItemField]
  );

  const handleExclusionConfirm = useCallback(
    (reason: string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (!exclusionTargetIds.includes(item.id)) return item;
          return {
            ...item,
            is_excluded: true,
            exclusion_reason: reason,
            _dirty: true,
            _error: null,
          };
        })
      );
      clearSelection();
      setExclusionTargetIds([]);
    },
    [exclusionTargetIds, clearSelection]
  );

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

  // ---- Apply readiness
  const includedItems = items.filter((i) => !i.is_excluded);
  const hasIncluded = includedItems.length > 0;
  const hasDirtyOrSaving = items.some((i) => i._dirty || i._saving);
  const hasBlockingAnomalies = includedItems.some(hasBlockingAnomaly);
  const isApplyReady = hasIncluded && !hasDirtyOrSaving && !hasBlockingAnomalies;

  const selectedCount = selectedIds.size;
  const filteredSelectedCount = filteredItems.filter((i) =>
    selectedIds.has(i.id)
  ).length;

  // ---- Loading state
  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Review Takeoff</h1>
          <p className="page-description">Chargement...</p>
        </div>
        <div className="dashboard-card p-6">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-[var(--slate-200)]"
                style={{ width: `${60 + (i % 3) * 15}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- Error state
  if (loadError) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Review Takeoff</h1>
          <p className="page-description">{loadError}</p>
        </div>
        <div className="mt-4 flex gap-3">
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff/${jobId}`}
            className="btn btn-secondary btn-sm"
          >
            Retour au job
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* ---- Page header ---- */}
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Review Takeoff</h1>
          <p className="page-description">
            {jobFileName ?? "Job"} &mdash; {items.length} item(s) extraits
          </p>
        </div>
        <Link
          href={`/dashboard/estimates/${versionId}/takeoff/${jobId}`}
          className="btn btn-secondary btn-sm"
        >
          Retour au job
        </Link>
      </div>

      {/* ---- Summary stats ---- */}
      <SummaryStatsBar items={items} />

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

        {/* Sort */}
        <select
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          value={sortField}
          onChange={(e) => handleSortChange(e.target.value as SortField)}
        >
          <option value="designation">Tri: Designation</option>
          <option value="quantity">Tri: Quantite</option>
          <option value="category">Tri: Categorie</option>
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
                          updateItemField(item.id, "designation", val)
                        }
                        onCommit={(val) =>
                          updateItemField(item.id, "designation", val)
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
                            updateItemField(item.id, "quantity", num);
                          }
                        }}
                        onCommit={(val: string) => {
                          const num = parseFloat(val);
                          if (Number.isFinite(num) && num > 0) {
                            updateItemField(item.id, "quantity", num);
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
                          updateItemField(item.id, "unit", val)
                        }
                        onCommit={(val) =>
                          updateItemField(item.id, "unit", val)
                        }
                        readOnly={isExcluded}
                        placeholder="Unite"
                        ariaLabel="Unite"
                        className="editable-cell"
                      />
                    </td>

                    {/* Confidence */}
                    <td>
                      <ConfidenceBadge confidence={item.confidence} />
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
                          onClick={() => handleIncludeItem(item.id)}
                        >
                          Inclure
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--danger)] hover:underline"
                          onClick={() => handleExcludeItem(item.id)}
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

      {/* ---- Apply readiness bar ---- */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white px-4 py-3">
        <div className="text-sm">
          {isApplyReady ? (
            <span className="flex items-center gap-2 text-[var(--success)]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.06l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              Pret a appliquer ({includedItems.length} items)
            </span>
          ) : (
            <span className="flex items-center gap-2 text-[var(--slate-500)]">
              {!hasIncluded && "Aucun item inclus."}
              {hasIncluded && hasDirtyOrSaving && "Sauvegarde en cours..."}
              {hasIncluded && !hasDirtyOrSaving && hasBlockingAnomalies && (
                "Anomalies bloquantes sur les items inclus (designation vide ou quantite invalide)."
              )}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!isApplyReady}
          title={
            isApplyReady
              ? "Appliquer les items au chiffrage"
              : "Prochainement"
          }
        >
          Appliquer au chiffrage
        </Button>
      </div>

      {/* ---- Exclusion modal ---- */}
      <ExclusionReasonModal
        open={exclusionModalOpen}
        onOpenChange={setExclusionModalOpen}
        count={exclusionTargetIds.length}
        onConfirm={handleExclusionConfirm}
      />
    </div>
  );
}

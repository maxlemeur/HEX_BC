"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  saveTakeoffDpgfManualLink,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonSeverity,
  TakeoffDpgfComparisonSummary,
} from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TakeoffDpgfCompareViewProps = {
  data: TakeoffDpgfComparisonResponse;
  onRefresh: () => void;
};

type SeverityFilter = TakeoffDpgfComparisonSeverity | "all";

type SortKey =
  | "severity"
  | "delta_desc"
  | "delta_asc"
  | "dpgf_title"
  | "dpgf_position";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<TakeoffDpgfComparisonSeverity, number> = {
  critical: 0,
  warning: 1,
  missing: 2,
  ok: 3,
};

const SEVERITY_CARD_CSS: Record<TakeoffDpgfComparisonSeverity, string> = {
  ok: "border-emerald-200 bg-emerald-50/40",
  warning: "border-warning/30 bg-amber-50/40",
  critical: "border-rose-200 bg-rose-50/40",
  missing: "border-[var(--slate-200)] bg-[var(--slate-100)]",
};

const SEVERITY_BADGE_VARIANT: Record<TakeoffDpgfComparisonSeverity, "success" | "warning" | "error" | "neutral"> = {
  ok: "success",
  warning: "warning",
  critical: "error",
  missing: "neutral",
};

const SEVERITY_LABELS: Record<TakeoffDpgfComparisonSeverity, string> = {
  ok: "OK",
  warning: "Ecart",
  critical: "Critique",
  missing: "Absent",
};

const DELTA_TEXT_CSS: Record<TakeoffDpgfComparisonSeverity, string> = {
  ok: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  critical: "text-[var(--danger)]",
  missing: "text-[var(--slate-400)]",
};

const FILTER_OPTIONS: Array<{ value: SeverityFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "ok", label: "OK" },
  { value: "warning", label: "Ecart" },
  { value: "critical", label: "Critique" },
  { value: "missing", label: "Absent" },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "severity", label: "Severite" },
  { value: "delta_desc", label: "Ecart % desc" },
  { value: "delta_asc", label: "Ecart % asc" },
  { value: "dpgf_title", label: "Designation DPGF" },
  { value: "dpgf_position", label: "Position DPGF" },
];

const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value);
}

function formatDeltaPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatDeltaAbsolute(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

function matchesSearch(row: TakeoffDpgfComparisonRow, query: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  const dpgfTitle = row.dpgf?.title?.toLowerCase() ?? "";
  const dpgfDescription = row.dpgf?.description?.toLowerCase() ?? "";
  const takeoffDesignation = row.takeoff?.designation?.toLowerCase() ?? "";
  return (
    dpgfTitle.includes(lowerQuery) ||
    dpgfDescription.includes(lowerQuery) ||
    takeoffDesignation.includes(lowerQuery)
  );
}

function sortRows(rows: TakeoffDpgfComparisonRow[], sortBy: SortKey): TakeoffDpgfComparisonRow[] {
  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "severity":
        return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      case "delta_desc":
        return Math.abs(b.delta_percent ?? 0) - Math.abs(a.delta_percent ?? 0);
      case "delta_asc":
        return Math.abs(a.delta_percent ?? 0) - Math.abs(b.delta_percent ?? 0);
      case "dpgf_title":
        return (a.dpgf?.title ?? "").localeCompare(b.dpgf?.title ?? "", "fr");
      case "dpgf_position":
        return (a.dpgf?.position ?? Infinity) - (b.dpgf?.position ?? Infinity);
      default:
        return 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Summary Bar
// ---------------------------------------------------------------------------

function DpgfCompareSummaryBar({ summary }: { summary: TakeoffDpgfComparisonSummary }) {
  return (
    <section className="dashboard-card p-4">
      <h2 className="text-sm font-semibold text-[var(--slate-800)]">Resume comparaison DPGF</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2">
          <p className="text-xs text-[var(--slate-500)]">Correspondances</p>
          <p className="text-lg font-semibold text-emerald-700">{summary.matches}</p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2">
          <p className="text-xs text-[var(--slate-500)]">Ecarts</p>
          <p className="text-lg font-semibold text-[var(--warning)]">{summary.gaps}</p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2">
          <p className="text-xs text-[var(--slate-500)]">Absents DPGF</p>
          <p className="text-lg font-semibold text-[var(--danger)]">{summary.missing_dpgf}</p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2">
          <p className="text-xs text-[var(--slate-500)]">Absents Takeoff</p>
          <p className="text-lg font-semibold text-[var(--danger)]">{summary.missing_takeoff}</p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2">
          <p className="text-xs text-[var(--slate-500)]">Liens manuels</p>
          <p className="text-lg font-semibold text-[var(--info)]">{summary.manual_links}</p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2">
          <p className="text-xs text-[var(--slate-500)]">Total</p>
          <p className="text-lg font-semibold text-[var(--slate-900)]">{summary.total_rows}</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function DpgfCompareToolbar({
  severityFilter,
  onSeverityFilterChange,
  searchQuery,
  onSearchQueryChange,
  sortBy,
  onSortByChange,
  visibleCount,
  totalCount,
}: {
  severityFilter: SeverityFilter;
  onSeverityFilterChange: (value: SeverityFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  sortBy: SortKey;
  onSortByChange: (value: SortKey) => void;
  visibleCount: number;
  totalCount: number;
}) {
  return (
    <section className="dashboard-card p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="form-label" htmlFor="dpgf-severity-filter">
            Severite
          </label>
          <select
            id="dpgf-severity-filter"
            className="form-input form-select form-input--sm"
            value={severityFilter}
            onChange={(e) => onSeverityFilterChange(e.target.value as SeverityFilter)}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="dpgf-search">
            Recherche
          </label>
          <input
            id="dpgf-search"
            type="search"
            className="form-input form-input--sm"
            placeholder="Designation, titre..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="dpgf-sort">
            Tri
          </label>
          <select
            id="dpgf-sort"
            className="form-input form-select form-input--sm"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--slate-500)]" aria-live="polite">
        {visibleCount} ligne{visibleCount > 1 ? "s" : ""} sur {totalCount}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Manual Link Modal
// ---------------------------------------------------------------------------

type LinkCandidate = {
  id: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  page: number | null;
  confidence: number | null;
};

function DpgfManualLinkModal({
  open,
  onOpenChange,
  row,
  candidates,
  jobId,
  versionId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: TakeoffDpgfComparisonRow | null;
  candidates: LinkCandidate[];
  jobId: string;
  versionId: string;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredCandidates = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase();
    return candidates.filter((c) => c.label.toLowerCase().includes(q));
  }, [candidates, search]);

  const handleLink = useCallback(async () => {
    if (!row || !selectedId) return;

    const estimateItemId = row.dpgf?.estimate_item_id;
    const takeoffItemId = row.takeoff?.item_id;

    // Determine which side needs linking
    const isLinkingTakeoffToDpgf = estimateItemId && !takeoffItemId;
    const isLinkingDpgfToTakeoff = takeoffItemId && !estimateItemId;

    let payload: { version_id: string; estimate_item_id: string; takeoff_item_id: string };

    if (isLinkingTakeoffToDpgf) {
      // row has DPGF but no takeoff -> selectedId is a takeoff item
      payload = {
        version_id: versionId,
        estimate_item_id: estimateItemId,
        takeoff_item_id: selectedId,
      };
    } else if (isLinkingDpgfToTakeoff) {
      // row has takeoff but no DPGF -> selectedId is an estimate item
      payload = {
        version_id: versionId,
        estimate_item_id: selectedId,
        takeoff_item_id: takeoffItemId,
      };
    } else {
      return;
    }

    try {
      setSaving(true);
      await saveTakeoffDpgfManualLink(jobId, payload);
      toast.success({ title: "Lien manuel cree." });
      onOpenChange(false);
      setSearch("");
      setSelectedId(null);
      onSuccess();
    } catch (error) {
      toast.error({
        title: isTakeoffApiError(error)
          ? error.message
          : "Impossible de creer le lien manuel.",
      });
    } finally {
      setSaving(false);
    }
  }, [row, selectedId, jobId, versionId, toast, onOpenChange, onSuccess]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSearch("");
        setSelectedId(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const side = row?.dpgf && !row.takeoff ? "takeoff" : "dpgf";

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            Lier a un item {side === "takeoff" ? "takeoff" : "DPGF"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <input
            type="search"
            className="form-input form-input--sm mb-3 w-full"
            placeholder="Filtrer les candidats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {filteredCandidates.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--slate-500)]">
                Aucun candidat disponible.
              </p>
            ) : (
              filteredCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedId === candidate.id
                      ? "border-[var(--info)] bg-[var(--info-light)]"
                      : "border-[var(--slate-200)] hover:bg-[var(--slate-50)]"
                  }`}
                  onClick={() => setSelectedId(candidate.id)}
                >
                  <p className="font-medium text-[var(--slate-900)]">
                    {candidate.label}
                  </p>
                  <p className="text-xs text-[var(--slate-500)]">
                    {formatNumber(candidate.quantity)} {candidate.unit ?? ""}
                    {candidate.page != null ? ` · Page ${candidate.page}` : ""}
                    {candidate.confidence != null
                      ? ` · Confiance ${(candidate.confidence * 100).toFixed(0)}%`
                      : ""}
                  </p>
                </button>
              ))
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleOpenChange(false)}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!selectedId || saving}
            onClick={() => void handleLink()}
          >
            {saving ? "Liaison..." : "Lier"}
          </button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

// ---------------------------------------------------------------------------
// Unlink Popover (inline confirmation)
// ---------------------------------------------------------------------------

function UnlinkConfirm({
  row,
  jobId,
  versionId,
  onSuccess,
}: {
  row: TakeoffDpgfComparisonRow;
  jobId: string;
  versionId: string;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleUnlink = useCallback(async () => {
    if (!row.dpgf?.estimate_item_id) return;
    try {
      setSaving(true);
      await saveTakeoffDpgfManualLink(jobId, {
        version_id: versionId,
        estimate_item_id: row.dpgf.estimate_item_id,
        takeoff_item_id: null,
      });
      toast.success({ title: "Lien manuel supprime." });
      setOpen(false);
      onSuccess();
    } catch (error) {
      toast.error({
        title: isTakeoffApiError(error)
          ? error.message
          : "Impossible de supprimer le lien manuel.",
      });
    } finally {
      setSaving(false);
    }
  }, [row, jobId, versionId, toast, onSuccess]);

  if (!open) {
    return (
      <button
        type="button"
        className="rounded p-1 text-[var(--slate-500)] hover:bg-[var(--slate-100)] hover:text-[var(--danger)]"
        title="Supprimer le lien manuel"
        aria-label="Supprimer le lien manuel"
        onClick={() => setOpen(true)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="btn btn-sm text-xs text-[var(--danger)] hover:bg-rose-50"
        disabled={saving}
        onClick={() => void handleUnlink()}
      >
        {saving ? "..." : "Supprimer"}
      </button>
      <button
        type="button"
        className="btn btn-sm text-xs"
        onClick={() => setOpen(false)}
      >
        Annuler
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function TakeoffDpgfCompareView({
  data,
  onRefresh,
}: TakeoffDpgfCompareViewProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("severity");
  const [linkModalRow, setLinkModalRow] = useState<TakeoffDpgfComparisonRow | null>(null);

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, DEBOUNCE_MS);
  }, []);

  // Filter + sort
  const filteredRows = useMemo(() => {
    let rows = data.rows;
    if (severityFilter !== "all") {
      rows = rows.filter((r) => r.severity === severityFilter);
    }
    if (debouncedSearch.trim()) {
      rows = rows.filter((r) => matchesSearch(r, debouncedSearch));
    }
    return sortRows(rows, sortBy);
  }, [data.rows, severityFilter, debouncedSearch, sortBy]);

  // Candidates for manual linking
  const unmatchedTakeoffCandidates = useMemo<LinkCandidate[]>(() => {
    return data.rows
      .filter((r) => r.takeoff && !r.dpgf && r.match_source !== "manual")
      .map((r) => ({
        id: r.takeoff!.item_id,
        label: r.takeoff!.designation,
        quantity: r.takeoff!.quantity,
        unit: r.takeoff!.unit,
        page: r.takeoff!.source_page,
        confidence: r.takeoff!.confidence,
      }));
  }, [data.rows]);

  const unmatchedDpgfCandidates = useMemo<LinkCandidate[]>(() => {
    return data.rows
      .filter((r) => r.dpgf && !r.takeoff && r.match_source !== "manual")
      .map((r) => ({
        id: r.dpgf!.estimate_item_id,
        label: r.dpgf!.title,
        quantity: r.dpgf!.quantity,
        unit: r.dpgf!.unit,
        page: r.dpgf!.source_page,
        confidence: null,
      }));
  }, [data.rows]);

  const linkCandidates = useMemo(() => {
    if (!linkModalRow) return [];
    // If the row has DPGF but no takeoff, show unmatched takeoff items
    if (linkModalRow.dpgf && !linkModalRow.takeoff) return unmatchedTakeoffCandidates;
    // If the row has takeoff but no DPGF, show unmatched DPGF items
    if (linkModalRow.takeoff && !linkModalRow.dpgf) return unmatchedDpgfCandidates;
    return [];
  }, [linkModalRow, unmatchedTakeoffCandidates, unmatchedDpgfCandidates]);

  return (
    <div className="space-y-4">
      <DpgfCompareSummaryBar summary={data.summary} />

      <DpgfCompareToolbar
        severityFilter={severityFilter}
        onSeverityFilterChange={setSeverityFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchChange}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        visibleCount={filteredRows.length}
        totalCount={data.rows.length}
      />

      <section className="dashboard-card overflow-x-auto">
        {filteredRows.length === 0 ? (
          <p className="p-6 text-sm text-[var(--slate-600)]">
            Aucune ligne DPGF ou aucun item takeoff disponible.
          </p>
        ) : (
          <table className="data-table w-full">
            <caption className="sr-only">Comparaison DPGF vs Takeoff</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 90 }}>
                  Severite
                </th>
                <th scope="col" className="min-w-[180px]">
                  DPGF Titre
                </th>
                <th scope="col" style={{ width: 100 }}>
                  DPGF Qte
                </th>
                <th scope="col" className="min-w-[180px]">
                  Takeoff Designation
                </th>
                <th scope="col" style={{ width: 100 }}>
                  Takeoff Qte
                </th>
                <th scope="col" style={{ width: 110 }}>
                  Delta
                </th>
                <th scope="col" style={{ width: 80 }} className="hidden md:table-cell">
                  Source
                </th>
                <th scope="col" style={{ width: 60 }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <DpgfCompareRow
                  key={row.key}
                  row={row}
                  jobId={data.job_id}
                  versionId={data.version_id}
                  onLink={() => setLinkModalRow(row)}
                  onRefresh={onRefresh}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <DpgfManualLinkModal
        open={linkModalRow !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setLinkModalRow(null);
        }}
        row={linkModalRow}
        candidates={linkCandidates}
        jobId={data.job_id}
        versionId={data.version_id}
        onSuccess={onRefresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table Row
// ---------------------------------------------------------------------------

function DpgfCompareRow({
  row,
  jobId,
  versionId,
  onLink,
  onRefresh,
}: {
  row: TakeoffDpgfComparisonRow;
  jobId: string;
  versionId: string;
  onLink: () => void;
  onRefresh: () => void;
}) {
  const isUnmatched = !row.dpgf || !row.takeoff;
  const isManualLink = row.match_source === "manual";
  const deltaLabel = formatDeltaPercent(row.delta_percent);
  const deltaAbsoluteLabel = formatDeltaAbsolute(row.delta_absolute);

  return (
    <tr className={`border-b ${SEVERITY_CARD_CSS[row.severity]}`}>
      <td>
        <Badge
          variant={SEVERITY_BADGE_VARIANT[row.severity]}
          size="sm"
          aria-label={`Severite: ${SEVERITY_LABELS[row.severity]}`}
        >
          {SEVERITY_LABELS[row.severity]}
        </Badge>
      </td>
      <td>
        {row.dpgf ? (
          <span className="text-sm text-[var(--slate-900)]">{row.dpgf.title}</span>
        ) : (
          <span className="text-sm italic text-[var(--slate-400)]">-</span>
        )}
      </td>
      <td className="text-sm">
        {row.dpgf ? (
          <>
            {formatNumber(row.dpgf.quantity)}{" "}
            <span className="text-[var(--slate-500)]">{row.dpgf.unit ?? ""}</span>
          </>
        ) : (
          <span className="italic text-[var(--slate-400)]">-</span>
        )}
      </td>
      <td>
        {row.takeoff ? (
          <span className="text-sm text-[var(--slate-900)]">{row.takeoff.designation}</span>
        ) : (
          <span className="text-sm italic text-[var(--slate-400)]">-</span>
        )}
      </td>
      <td className="text-sm">
        {row.takeoff ? (
          <>
            {formatNumber(row.takeoff.quantity)}{" "}
            <span className="text-[var(--slate-500)]">{row.takeoff.unit}</span>
          </>
        ) : (
          <span className="italic text-[var(--slate-400)]">-</span>
        )}
      </td>
      <td>
        <span
          className={`text-sm font-medium ${DELTA_TEXT_CSS[row.severity]}`}
          title={deltaAbsoluteLabel}
          aria-label={
            row.delta_percent != null
              ? `Ecart: ${deltaLabel}`
              : "Pas d'ecart"
          }
        >
          {deltaLabel}
        </span>
      </td>
      <td className="hidden md:table-cell">
        {row.match_source ? (
          <Badge
            variant={row.match_source === "manual" ? "info" : "neutral"}
            size="sm"
          >
            {row.match_source === "manual" ? "Manuel" : "Auto"}
          </Badge>
        ) : (
          <span className="text-sm text-[var(--slate-400)]">-</span>
        )}
      </td>
      <td>
        {isManualLink ? (
          <UnlinkConfirm
            row={row}
            jobId={jobId}
            versionId={versionId}
            onSuccess={onRefresh}
          />
        ) : isUnmatched ? (
          <button
            type="button"
            className="rounded p-1 text-[var(--slate-500)] hover:bg-[var(--slate-100)] hover:text-[var(--info)]"
            title="Lier a un item"
            aria-label="Lier a un item takeoff"
            onClick={onLink}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l3-3a3.5 3.5 0 00-4.95-4.95l-1.5 1.5a.75.75 0 101.06 1.06l1.5-1.5zm-5 5a2 2 0 012.828 0 .75.75 0 101.06-1.06 3.5 3.5 0 00-4.95 0l-3 3a3.5 3.5 0 004.95 4.95l1.5-1.5a.75.75 0 00-1.06-1.06l-1.5 1.5a2 2 0 01-2.828-2.828l3-3z" clipRule="evenodd" />
            </svg>
          </button>
        ) : null}
      </td>
    </tr>
  );
}

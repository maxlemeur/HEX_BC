"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  duplicateEstimateVersion,
  fetchEstimateList,
  type EstimateListItem,
  type EstimateStatus,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";
import { useTableFilter } from "@/components/TableFilterBar/useTableFilter";
import { FilterSearch } from "@/components/TableFilterBar/FilterSearch";
import { SortControl } from "@/components/TableFilterBar/SortControl";
import { ResultCount } from "@/components/TableFilterBar/ResultCount";
import { EstimateStatusChips } from "@/components/estimates/EstimateStatusChips";
import type { SortOption } from "@/components/TableFilterBar/types";

const PAGE_SIZE = 20;

const ALL_STATUSES: EstimateStatus[] = ["draft", "sent", "accepted", "archived"];
const SORT_OPTIONS: SortOption[] = [
  { key: "updatedAt", label: "Date MAJ", defaultDirection: "desc" },
  { key: "totalHtCents", label: "Montant HT", defaultDirection: "desc" },
  { key: "projectName", label: "Nom projet", defaultDirection: "asc" },
];

function statusLabel(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoye";
    case "accepted":
      return "Accepte";
    case "archived":
      return "Archive";
    default:
      return status;
  }
}

function statusClass(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseStatusParam(param: string | null): EstimateStatus[] {
  if (!param) return [];
  return param.split(",").filter((s): s is EstimateStatus => ALL_STATUSES.includes(s as EstimateStatus));
}

export default function EstimatesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Read URL params for initial state
  const initialQ = searchParams.get("q") ?? "";
  const initialStatus = parseStatusParam(searchParams.get("status"));
  const initialSort = searchParams.get("sort") ?? "updatedAt";
  const initialDir = (searchParams.get("dir") ?? "desc") as "asc" | "desc";
  const initialPage = Math.max(1, Number(searchParams.get("page")) || 1);

  // Status chip selection (separate from useTableFilter's multi-select)
  const [selectedStatuses, setSelectedStatuses] = useState<EstimateStatus[]>(initialStatus);
  const [currentPage, setCurrentPage] = useState(initialPage);

  const fetchEstimates = useCallback(async () => fetchEstimateList(), []);

  const {
    data: rawEstimates = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<EstimateListItem[]>("estimate-list", fetchEstimates, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  // Pre-filter by status chips before passing to useTableFilter
  const statusFilteredData = useMemo(() => {
    if (selectedStatuses.length === 0) {
      // No chip selected = show all except archived (default behavior)
      return rawEstimates.filter((e) => e.status !== "archived");
    }
    return rawEstimates.filter((e) => selectedStatuses.includes(e.status));
  }, [rawEstimates, selectedStatuses]);

  // Status counts from raw data (unfiltered)
  const statusCounts = useMemo(() => {
    const counts: Record<EstimateStatus, number> = { draft: 0, sent: 0, accepted: 0, archived: 0 };
    for (const e of rawEstimates) {
      if (counts[e.status] !== undefined) {
        counts[e.status]++;
      }
    }
    return counts;
  }, [rawEstimates]);

  const {
    filteredData,
    totalCount,
    filteredCount,
    searchValue,
    setSearchValue,
    isSearchPending,
    clearAllFilters,
    activeFilterCount,
    sortState,
    setSort,
    toggleSortDirection,
  } = useTableFilter<EstimateListItem>({
    data: statusFilteredData,
    searchConfig: {
      placeholder: "Rechercher par projet ou client...",
      fields: ["projectName", "projectClient"],
    },
    sortOptions: SORT_OPTIONS,
    defaultSort: { key: initialSort, direction: initialDir },
    initialSearchValue: initialQ,
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedEstimates = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredData.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredData]);

  // Reset page to 1 when filters/search/sort change
  const prevSearchRef = useRef(searchValue);
  const prevStatusRef = useRef(selectedStatuses);
  const prevSortRef = useRef(sortState);

  useEffect(() => {
    if (
      prevSearchRef.current !== searchValue ||
      prevStatusRef.current !== selectedStatuses ||
      prevSortRef.current !== sortState
    ) {
      setCurrentPage(1);
      prevSearchRef.current = searchValue;
      prevStatusRef.current = selectedStatuses;
      prevSortRef.current = sortState;
    }
  }, [searchValue, selectedStatuses, sortState]);

  // Sync state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("q", searchValue);
    if (selectedStatuses.length > 0) params.set("status", selectedStatuses.join(","));
    if (sortState && sortState.key !== "updatedAt") params.set("sort", sortState.key);
    if (sortState && sortState.direction !== "desc") params.set("dir", sortState.direction);
    if (currentPage > 1) params.set("page", String(currentPage));

    const qs = params.toString();
    const newPath = qs ? `/dashboard/estimates?${qs}` : "/dashboard/estimates";
    router.replace(newPath, { scroll: false });
  }, [searchValue, selectedStatuses, sortState, currentPage, router]);

  const handleDuplicate = useCallback(
    async (versionId: string) => {
      if (duplicatingId) return;
      setActionError(null);
      setDuplicatingId(versionId);

      try {
        const duplicatedVersionId = await duplicateEstimateVersion(versionId);
        router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
        router.refresh();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Une erreur est survenue."
        );
      } finally {
        setDuplicatingId(null);
      }
    },
    [duplicatingId, router]
  );

  const handleClearAll = useCallback(() => {
    clearAllFilters();
    setSelectedStatuses([]);
  }, [clearAllFilters]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, page)));
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Chiffrages</h1>
          <p className="page-description">
            Suivez et preparez vos chiffrages par projet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates/templates">
            Templates
          </Link>
          <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates/assemblies">
            Assemblages
          </Link>
          <Link className="btn btn-primary btn-lg" href="/dashboard/estimates/new">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            Nouveau chiffrage
          </Link>
        </div>
      </div>

      {actionError ? (
        <div className="alert alert-error mb-6">
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

      <div className="dashboard-card overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 border-b border-[var(--slate-200)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--slate-800)]">
                Liste des chiffrages
              </h2>
              <p className="text-xs text-[var(--slate-500)]">
                Derniere version active par projet.
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              disabled={isValidating}
              onClick={() => void mutate()}
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={isValidating ? "animate-spin" : ""}
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {isValidating ? "Chargement..." : "Actualiser"}
            </button>
          </div>

          {/* Status chips */}
          <EstimateStatusChips
            counts={statusCounts}
            selected={selectedStatuses}
            onChange={setSelectedStatuses}
          />

          {/* Search + Sort + Count */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <div className="w-full max-w-sm">
                <FilterSearch
                  value={searchValue}
                  onChange={setSearchValue}
                  placeholder="Rechercher par projet ou client..."
                  isPending={isSearchPending}
                />
              </div>
              <SortControl
                options={SORT_OPTIONS}
                value={sortState}
                onSortChange={setSort}
                onDirectionToggle={toggleSortDirection}
              />
            </div>
            <ResultCount
              filteredCount={filteredCount}
              totalCount={totalCount}
              label="chiffrages"
              activeFilterCount={activeFilterCount + (selectedStatuses.length > 0 ? 1 : 0)}
              searchValue={searchValue}
              onClearAll={handleClearAll}
            />
          </div>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4">
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
            {loadError.message}
          </div>
        ) : null}

        {/* Desktop table */}
        <div className="hidden md:block">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Projet</th>
                  <th>Titre</th>
                  <th>Version</th>
                  <th>Statut</th>
                  <th className="text-right">Total HT vente</th>
                  <th>MAJ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEstimates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center">
                      {isLoading ? (
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                          <span className="text-[var(--slate-500)]">
                            Chargement...
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--slate-400)"
                              strokeWidth="1.5"
                            >
                              <rect x="3" y="4" width="18" height="16" rx="2" />
                              <path d="M7 8h10" />
                              <path d="M7 12h4" />
                              <path d="M13 12h4" />
                              <path d="M7 16h4" />
                              <path d="M13 16h4" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-medium text-[var(--slate-700)]">
                              Aucun chiffrage
                            </p>
                            <p className="mt-1 text-sm text-[var(--slate-500)]">
                              {searchValue || selectedStatuses.length > 0
                                ? "Aucun resultat pour ces filtres."
                                : "Creez votre premier chiffrage pour demarrer."}
                            </p>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  paginatedEstimates.map((estimate, index) => {
                    const isDuplicating = duplicatingId === estimate.versionId;
                    const title = estimate.title?.trim() || estimate.projectName?.trim() || "—";
                    const projectMeta =
                      estimate.projectReference?.trim() ||
                      estimate.projectClient?.trim();

                    return (
                      <tr
                        key={estimate.versionId}
                        className="animate-fade-in"
                        style={{ animationDelay: `${index * 0.03}s` }}
                      >
                        <td>
                          <div className="flex flex-col">
                            <span className="font-semibold text-[var(--slate-800)]">
                              {estimate.projectName}
                            </span>
                            {projectMeta ? (
                              <span className="text-xs text-[var(--slate-500)]">
                                {projectMeta}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-[var(--slate-600)]">{title}</td>
                        <td>
                          <Link
                            href={`/dashboard/estimates/${estimate.versionId}`}
                            className="inline-flex items-center rounded-md bg-[var(--slate-100)] px-2 py-1 font-mono text-xs font-medium text-[var(--slate-600)]"
                          >
                            V{estimate.versionNumber}
                          </Link>
                        </td>
                        <td>
                          <span className={statusClass(estimate.status)}>
                            {statusLabel(estimate.status)}
                          </span>
                        </td>
                        <td className="text-right font-mono font-semibold text-[var(--slate-800)]">
                          {formatEUR(estimate.totalHtCents)}
                        </td>
                        <td className="text-sm text-[var(--slate-500)]">
                          {formatDate(estimate.updatedAt)}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/dashboard/estimates/${estimate.versionId}`}
                              className="btn btn-secondary btn-sm"
                            >
                              Ouvrir
                            </Link>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => void handleDuplicate(estimate.versionId)}
                              disabled={Boolean(duplicatingId)}
                            >
                              {isDuplicating ? (
                                <>
                                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--slate-600)]"></span>
                                  Duplication...
                                </>
                              ) : (
                                "Dupliquer"
                              )}
                            </button>
                            <Link
                              href={`/dashboard/estimates/${estimate.versionId}/print`}
                              className="btn btn-ghost btn-sm"
                            >
                              Print
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
              <span className="text-[var(--slate-500)]">Chargement...</span>
            </div>
          ) : paginatedEstimates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="font-medium text-[var(--slate-700)]">Aucun chiffrage</p>
              <p className="text-sm text-[var(--slate-500)]">
                {searchValue || selectedStatuses.length > 0
                  ? "Aucun resultat pour ces filtres."
                  : "Creez votre premier chiffrage pour demarrer."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--slate-200)]">
              {paginatedEstimates.map((estimate) => {
                const title = estimate.title?.trim() || estimate.projectName?.trim() || "—";
                const projectMeta =
                  estimate.projectReference?.trim() ||
                  estimate.projectClient?.trim();

                return (
                  <div key={estimate.versionId} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[var(--slate-800)]">
                          {estimate.projectName}
                        </p>
                        {projectMeta ? (
                          <p className="truncate text-xs text-[var(--slate-500)]">
                            {projectMeta}
                          </p>
                        ) : null}
                        <p className="mt-0.5 truncate text-sm text-[var(--slate-600)]">
                          {title}
                        </p>
                      </div>
                      <span className={statusClass(estimate.status)}>
                        {statusLabel(estimate.status)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-mono font-semibold text-[var(--slate-800)]">
                          {formatEUR(estimate.totalHtCents)}
                        </span>
                        <span className="text-[var(--slate-400)]">|</span>
                        <span className="text-[var(--slate-500)]">
                          {formatDate(estimate.updatedAt)}
                        </span>
                        <span className="text-[var(--slate-400)]">|</span>
                        <span className="font-mono text-xs text-[var(--slate-500)]">
                          V{estimate.versionNumber}
                        </span>
                      </div>
                      <Link
                        href={`/dashboard/estimates/${estimate.versionId}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Ouvrir
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredCount > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-[var(--slate-200)] px-6 py-4">
            <div className="flex items-center gap-1">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => goToPage(1)}
                disabled={currentPage === 1}
                aria-label="Premiere page"
              >
                &laquo;
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Page precedente"
              >
                &lsaquo;
              </button>
            </div>
            <span className="text-xs text-[var(--slate-500)]">
              Page {currentPage} / {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="Page suivante"
              >
                &rsaquo;
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => goToPage(totalPages)}
                disabled={currentPage === totalPages}
                aria-label="Derniere page"
              >
                &raquo;
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

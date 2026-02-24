"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  duplicateEstimateVersion,
  fetchEstimateList,
  type EstimateListItem,
  type EstimateStatus,
} from "@/lib/estimates/client";
import {
  formatCurrency as formatEstimateCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import { useTableFilter } from "@/components/TableFilterBar/useTableFilter";
import { FilterSearch } from "@/components/TableFilterBar/FilterSearch";
import { SortControl } from "@/components/TableFilterBar/SortControl";
import { ResultCount } from "@/components/TableFilterBar/ResultCount";
import { EstimateStatusChips } from "@/components/estimates/EstimateStatusChips";
import type { SortOption } from "@/components/TableFilterBar/types";

const PAGE_SIZE = 20;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CURRENCY: SupportedEstimateCurrency = "EUR";

const DATE_RANGE_OPTIONS = [
  { value: "all", label: "Toutes les dates" },
  { value: "month", label: "Ce mois-ci" },
  { value: "quarter", label: "Ce trimestre" },
  { value: "year", label: "Cette année" },
] as const;

type DateRange = (typeof DATE_RANGE_OPTIONS)[number]["value"];

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
      return "Envoyé";
    case "accepted":
      return "Accepté";
    case "archived":
      return "Archivé";
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

function formatCurrency(cents: number, currency: SupportedEstimateCurrency) {
  return formatEstimateCurrency(cents, currency);
}

function resolveEstimateCurrency(estimate: EstimateListItem): SupportedEstimateCurrency {
  const maybeCurrency = (estimate as EstimateListItem & { currency?: string | null })
    .currency;
  return normalizeEstimateCurrency(maybeCurrency) ?? DEFAULT_CURRENCY;
}

function parseStatusParam(param: string | null): EstimateStatus[] {
  if (!param) return [];
  return param.split(",").filter((s): s is EstimateStatus => ALL_STATUSES.includes(s as EstimateStatus));
}

function getExpirationDate(estimate: EstimateListItem): Date | null {
  if (!estimate.dateDevis || estimate.validiteJours == null) return null;
  const d = new Date(estimate.dateDevis);
  d.setDate(d.getDate() + estimate.validiteJours);
  return d;
}

type ExpirationState = "expired" | "expiring_soon" | null;

function getExpirationState(estimate: EstimateListItem, now: Date): ExpirationState {
  if (estimate.status === "draft" || estimate.status === "archived") return null;
  const expDate = getExpirationDate(estimate);
  if (!expDate) return null;
  if (expDate.getTime() < now.getTime()) return "expired";
  if (expDate.getTime() - now.getTime() <= SEVEN_DAYS_MS) return "expiring_soon";
  return null;
}

function filterByDateRange(items: EstimateListItem[], range: DateRange): EstimateListItem[] {
  if (range === "all") return items;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  let start: Date;
  if (range === "month") {
    start = new Date(year, month, 1);
  } else if (range === "quarter") {
    const quarterStart = month - (month % 3);
    start = new Date(year, quarterStart, 1);
  } else {
    start = new Date(year, 0, 1);
  }

  return items.filter((e) => {
    const d = e.updatedAt ? new Date(e.updatedAt) : null;
    return d && d >= start;
  });
}

export default function EstimatesPage() {
  const pathname = usePathname();
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
  const [dateRange, setDateRange] = useState<DateRange>("all");

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
    let data: EstimateListItem[];
    if (selectedStatuses.length === 0) {
      // No chip selected = show all except archived (default behavior)
      data = rawEstimates.filter((e) => e.status !== "archived");
    } else {
      data = rawEstimates.filter((e) => selectedStatuses.includes(e.status));
    }
    return filterByDateRange(data, dateRange);
  }, [rawEstimates, selectedStatuses, dateRange]);

  // Metrics computation
  const metrics = useMemo(() => {
    const now = new Date();
    const nonArchived = rawEstimates.filter((e) => e.status !== "archived");
    const totalHtByCurrencyMap = new Map<SupportedEstimateCurrency, number>();
    nonArchived.forEach((estimate) => {
      const currency = resolveEstimateCurrency(estimate);
      totalHtByCurrencyMap.set(
        currency,
        (totalHtByCurrencyMap.get(currency) ?? 0) + estimate.totalHtCents
      );
    });
    const totalHtByCurrency = Array.from(totalHtByCurrencyMap.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totalHtCents]) => ({
        currency,
        totalHtCents,
      }));

    const acceptedCount = nonArchived.filter((e) => e.status === "accepted").length;
    const acceptanceRate = nonArchived.length > 0
      ? Math.round((acceptedCount / nonArchived.length) * 100)
      : 0;
    const expiringSoon = nonArchived.filter((e) => {
      const state = getExpirationState(e, now);
      return state === "expiring_soon" || state === "expired";
    }).length;

    return {
      total: rawEstimates.length,
      totalHtByCurrency,
      acceptanceRate,
      expiringSoon,
    };
  }, [rawEstimates]);

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
  const prevDateRangeRef = useRef(dateRange);

  useEffect(() => {
    if (
      prevSearchRef.current !== searchValue ||
      prevStatusRef.current !== selectedStatuses ||
      prevSortRef.current !== sortState ||
      prevDateRangeRef.current !== dateRange
    ) {
      setCurrentPage(1);
      prevSearchRef.current = searchValue;
      prevStatusRef.current = selectedStatuses;
      prevSortRef.current = sortState;
      prevDateRangeRef.current = dateRange;
    }
  }, [searchValue, selectedStatuses, sortState, dateRange]);

  // Sync state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("q", searchValue);
    if (selectedStatuses.length > 0) params.set("status", selectedStatuses.join(","));
    if (sortState && sortState.key !== "updatedAt") params.set("sort", sortState.key);
    if (sortState && sortState.direction !== "desc") params.set("dir", sortState.direction);
    if (currentPage > 1) params.set("page", String(currentPage));

    const qs = params.toString();
    const currentQs = searchParams.toString();
    if (qs === currentQs) {
      return;
    }
    const newPath = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newPath, { scroll: false });
  }, [searchValue, selectedStatuses, sortState, currentPage, pathname, router, searchParams]);

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
    setDateRange("all");
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
            Suivez et préparez vos chiffrages par projet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates/dashboard" title="Vue analytique des chiffrages">
            Dashboard
          </Link>
          <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates/templates" title="Modèles de chiffrage réutilisables">
            Templates
          </Link>
          <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates/assemblies" title="Groupes de lignes prédéfinis à insérer dans un chiffrage">
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

      {/* Metrics banner */}
      {!isLoading && rawEstimates.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="dashboard-card px-4 py-3">
            <p className="text-xs font-medium text-[var(--slate-500)]">Total devis</p>
            <p className="mt-1 text-xl font-bold text-[var(--slate-800)]">{metrics.total}</p>
          </div>
          <div className="dashboard-card px-4 py-3">
            <p className="text-xs font-medium text-[var(--slate-500)]">Total HT en cours</p>
            {metrics.totalHtByCurrency.length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {metrics.totalHtByCurrency.map((bucket) => (
                  <p
                    key={`kpi-total-ht-${bucket.currency}`}
                    className="font-mono text-lg font-bold leading-tight text-[var(--slate-800)]"
                  >
                    {formatCurrency(bucket.totalHtCents, bucket.currency)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xl font-bold text-[var(--slate-800)]">
                {formatCurrency(0, DEFAULT_CURRENCY)}
              </p>
            )}
          </div>
          <div className="dashboard-card px-4 py-3">
            <p className="text-xs font-medium text-[var(--slate-500)]">Taux d&#39;acceptation</p>
            <p className="mt-1 text-xl font-bold text-[var(--slate-800)]">{metrics.acceptanceRate}%</p>
          </div>
          <div className="dashboard-card px-4 py-3">
            <p className="text-xs font-medium text-[var(--slate-500)]">Expirant bientôt</p>
            <p className="mt-1 text-xl font-bold" style={{ color: metrics.expiringSoon > 0 ? "var(--orange-600, #ea580c)" : "var(--slate-800)" }}>
              {metrics.expiringSoon}
            </p>
          </div>
        </div>
      ) : null}

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
                Dernière version active par projet.
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
              <select
                className="btn btn-secondary btn-sm"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRange)}
              >
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <ResultCount
              filteredCount={filteredCount}
              totalCount={totalCount}
              label="chiffrages"
              activeFilterCount={activeFilterCount + (selectedStatuses.length > 0 ? 1 : 0) + (dateRange !== "all" ? 1 : 0)}
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
                  <th>Projet / Titre</th>
                  <th>Client</th>
                  <th>Version</th>
                  <th>Statut</th>
                  <th>Devise</th>
                  <th className="text-right">Total HT vente</th>
                  <th>MAJ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEstimates.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
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
                                ? "Aucun résultat pour ces filtres."
                                : "Créez votre premier chiffrage pour démarrer."}
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
                    const expState = getExpirationState(estimate, new Date());
                    const currency = resolveEstimateCurrency(estimate);

                    return (
                      <tr
                        key={estimate.versionId}
                        className="animate-fade-in"
                        style={{
                          animationDelay: `${index * 0.03}s`,
                          ...(expState === "expired" ? { backgroundColor: "rgba(239, 68, 68, 0.05)" } : {}),
                          ...(expState === "expiring_soon" ? { backgroundColor: "rgba(249, 115, 22, 0.05)" } : {}),
                        }}
                      >
                        <td>
                          <div className="flex flex-col">
                            <span className="font-semibold text-[var(--slate-800)]">
                              {estimate.projectName}
                            </span>
                            {title !== estimate.projectName ? (
                              <span className="text-xs text-[var(--slate-500)]">
                                {title}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-[var(--slate-600)]">
                          {estimate.projectClient || "—"}
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/estimates/${estimate.versionId}`}
                            className="inline-flex items-center rounded-md bg-[var(--slate-100)] px-2 py-1 font-mono text-xs font-medium text-[var(--slate-600)]"
                          >
                            V{estimate.versionNumber}
                          </Link>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className={statusClass(estimate.status)}>
                              {statusLabel(estimate.status)}
                            </span>
                            {expState === "expired" ? (
                              <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                Expiré
                              </span>
                            ) : expState === "expiring_soon" ? (
                              <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                                Expire bientôt
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="font-mono text-xs font-semibold uppercase tracking-wide text-[var(--slate-600)]">
                          {currency}
                        </td>
                        <td className="text-right font-mono font-semibold text-[var(--slate-800)]">
                          {formatCurrency(estimate.totalHtCents, currency)}
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
                              Voir
                            </Link>
                            <Link
                              href={`/dashboard/estimates/${estimate.versionId}/edit`}
                              className="btn btn-primary btn-sm"
                            >
                              Éditer
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
                              Imprimer
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
                  ? "Aucun résultat pour ces filtres."
                  : "Créez votre premier chiffrage pour démarrer."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--slate-200)]">
              {paginatedEstimates.map((estimate) => {
                const title = estimate.title?.trim() || estimate.projectName?.trim() || "—";
                const projectMeta =
                  estimate.projectReference?.trim() ||
                  estimate.projectClient?.trim();
                const mobileExpState = getExpirationState(estimate, new Date());
                const currency = resolveEstimateCurrency(estimate);

                return (
                  <div
                    key={estimate.versionId}
                    className="px-4 py-4"
                    style={{
                      ...(mobileExpState === "expired" ? { backgroundColor: "rgba(239, 68, 68, 0.05)" } : {}),
                      ...(mobileExpState === "expiring_soon" ? { backgroundColor: "rgba(249, 115, 22, 0.05)" } : {}),
                    }}
                  >
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
                      <div className="flex flex-col items-end gap-1">
                        <span className={statusClass(estimate.status)}>
                          {statusLabel(estimate.status)}
                        </span>
                        {mobileExpState === "expired" ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                            Expiré
                          </span>
                        ) : mobileExpState === "expiring_soon" ? (
                          <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                            Expire bientôt
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-mono font-semibold text-[var(--slate-800)]">
                          {formatCurrency(estimate.totalHtCents, currency)}
                        </span>
                        <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--slate-600)]">
                          {currency}
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
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/estimates/${estimate.versionId}/edit`}
                          className="btn btn-primary btn-sm"
                        >
                          Éditer
                        </Link>
                        <Link
                          href={`/dashboard/estimates/${estimate.versionId}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Voir
                        </Link>
                      </div>
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
                aria-label="Première page"
              >
                &laquo;
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Page précédente"
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
                aria-label="Dernière page"
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

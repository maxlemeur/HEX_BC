"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useUiMode } from "@/hooks/useUiMode";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/Toast";
import { toggleAffaireFavoriteAction } from "@/app/dashboard/affaires/_actions/favorites";
import { fetchAffaireManagerQueueSummaryAction } from "@/app/dashboard/affaires/_actions/manager-queue";
import { FilterSearch } from "@/components/TableFilterBar/FilterSearch";
import { SortControl } from "@/components/TableFilterBar/SortControl";
import { ResultCount } from "@/components/TableFilterBar/ResultCount";
import { EstimateStatusChips } from "@/components/estimates/EstimateStatusChips";
import { AffairesCardList } from "./AffairesCardList";
import { useBulkDeleteAffaires } from "./useBulkDeleteAffaires";
import type {
  AffaireManagerQueueFilter,
  AffairePageDataResult,
  AffairePageSize,
  AffaireSort,
  AffaireSortDirection,
  AffaireStatus,
} from "./types";
import type { SortOption, SortState } from "@/components/TableFilterBar/types";
import type { EstimateStatus } from "@/lib/estimates/client";

const AffairesDenseTable = dynamic(
  () =>
    import("./AffairesDenseTable").then((m) => ({
      default: m.AffairesDenseTable,
    })),
  { ssr: false }
);

// -- Constants --

const PAGE_SIZE_OPTIONS: AffairePageSize[] = [20, 50, 100];
const DEFAULT_PAGE_SIZE: AffairePageSize = 20;
const PAGE_SIZE_STORAGE_KEY = "affaires-page-size";
const MANAGER_QUEUE_FETCH_TIMEOUT_MS = 8_000;
export const AFFAIRE_SEARCH_DEBOUNCE_MS = 400;

const SORT_OPTIONS: SortOption[] = [
  { key: "updatedAt", label: "Date MAJ", defaultDirection: "desc" },
  { key: "name", label: "Nom", defaultDirection: "asc" },
  { key: "totalHtCents", label: "Montant", defaultDirection: "desc" },
];

// -- Helpers --

function readStoredPageSize(): AffairePageSize {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (PAGE_SIZE_OPTIONS.includes(stored as AffairePageSize))
      return stored as AffairePageSize;
  } catch {
    /* ignore */
  }
  return DEFAULT_PAGE_SIZE;
}

function writeStoredPageSize(size: AffairePageSize) {
  try {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  } catch {
    /* ignore */
  }
}

function isDraftSelectable(
  item: AffairePageDataResult["list"]["items"][number]
) {
  return !item.hasCurrentVersion || item.currentStatus === "draft";
}

// -- Props --

type Props = {
  initialData: AffairePageDataResult;
  initialQ: string;
  initialStatuses: AffaireStatus[];
  initialFavoritesOnly: boolean;
  initialManager: AffaireManagerQueueFilter;
  initialCursor: string | null;
  initialSize: AffairePageSize;
  initialSort: AffaireSort;
  initialDir: AffaireSortDirection;
};

type ManagerQueueSummaryState =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable";

export function AffairesPageClient({
  initialData,
  initialQ,
  initialStatuses,
  initialFavoritesOnly,
  initialManager,
  initialCursor,
  initialSize,
  initialSort,
  initialDir,
}: Readonly<Props>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isExpert } = useUiMode();
  const toast = useToast();

  // -- State --

  const [searchValue, setSearchValue] = useState(initialQ);
  const [debouncedSearch, setDebouncedSearch] = useState(initialQ);
  const isSearchPending = searchValue !== debouncedSearch;

  const [selectedStatuses, setSelectedStatuses] =
    useState<AffaireStatus[]>(initialStatuses);
  const [favoritesOnly, setFavoritesOnly] = useState(initialFavoritesOnly);
  const [managerFilter, setManagerFilter] =
    useState<AffaireManagerQueueFilter>(initialManager);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const [pageSize, setPageSize] = useState<AffairePageSize>(initialSize);
  const [cursorStack, setCursorStack] = useState<string[]>(
    initialCursor ? [] : []
  );
  const [currentCursor, setCurrentCursor] = useState<string | null>(
    initialCursor
  );

  const [sortState, setSortState] = useState<SortState>({
    key: initialSort,
    direction: initialDir,
  });
  const [favoriteOverrides, setFavoriteOverrides] = useState<
    Record<string, boolean>
  >({});
  const [favoritePendingIds, setFavoritePendingIds] = useState<string[]>([]);
  const [managerQueueSummary, setManagerQueueSummary] = useState(
    initialData.managerQueue ?? null
  );
  const [managerQueueSummaryState, setManagerQueueSummaryState] =
    useState<ManagerQueueSummaryState>(
      initialData.managerQueue ? "ready" : "idle"
    );

  // Use server-passed data directly (page.tsx refetches on navigation)
  const data = useMemo<AffairePageDataResult>(
    () => ({
      ...initialData,
      list: {
        ...initialData.list,
        items: initialData.list.items.map((item) => ({
          ...item,
          isFavorite: favoriteOverrides[item.projectId] ?? item.isFavorite,
        })),
      },
    }),
    [favoriteOverrides, initialData]
  );

  useEffect(() => {
    const visibleIds = new Set(
      initialData.list.items.map((item) => item.projectId)
    );
    setSelectedProjectIds((current) => {
      const next = current.filter((projectId) => visibleIds.has(projectId));
      return next.length === current.length ? current : next;
    });
  }, [initialData.list.items]);

  useEffect(() => {
    if (!isExpert) {
      setManagerQueueSummary(initialData.managerQueue ?? null);
      setManagerQueueSummaryState(initialData.managerQueue ? "ready" : "idle");
      return;
    }

    if (initialData.managerQueue) {
      setManagerQueueSummary(initialData.managerQueue);
      setManagerQueueSummaryState("ready");
      return;
    }

    if (initialData.counters.filteredCount > 200) {
      setManagerQueueSummary(null);
      setManagerQueueSummaryState("unavailable");
      return;
    }

    let cancelled = false;
    setManagerQueueSummary(null);
    setManagerQueueSummaryState("loading");
    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      setManagerQueueSummary(null);
      setManagerQueueSummaryState("error");
    }, MANAGER_QUEUE_FETCH_TIMEOUT_MS);

    fetchAffaireManagerQueueSummaryAction({
      q: initialQ,
      status: initialStatuses,
      favorites: initialFavoritesOnly,
    })
      .then((summary) => {
        if (cancelled) {
          return;
        }

        window.clearTimeout(timeoutId);
        setManagerQueueSummary(summary);
        setManagerQueueSummaryState("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        window.clearTimeout(timeoutId);
        setManagerQueueSummary(null);
        setManagerQueueSummaryState("error");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    initialData.counters.filteredCount,
    initialData.managerQueue,
    initialFavoritesOnly,
    initialQ,
    initialStatuses,
    isExpert,
  ]);

  useEffect(() => {
    setFavoriteOverrides((current) => {
      const serverFavorites = new Map(
        initialData.list.items.map((item) => [item.projectId, item.isFavorite])
      );

      let changed = false;
      const next = { ...current };

      Object.entries(current).forEach(([projectId, override]) => {
        if (favoritePendingIds.includes(projectId)) {
          return;
        }

        const serverValue = serverFavorites.get(projectId);
        if (serverValue === undefined || serverValue === override) {
          delete next[projectId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [favoritePendingIds, initialData]);

  // Hydrate page size from localStorage on mount
  useEffect(() => {
    const urlSize = Number(searchParams.get("size"));
    if (PAGE_SIZE_OPTIONS.includes(urlSize as AffairePageSize)) {
      setPageSize(urlSize as AffairePageSize);
    } else {
      setPageSize(readStoredPageSize());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Sync URL --

  useEffect(() => {
    if (searchValue === debouncedSearch) return;

    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, AFFAIRE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [debouncedSearch, searchValue]);

  const prevSearchRef = useRef(debouncedSearch);
  const prevStatusRef = useRef(selectedStatuses);
  const prevFavoritesRef = useRef(favoritesOnly);
  const prevManagerRef = useRef(managerFilter);
  const prevSortRef = useRef(sortState);
  const prevSizeRef = useRef(pageSize);
  const prevCursorRef = useRef(currentCursor);

  useEffect(() => {
    const searchChanged = prevSearchRef.current !== debouncedSearch;
    const statusChanged = prevStatusRef.current !== selectedStatuses;
    const favoritesChanged = prevFavoritesRef.current !== favoritesOnly;
    const managerChanged = prevManagerRef.current !== managerFilter;
    const sortChanged = prevSortRef.current !== sortState;
    const sizeChanged = prevSizeRef.current !== pageSize;
    const cursorChanged = prevCursorRef.current !== currentCursor;

    prevSearchRef.current = debouncedSearch;
    prevStatusRef.current = selectedStatuses;
    prevFavoritesRef.current = favoritesOnly;
    prevManagerRef.current = managerFilter;
    prevSortRef.current = sortState;
    prevSizeRef.current = pageSize;
    prevCursorRef.current = currentCursor;

    if (
      !searchChanged &&
      !statusChanged &&
      !favoritesChanged &&
      !managerChanged &&
      !sortChanged &&
      !sizeChanged &&
      !cursorChanged
    ) {
      return;
    }

    // Reset cursor when filters change
    if (
      searchChanged ||
      statusChanged ||
      favoritesChanged ||
      managerChanged ||
      sortChanged ||
      sizeChanged
    ) {
      setCursorStack([]);
      setCurrentCursor(null);
    }

    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (selectedStatuses.length > 0)
      params.set("status", selectedStatuses.join(","));
    if (favoritesOnly) params.set("favorites", "1");
    if (managerFilter !== "all") params.set("manager", managerFilter);
    if (sortState?.key && sortState.key !== "updatedAt")
      params.set("sort", sortState.key);
    if (sortState && sortState.direction !== "desc")
      params.set("dir", sortState.direction);
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(pageSize));

    // Only set cursor if not resetting
    const effectiveCursor =
      searchChanged ||
      statusChanged ||
      favoritesChanged ||
      managerChanged ||
      sortChanged ||
      sizeChanged
        ? null
        : currentCursor;
    if (effectiveCursor) params.set("cursor", effectiveCursor);

    const qs = params.toString();
    const currentQs = searchParams.toString();
    if (qs === currentQs) return;

    const newPath = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newPath, { scroll: false });
  }, [
    debouncedSearch,
    selectedStatuses,
    favoritesOnly,
    managerFilter,
    sortState,
    pageSize,
    currentCursor,
    pathname,
    router,
    searchParams,
  ]);

  // -- Handlers --

  const handleStatusChange = useCallback((statuses: EstimateStatus[]) => {
    setSelectedStatuses(statuses as AffaireStatus[]);
  }, []);

  const handlePageSizeChange = useCallback(
    (size: AffairePageSize) => {
      setPageSize(size);
      writeStoredPageSize(size);
      setCursorStack([]);
      setCurrentCursor(null);
    },
    []
  );

  const handleNextPage = useCallback(() => {
    if (!data.list.nextCursor) return;
    setCursorStack((prev) => [
      ...prev,
      ...(currentCursor ? [currentCursor] : [""]),
    ]);
    setCurrentCursor(data.list.nextCursor);
  }, [data.list.nextCursor, currentCursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      const prevCursor = next.pop();
      setCurrentCursor(prevCursor === "" ? null : prevCursor ?? null);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setSearchValue("");
    setSelectedStatuses([]);
    setFavoritesOnly(false);
    setManagerFilter("all");
    setCursorStack([]);
    setCurrentCursor(null);
  }, []);

  const handleToggleFavoritesOnly = useCallback(() => {
    setFavoritesOnly((current) => !current);
  }, []);

  const handleManagerFilterChange = useCallback(
    (nextFilter: AffaireManagerQueueFilter) => {
      setManagerFilter(nextFilter);
      setCursorStack([]);
      setCurrentCursor(null);
    },
    []
  );

  const handleSortChange = useCallback(
    (key: string, direction?: "asc" | "desc") => {
      setSortState({ key, direction: direction ?? "desc" });
    },
    []
  );

  const handleSortToggle = useCallback(() => {
    setSortState((prev) =>
      prev
        ? { ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key: "updatedAt", direction: "desc" }
    );
  }, []);

  const handleToggleFavorite = useCallback(
    async (projectId: string, nextIsFavorite: boolean) => {
      if (favoritePendingIds.includes(projectId)) {
        return;
      }

      setFavoritePendingIds((current) => [...current, projectId]);
      setFavoriteOverrides((current) => ({
        ...current,
        [projectId]: nextIsFavorite,
      }));

      try {
        await toggleAffaireFavoriteAction({
          projectId,
          isFavorite: nextIsFavorite,
        });
        router.refresh();
      } catch (error) {
        setFavoriteOverrides((current) => {
          const next = { ...current };
          delete next[projectId];
          return next;
        });
        toast.error({
          title: "Favori non enregistre",
          description:
            error instanceof Error
              ? error.message
              : "Impossible de mettre a jour le favori.",
        });
      } finally {
        setFavoritePendingIds((current) =>
          current.filter((pendingId) => pendingId !== projectId)
        );
      }
    },
    [favoritePendingIds, router, toast]
  );

  const handleCreateAffaire = useCallback(() => {
    router.push("/dashboard/affaires/new");
  }, [router]);

  const handleToggleProjectSelection = useCallback((projectId: string) => {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((selectedId) => selectedId !== projectId)
        : [...current, projectId]
    );
  }, []);

  const visibleDraftIds = useMemo(
    () =>
      data.list.items
        .filter(isDraftSelectable)
        .map((item) => item.projectId),
    [data.list.items]
  );
  const allVisibleDraftsSelected =
    visibleDraftIds.length > 0 &&
    visibleDraftIds.every((projectId) =>
      selectedProjectIds.includes(projectId)
    );

  const handleToggleAllVisibleDrafts = useCallback(() => {
    setSelectedProjectIds((current) => {
      if (
        visibleDraftIds.length > 0 &&
        visibleDraftIds.every((projectId) => current.includes(projectId))
      ) {
        return current.filter(
          (projectId) => !visibleDraftIds.includes(projectId)
        );
      }
      return [...new Set([...current, ...visibleDraftIds])];
    });
  }, [visibleDraftIds]);

  const handleBulkDeleteCompleted = useCallback(
    (result: {
      deletedIds: string[];
      failures: Array<{ projectId: string }>;
    }) => {
      const deletedIds = new Set(result.deletedIds);
      setSelectedProjectIds((current) =>
        current.filter((projectId) => !deletedIds.has(projectId))
      );

      if (result.deletedIds.length > 0 && result.failures.length === 0) {
        toast.success({
          title: `${result.deletedIds.length} affaire${result.deletedIds.length > 1 ? "s" : ""} supprimee${result.deletedIds.length > 1 ? "s" : ""}`,
        });
      } else if (result.deletedIds.length > 0) {
        toast.warning({
          title: "Suppression partielle",
          description: `${result.deletedIds.length} affaire${result.deletedIds.length > 1 ? "s" : ""} supprimee${result.deletedIds.length > 1 ? "s" : ""}, ${result.failures.length} non supprimee${result.failures.length > 1 ? "s" : ""}. Les echecs restent selectionnes.`,
        });
      } else {
        toast.error({
          title: "Aucune affaire supprimee",
          description: `${result.failures.length} affaire${result.failures.length > 1 ? "s n'ont" : " n'a"} pas pu etre supprimee${result.failures.length > 1 ? "s" : ""}.`,
        });
      }

      router.refresh();
    },
    [router, toast]
  );
  const bulkDelete = useBulkDeleteAffaires({
    onCompleted: handleBulkDeleteCompleted,
  });

  // -- Computed --

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedStatuses.length > 0) count += selectedStatuses.length;
    if (favoritesOnly) count += 1;
    if (managerFilter !== "all") count += 1;
    return count;
  }, [favoritesOnly, managerFilter, selectedStatuses]);

  const hasPrevPage = cursorStack.length > 0;
  const hasNextPage = data.list.hasNextPage;
  const emptyVariant = data.counters.totalCount === 0 ? "no-data" : "filtered";

  return (
    <div className="animate-fade-in">
      <ConfirmModal {...bulkDelete.modalProps} />
      {/* Header */}
      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="page-title">Affaires</h1>
          <p className="page-description">
            Suivez vos affaires et leurs versions de chiffrage.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg w-full shrink-0 sm:w-auto"
          onClick={handleCreateAffaire}
        >
          + Nouvelle affaire
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSearch
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Rechercher par nom ou client..."
          isPending={isSearchPending}
        />
        <EstimateStatusChips
          counts={data.counters.statusCounts as Record<EstimateStatus, number>}
          selected={selectedStatuses as EstimateStatus[]}
          onChange={handleStatusChange}
        />
        <button
          type="button"
          onClick={handleToggleFavoritesOnly}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
            favoritesOnly
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-[var(--slate-200)] bg-white text-[var(--slate-600)] hover:border-[var(--slate-300)] hover:bg-[var(--slate-50)]"
          }`}
          aria-pressed={favoritesOnly}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill={favoritesOnly ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m12 17.27-5.18 3.05 1.4-5.89L3 9.76l6.03-.52L12 3.75l2.97 5.49 6.03.52-5.22 4.67 1.4 5.89z" />
          </svg>
          Favoris
        </button>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:items-center">
          <SortControl
            options={SORT_OPTIONS}
            value={sortState}
            onSortChange={handleSortChange}
            onDirectionToggle={handleSortToggle}
          />
        </div>
      </div>

      {/* Result count */}
      <ResultCount
        filteredCount={data.counters.filteredCount}
        totalCount={data.counters.totalCount}
        label="affaires"
        activeFilterCount={activeFilterCount}
        searchValue={searchValue}
        onClearAll={handleClearAll}
      />

      <div
        className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--slate-200)] bg-white px-3 py-2"
        aria-live="polite"
      >
        <span className="text-sm font-medium text-[var(--slate-700)]">
          {selectedProjectIds.length} affaire
          {selectedProjectIds.length > 1 ? "s" : ""} selectionnee
          {selectedProjectIds.length > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={visibleDraftIds.length === 0}
          aria-pressed={allVisibleDraftsSelected}
          onClick={handleToggleAllVisibleDrafts}
        >
          {allVisibleDraftsSelected ? "Retirer" : "Selectionner"} les brouillons
          affiches ({visibleDraftIds.length})
        </button>
        {selectedProjectIds.length > 0 ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedProjectIds([])}
            >
              Effacer la selection
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => bulkDelete.requestDelete(selectedProjectIds)}
            >
              Supprimer la selection ({selectedProjectIds.length})
            </button>
          </>
        ) : null}
      </div>

      {/* Content */}
      <div className="mt-4">
        {isExpert ? (
          <>
            <div className="xl:hidden">
              <AffairesCardList
                items={data.list.items}
                emptyVariant={emptyVariant}
                onCreateAffaire={handleCreateAffaire}
                onToggleFavorite={handleToggleFavorite}
                favoritePendingIds={favoritePendingIds}
                selectedProjectIds={selectedProjectIds}
                onToggleProjectSelection={handleToggleProjectSelection}
              />
            </div>
            <div className="hidden xl:block">
              <AffairesDenseTable
                items={data.list.items}
                emptyVariant={emptyVariant}
                onCreateAffaire={handleCreateAffaire}
                onToggleFavorite={handleToggleFavorite}
                favoritePendingIds={favoritePendingIds}
                managerFilter={managerFilter}
                onManagerFilterChange={handleManagerFilterChange}
                managerQueueSummary={managerQueueSummary}
                managerQueueSummaryState={managerQueueSummaryState}
                selectedProjectIds={selectedProjectIds}
                onToggleProjectSelection={handleToggleProjectSelection}
              />
            </div>
          </>
        ) : (
          <AffairesCardList
            items={data.list.items}
            emptyVariant={emptyVariant}
            onCreateAffaire={handleCreateAffaire}
            onToggleFavorite={handleToggleFavorite}
            favoritePendingIds={favoritePendingIds}
            selectedProjectIds={selectedProjectIds}
            onToggleProjectSelection={handleToggleProjectSelection}
          />
        )}
      </div>

      {/* Pagination */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--slate-500)]">
          <span>Afficher</span>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => handlePageSizeChange(size)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                pageSize === size
                  ? "bg-[var(--slate-900)] text-white"
                  : "bg-[var(--slate-100)] text-[var(--slate-600)] hover:bg-[var(--slate-200)]"
              }`}
            >
              {size}
            </button>
          ))}
          <span>par page</span>
        </div>

        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={!hasPrevPage}
            className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Precedent
          </button>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={!hasNextPage}
            className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Suivant
          </button>
        </div>
      </div>

    </div>
  );
}

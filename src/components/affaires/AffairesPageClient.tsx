"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useUiMode } from "@/hooks/useUiMode";
import { useIsWideViewport } from "@/hooks/useIsTablet";
import { JourneyPageHeader } from "@/components/journey/JourneyPage";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui-legacy/Toast";
import { cn } from "@/lib/utils";
import { toggleAffaireFavoriteAction } from "@/app/dashboard/affaires/_actions/favorites";
import { fetchAffaireManagerQueueSummaryAction } from "@/app/dashboard/affaires/_actions/manager-queue";
import { FilterSearch } from "@/components/TableFilterBar/FilterSearch";
import { SortControl } from "@/components/TableFilterBar/SortControl";
import { ResultCount } from "@/components/TableFilterBar/ResultCount";
import { EstimateStatusChips } from "@/components/estimates/EstimateStatusChips";
import { AffaireConfirmDialog } from "./AffaireConfirmDialog";
import { AffairesCardList } from "./AffairesCardList";
import { useBulkArchiveAffaires } from "./useBulkArchiveAffaires";
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
import { AFFAIRE_PAGE_SIZE_OPTIONS } from "@/lib/affaires/schemas";
import type { EstimateStatus } from "@/lib/estimates/client";
import { ArchiveIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, StarIcon, TrashIcon } from "lucide-react";

const AffairesDenseTable = dynamic(
  () =>
    import("./AffairesDenseTable").then((m) => ({
      default: m.AffairesDenseTable,
    })),
  { ssr: false }
);

// -- Constants --

const PAGE_SIZE_OPTIONS: readonly AffairePageSize[] =
  AFFAIRE_PAGE_SIZE_OPTIONS;
const DEFAULT_PAGE_SIZE: AffairePageSize = 20;
const PAGE_SIZE_STORAGE_KEY = "affaires-page-size";
const MANAGER_QUEUE_FETCH_TIMEOUT_MS = 8_000;
export const AFFAIRE_SEARCH_DEBOUNCE_MS = 250;

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
  const isWideViewport = useIsWideViewport();
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

    setSelectedProjectIds([]);

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
          title: "Favori non enregistré",
          description:
            error instanceof Error
              ? error.message
              : "Impossible de mettre à jour le favori.",
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
  const visibleDraftIdSet = useMemo(
    () => new Set(visibleDraftIds),
    [visibleDraftIds]
  );
  const selectedProjectIdSet = useMemo(
    () => new Set(selectedProjectIds),
    [selectedProjectIds]
  );
  const allVisibleDraftsSelected =
    visibleDraftIds.length > 0 &&
    visibleDraftIds.every((projectId) => selectedProjectIdSet.has(projectId));

  const handleToggleAllVisibleDrafts = useCallback(() => {
    setSelectedProjectIds((current) => {
      const currentSet = new Set(current);
      if (
        visibleDraftIds.length > 0 &&
        visibleDraftIds.every((projectId) => currentSet.has(projectId))
      ) {
        return current.filter((projectId) => !visibleDraftIdSet.has(projectId));
      }
      return [...new Set([...current, ...visibleDraftIds])];
    });
  }, [visibleDraftIds, visibleDraftIdSet]);

  const handleBulkArchiveCompleted = useCallback(
    (result: {
      archivedIds: string[];
      failures: Array<{ projectId: string }>;
    }) => {
      const archivedIds = new Set(result.archivedIds);
      setSelectedProjectIds((current) =>
        current.filter((projectId) => !archivedIds.has(projectId)),
      );

      if (result.archivedIds.length > 0 && result.failures.length === 0) {
        toast.success({
          title: `${result.archivedIds.length} affaire${result.archivedIds.length > 1 ? "s" : ""} archivée${result.archivedIds.length > 1 ? "s" : ""}`,
        });
      } else if (result.archivedIds.length > 0) {
        toast.warning({
          title: "Archivage partiel",
          description: `${result.archivedIds.length} affaire${result.archivedIds.length > 1 ? "s" : ""} archivée${result.archivedIds.length > 1 ? "s" : ""}, ${result.failures.length} non archivée${result.failures.length > 1 ? "s" : ""}. Les échecs restent sélectionnés.`,
        });
      } else {
        toast.error({
          title: "Aucune affaire archivée",
          description: `${result.failures.length} affaire${result.failures.length > 1 ? "s n'ont" : " n'a"} pas pu être archivée${result.failures.length > 1 ? "s" : ""}.`,
        });
      }

      router.refresh();
    },
    [router, toast],
  );
  const bulkArchive = useBulkArchiveAffaires({
    onCompleted: handleBulkArchiveCompleted,
  });

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
          title: `${result.deletedIds.length} affaire${result.deletedIds.length > 1 ? "s" : ""} supprimée${result.deletedIds.length > 1 ? "s" : ""}`,
        });
      } else if (result.deletedIds.length > 0) {
        toast.warning({
          title: "Suppression partielle",
          description: `${result.deletedIds.length} affaire${result.deletedIds.length > 1 ? "s" : ""} supprimée${result.deletedIds.length > 1 ? "s" : ""}, ${result.failures.length} non supprimée${result.failures.length > 1 ? "s" : ""}. Les échecs restent sélectionnés.`,
        });
      } else {
        toast.error({
          title: "Aucune affaire supprimée",
          description: `${result.failures.length} affaire${result.failures.length > 1 ? "s n'ont" : " n'a"} pas pu être supprimée${result.failures.length > 1 ? "s" : ""}.`,
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
  // A list that fits one default page needs no paging controls.
  const showPagination = hasPrevPage || hasNextPage || pageSize !== DEFAULT_PAGE_SIZE;
  const emptyVariant = data.counters.totalCount === 0 ? "no-data" : "filtered";

  const selectedCount = selectedProjectIds.length;
  const selectionLabel = `${selectedCount} affaire${selectedCount > 1 ? "s" : ""} sélectionnée${selectedCount > 1 ? "s" : ""}`;
  const hasSelection = selectedCount > 0;
  const selectDraftsRef = useRef<HTMLButtonElement>(null);
  const toolbarToggleRef = useRef<HTMLButtonElement>(null);
  const hadSelectionRef = useRef(hasSelection);
  // The quiet draft link and the toolbar replace each other: the focus moves to the one shown.
  useEffect(() => {
    if (hadSelectionRef.current === hasSelection) return;
    hadSelectionRef.current = hasSelection;
    if (document.activeElement && document.activeElement !== document.body) return;
    (hasSelection ? toolbarToggleRef : selectDraftsRef).current?.focus();
  }, [hasSelection]);

  return (
    <div className="animate-fade-in">
      <AffaireConfirmDialog {...bulkArchive.modalProps} />
      <AffaireConfirmDialog {...bulkDelete.modalProps} />
      <JourneyPageHeader
        title="Affaires"
        context="Suivez vos affaires et leurs versions de chiffrage."
        actions={
          <Link
            href="/dashboard/affaires/new"
            className={buttonVariants({ variant: "primary", size: "lg", className: "w-full sm:w-auto" })}
          >
            <PlusIcon aria-hidden="true" />
            Nouvelle affaire
          </Link>
        }
      />

      {/* Filter toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-64 sm:flex-1">
          <FilterSearch
            value={searchValue}
            onChange={setSearchValue}
            placeholder="Rechercher par nom ou client…"
            isPending={isSearchPending}
          />
        </div>
        <EstimateStatusChips
          counts={data.counters.statusCounts as Record<EstimateStatus, number>}
          selected={selectedStatuses as EstimateStatus[]}
          onChange={handleStatusChange}
        />
        <button
          type="button"
          onClick={handleToggleFavoritesOnly}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-0",
            favoritesOnly
              ? "border-warning bg-warning text-warning-foreground"
              : "border-border bg-surface text-foreground-secondary hover:border-border-strong hover:bg-surface-subtle"
          )}
          aria-pressed={favoritesOnly}
        >
          <StarIcon fill={favoritesOnly ? "currentColor" : "none"} aria-hidden="true" size={14} className={favoritesOnly ? undefined : "text-warning"} />
          Favoris
        </button>
        <SortControl
          options={SORT_OPTIONS}
          value={sortState}
          onSortChange={handleSortChange}
          onDirectionToggle={handleSortToggle}
        />
      </div>

      {/* Result count, with draft selection as a quiet action until something is selected */}
      <div className="journey-result-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ResultCount
          filteredCount={data.counters.filteredCount}
          totalCount={data.counters.totalCount}
          label="affaires"
          activeFilterCount={activeFilterCount}
          searchValue={searchValue}
          onClearAll={handleClearAll}
        />
        {!hasSelection && visibleDraftIds.length > 0 ? (
          <Button ref={selectDraftsRef} variant="link" size="sm" onClick={handleToggleAllVisibleDrafts}>
            Sélectionner les brouillons affichés ({visibleDraftIds.length})
          </Button>
        ) : null}
      </div>

      {/* Kept mounted so the selection count is announced when the toolbar appears. */}
      <span className="sr-only" aria-live="polite">
        {hasSelection ? selectionLabel : ""}
      </span>
      {hasSelection ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
          role="toolbar"
          aria-label="Actions groupées sur les brouillons"
        >
          <span className="mr-auto text-sm font-medium text-foreground-secondary">
            {selectionLabel}
          </span>
          <Button
            ref={toolbarToggleRef}
            variant="outline"
            size="md"
            disabled={visibleDraftIds.length === 0}
            aria-pressed={allVisibleDraftsSelected}
            onClick={handleToggleAllVisibleDrafts}
          >
            {allVisibleDraftsSelected ? "Retirer" : "Sélectionner"} les brouillons
            affichés ({visibleDraftIds.length})
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setSelectedProjectIds([])}
          >
            Tout désélectionner
          </Button>
          <Button
            variant="outline"
            size="md"
            leftIcon={<ArchiveIcon aria-hidden="true" />}
            onClick={() => bulkArchive.requestArchive(selectedProjectIds)}
          >
            Archiver
          </Button>
          <Button
            variant="danger"
            size="md"
            leftIcon={<TrashIcon aria-hidden="true" />}
            onClick={() => bulkDelete.requestDelete(selectedProjectIds)}
          >
            Supprimer
          </Button>
        </div>
      ) : null}

      {/* Content */}
      <div className="mt-4">
        {isExpert ? (
          <div className={isWideViewport ? undefined : "xl:hidden"}>
            {isWideViewport ? (
              <AffairesDenseTable
                items={data.list.items}
                emptyVariant={emptyVariant}
                onCreateAffaire={handleCreateAffaire}
                onToggleFavorite={handleToggleFavorite}
                favoritePendingIds={favoritePendingIds}
                selectedProjectIds={selectedProjectIdSet}
                onToggleProjectSelection={handleToggleProjectSelection}
                managerFilter={managerFilter}
                onManagerFilterChange={handleManagerFilterChange}
                managerQueueSummary={managerQueueSummary}
                managerQueueSummaryState={managerQueueSummaryState}
              />
            ) : (
              <AffairesCardList
                items={data.list.items}
                emptyVariant={emptyVariant}
                onCreateAffaire={handleCreateAffaire}
                onToggleFavorite={handleToggleFavorite}
                favoritePendingIds={favoritePendingIds}
                selectedProjectIds={selectedProjectIdSet}
                onToggleProjectSelection={handleToggleProjectSelection}
              />
            )}
          </div>
        ) : (
          <AffairesCardList
            items={data.list.items}
            emptyVariant={emptyVariant}
            onCreateAffaire={handleCreateAffaire}
            onToggleFavorite={handleToggleFavorite}
            favoritePendingIds={favoritePendingIds}
            selectedProjectIds={selectedProjectIdSet}
            onToggleProjectSelection={handleToggleProjectSelection}
          />
        )}
      </div>

      {/* Pagination */}
      {showPagination ? (
        <nav
          className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Pagination des affaires"
        >
          <div
            className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
            role="group"
            aria-label="Nombre d’affaires par page"
          >
            <span className="mr-1">Afficher</span>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <Button
                key={size}
                variant={pageSize === size ? "primary" : "ghost"}
                size="xs"
                className="min-w-9"
                aria-pressed={pageSize === size}
                onClick={() => handlePageSizeChange(size)}
              >
                {size}
              </Button>
            ))}
            <span className="ml-1">par page</span>
          </div>

          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <Button
              variant="outline"
              size="md"
              leftIcon={<ChevronLeftIcon aria-hidden="true" />}
              onClick={handlePrevPage}
              disabled={!hasPrevPage}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="md"
              rightIcon={<ChevronRightIcon aria-hidden="true" />}
              onClick={handleNextPage}
              disabled={!hasNextPage}
            >
              Suivant
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useUiMode } from "@/hooks/useUiMode";
import { useToast } from "@/components/ui/Toast";
import { toggleAffaireFavoriteAction } from "@/app/dashboard/affaires/_actions/favorites";
import { FilterSearch } from "@/components/TableFilterBar/FilterSearch";
import { SortControl } from "@/components/TableFilterBar/SortControl";
import { ResultCount } from "@/components/TableFilterBar/ResultCount";
import { EstimateStatusChips } from "@/components/estimates/EstimateStatusChips";
import { Badge } from "@/components/ui/Badge";
import { AffairesCardList } from "./AffairesCardList";
import type {
  AffairePageDataResult,
  AffairePageSize,
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

const SORT_OPTIONS: SortOption[] = [
  { key: "updatedAt", label: "Date MAJ", defaultDirection: "desc" },
];

const DISABLED_SORTS = [
  { key: "name", label: "Nom" },
  { key: "totalHtCents", label: "Montant" },
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

// -- Props --

type Props = {
  initialData: AffairePageDataResult;
  initialQ: string;
  initialStatuses: AffaireStatus[];
  initialFavoritesOnly: boolean;
  initialCursor: string | null;
  initialSize: AffairePageSize;
  initialDir: AffaireSortDirection;
};

export function AffairesPageClient({
  initialData,
  initialQ,
  initialStatuses,
  initialFavoritesOnly,
  initialCursor,
  initialSize,
  initialDir,
}: Readonly<Props>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isExpert } = useUiMode();
  const toast = useToast();

  // -- State --

  const [searchValue, setSearchValue] = useState(initialQ);
  const deferredSearch = useDeferredValue(searchValue);
  const isSearchPending = searchValue !== deferredSearch;

  const [selectedStatuses, setSelectedStatuses] =
    useState<AffaireStatus[]>(initialStatuses);
  const [favoritesOnly, setFavoritesOnly] = useState(initialFavoritesOnly);

  const [pageSize, setPageSize] = useState<AffairePageSize>(initialSize);
  const [cursorStack, setCursorStack] = useState<string[]>(
    initialCursor ? [] : []
  );
  const [currentCursor, setCurrentCursor] = useState<string | null>(
    initialCursor
  );

  const [sortState, setSortState] = useState<SortState>({
    key: "updatedAt",
    direction: initialDir,
  });
  const [favoriteOverrides, setFavoriteOverrides] = useState<
    Record<string, boolean>
  >({});
  const [favoritePendingIds, setFavoritePendingIds] = useState<string[]>([]);

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
    setFavoritesOnly(initialFavoritesOnly);
  }, [initialFavoritesOnly]);

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

  const prevSearchRef = useRef(deferredSearch);
  const prevStatusRef = useRef(selectedStatuses);
  const prevFavoritesRef = useRef(favoritesOnly);
  const prevSortRef = useRef(sortState);
  const prevSizeRef = useRef(pageSize);
  const prevCursorRef = useRef(currentCursor);

  useEffect(() => {
    const searchChanged = prevSearchRef.current !== deferredSearch;
    const statusChanged = prevStatusRef.current !== selectedStatuses;
    const favoritesChanged = prevFavoritesRef.current !== favoritesOnly;
    const sortChanged = prevSortRef.current !== sortState;
    const sizeChanged = prevSizeRef.current !== pageSize;
    const cursorChanged = prevCursorRef.current !== currentCursor;

    prevSearchRef.current = deferredSearch;
    prevStatusRef.current = selectedStatuses;
    prevFavoritesRef.current = favoritesOnly;
    prevSortRef.current = sortState;
    prevSizeRef.current = pageSize;
    prevCursorRef.current = currentCursor;

    if (
      !searchChanged &&
      !statusChanged &&
      !favoritesChanged &&
      !sortChanged &&
      !sizeChanged &&
      !cursorChanged
    ) {
      return;
    }

    // Reset cursor when filters change
    if (searchChanged || statusChanged || favoritesChanged || sizeChanged) {
      setCursorStack([]);
      setCurrentCursor(null);
    }

    const params = new URLSearchParams();
    if (deferredSearch) params.set("q", deferredSearch);
    if (selectedStatuses.length > 0)
      params.set("status", selectedStatuses.join(","));
    if (favoritesOnly) params.set("favorites", "1");
    if (sortState && sortState.direction !== "desc")
      params.set("dir", sortState.direction);
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(pageSize));

    // Only set cursor if not resetting
    const effectiveCursor =
      searchChanged || statusChanged || favoritesChanged || sizeChanged
        ? null
        : currentCursor;
    if (effectiveCursor) params.set("cursor", effectiveCursor);

    const qs = params.toString();
    const currentQs = searchParams.toString();
    if (qs === currentQs) return;

    const newPath = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newPath, { scroll: false });
  }, [
    deferredSearch,
    selectedStatuses,
    favoritesOnly,
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
    setCursorStack([]);
    setCurrentCursor(null);
  }, []);

  const handleToggleFavoritesOnly = useCallback(() => {
    setFavoritesOnly((current) => !current);
  }, []);

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

  // -- Computed --

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedStatuses.length > 0) count += selectedStatuses.length;
    if (favoritesOnly) count += 1;
    return count;
  }, [favoritesOnly, selectedStatuses]);

  const hasPrevPage = cursorStack.length > 0;
  const hasNextPage = data.list.hasNextPage;
  const emptyVariant = data.counters.totalCount === 0 ? "no-data" : "filtered";

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Affaires</h1>
          <p className="page-description">
            Suivez vos affaires et leurs versions de chiffrage.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg shrink-0"
          onClick={handleCreateAffaire}
        >
          + Nouvelle affaire
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3 mt-6 mb-4">
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
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
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
        <div className="flex items-center gap-2">
          <SortControl
            options={SORT_OPTIONS}
            value={sortState}
            onSortChange={handleSortChange}
            onDirectionToggle={handleSortToggle}
          />
          {DISABLED_SORTS.map((s) => (
            <span
              key={s.key}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[var(--slate-400)] bg-[var(--slate-50)] cursor-not-allowed"
              title="Tri a venir"
            >
              {s.label}
              <Badge variant="neutral" size="sm">
                a venir
              </Badge>
            </span>
          ))}
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

      {/* Content */}
      <div className="mt-4">
        {isExpert ? (
          <AffairesDenseTable
            items={data.list.items}
            emptyVariant={emptyVariant}
            onCreateAffaire={handleCreateAffaire}
            onToggleFavorite={handleToggleFavorite}
            favoritePendingIds={favoritePendingIds}
          />
        ) : (
          <AffairesCardList
            items={data.list.items}
            emptyVariant={emptyVariant}
            onCreateAffaire={handleCreateAffaire}
            onToggleFavorite={handleToggleFavorite}
            favoritePendingIds={favoritePendingIds}
          />
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-6">
        <div className="flex items-center gap-2 text-sm text-[var(--slate-500)]">
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

        <div className="flex items-center gap-2">
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

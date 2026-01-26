"use client";

type ResultCountProps = {
  filteredCount: number;
  totalCount: number;
  label?: string;
  activeFilterCount: number;
  searchValue: string;
  onClearAll: () => void;
};

export function ResultCount({
  filteredCount,
  totalCount,
  label = "resultats",
  activeFilterCount,
  searchValue,
  onClearAll,
}: ResultCountProps) {
  const hasFilters = activeFilterCount > 0 || searchValue.length > 0;
  const isFiltered = filteredCount !== totalCount;

  return (
    <div className="table-filter-bar__status" role="status" aria-live="polite" aria-atomic="true">
      <div className="table-filter-bar__count">
        {isFiltered ? (
          <>
            Affichage de <strong>{filteredCount}</strong> sur{" "}
            <strong>{totalCount}</strong> {label}
          </>
        ) : (
          <>
            <strong>{totalCount}</strong> {label}
          </>
        )}
      </div>

      {hasFilters && (
        <button
          type="button"
          className="table-filter-bar__clear"
          onClick={onClearAll}
          aria-label="Effacer tous les filtres"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          Effacer les filtres
          {activeFilterCount > 0 && (
            <span className="table-filter-bar__clear-count">({activeFilterCount})</span>
          )}
        </button>
      )}
    </div>
  );
}

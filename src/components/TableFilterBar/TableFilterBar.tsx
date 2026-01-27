"use client";

import { useCallback } from "react";
import { FilterDateRange } from "./FilterDateRange";
import { FilterPill } from "./FilterPill";
import { FilterSearch } from "./FilterSearch";
import { ResultCount } from "./ResultCount";
import { SortControl } from "./SortControl";
import type { DateRangeValue, TableFilterBarProps } from "./types";
import { useTableFilter } from "./useTableFilter";

export function TableFilterBar<T extends Record<string, unknown>>({
  data,
  onDataChange,
  search,
  filters,
  sortOptions,
  showResultCount = true,
  resultCountLabel = "resultats",
  defaultSort,
}: TableFilterBarProps<T>) {
  const {
    filteredCount,
    totalCount,
    searchValue,
    setSearchValue,
    isSearchPending,
    filterState,
    setFilter,
    clearFilter,
    clearAllFilters,
    activeFilterCount,
    sortState,
    setSort,
    toggleSortDirection,
  } = useTableFilter({
    data,
    searchConfig: search,
    filters,
    sortOptions,
    defaultSort,
    onDataChange,
  });

  const hasFilters = filters && filters.length > 0;
  const hasSort = sortOptions && sortOptions.length > 0;

  // Memoized handlers for filter changes
  const handleFilterChange = useCallback(
    (key: string, value: string | string[] | DateRangeValue) => {
      setFilter(key, value);
    },
    [setFilter]
  );

  const handleClearFilter = useCallback(
    (key: string) => {
      clearFilter(key);
    },
    [clearFilter]
  );

  return (
    <div className={`table-filter-bar ${hasFilters ? "table-filter-bar--has-filters" : ""}`}>
      {/* Primary row: Search + Sort */}
      <div className="table-filter-bar__primary">
        {search && (
          <FilterSearch
            value={searchValue}
            onChange={setSearchValue}
            placeholder={search.placeholder}
            isPending={isSearchPending}
          />
        )}

        {hasSort && (
          <SortControl
            options={sortOptions}
            value={sortState}
            onSortChange={setSort}
            onDirectionToggle={toggleSortDirection}
          />
        )}
      </div>

      {/* Filter pills row */}
        {hasFilters && (
          <div className="table-filter-bar__filters">
            {filters.map((filterConfig) => {
              if (filterConfig.type === "date-range") {
                return (
                  <FilterDateRange
                    key={filterConfig.key}
                    config={filterConfig}
                  value={(filterState[filterConfig.key] as DateRangeValue) ?? { from: "", to: "" }}
                  onChange={(value) => handleFilterChange(filterConfig.key, value)}
                  onClear={() => handleClearFilter(filterConfig.key)}
                />
              );
            }

            return (
              <FilterPill
                key={filterConfig.key}
                config={filterConfig}
                value={filterState[filterConfig.key] as string | string[]}
                onChange={(value) => handleFilterChange(filterConfig.key, value)}
                onClear={() => handleClearFilter(filterConfig.key)}
              />
            );
          })}
        </div>
      )}

      {/* Result count bar */}
      {showResultCount && (
        <ResultCount
          filteredCount={filteredCount}
          totalCount={totalCount}
          label={resultCountLabel}
          activeFilterCount={activeFilterCount}
          searchValue={searchValue}
          onClearAll={clearAllFilters}
        />
      )}
    </div>
  );
}

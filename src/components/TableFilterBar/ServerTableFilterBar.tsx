"use client";

import { FilterDateRange } from "./FilterDateRange";
import { FilterPill } from "./FilterPill";
import { FilterSearch } from "./FilterSearch";
import { ResultCount } from "./ResultCount";
import { SortControl } from "./SortControl";
import type {
  DateRangeValue,
  FilterConfig,
  FilterState,
  FilterValue,
  SortDirection,
  SortOption,
  SortState,
} from "./types";

type ServerTableFilterBarProps = {
  searchValue: string;
  searchPlaceholder: string;
  filterState: FilterState;
  filters?: FilterConfig[];
  sortOptions?: SortOption[];
  sortState: SortState;
  filteredCount: number;
  totalCount: number;
  resultCountLabel: string;
  compact?: boolean;
  isPending?: boolean;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string, value: FilterValue) => void;
  onSortChange: (key: string, direction?: SortDirection) => void;
  onClearAll: () => void;
};

function hasFilterValue(value: FilterValue | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  return Boolean(value?.from || value?.to);
}

export function ServerTableFilterBar({
  searchValue,
  searchPlaceholder,
  filterState,
  filters = [],
  sortOptions = [],
  sortState,
  filteredCount,
  totalCount,
  resultCountLabel,
  compact = false,
  isPending = false,
  onSearchChange,
  onFilterChange,
  onSortChange,
  onClearAll,
}: Readonly<ServerTableFilterBarProps>) {
  const activeFilterCount = filters.reduce(
    (count, filter) => count + (hasFilterValue(filterState[filter.key]) ? 1 : 0),
    0
  );

  return (
    <div
      className={`table-filter-bar ${filters.length > 0 ? "table-filter-bar--has-filters" : ""} ${compact ? "table-filter-bar--compact" : ""}`}
    >
      <div className="table-filter-bar__primary">
        <FilterSearch
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          isPending={isPending}
        />

        {sortOptions.length > 0 ? (
          <SortControl
            options={sortOptions}
            value={sortState}
            onSortChange={onSortChange}
            onDirectionToggle={() => {
              if (!sortState) return;
              onSortChange(sortState.key, sortState.direction === "asc" ? "desc" : "asc");
            }}
          />
        ) : null}
      </div>

      {filters.length > 0 ? (
        <div className="table-filter-bar__filters">
          {filters.map((filter) => {
            const value = filterState[filter.key];
            if (filter.type === "date-range") {
              return (
                <FilterDateRange
                  key={filter.key}
                  config={filter}
                  value={(value as DateRangeValue | undefined) ?? { from: "", to: "" }}
                  onChange={(nextValue) => onFilterChange(filter.key, nextValue)}
                  onClear={() => onFilterChange(filter.key, { from: "", to: "" })}
                />
              );
            }

            return (
              <FilterPill
                key={filter.key}
                config={filter}
                value={(value as string | string[] | undefined) ?? (filter.type === "multi-select" ? [] : "")}
                onChange={(nextValue) => onFilterChange(filter.key, nextValue)}
                onClear={() => onFilterChange(filter.key, filter.type === "multi-select" ? [] : "")}
              />
            );
          })}
        </div>
      ) : null}

      <ResultCount
        filteredCount={filteredCount}
        totalCount={totalCount}
        label={resultCountLabel}
        activeFilterCount={activeFilterCount}
        searchValue={searchValue}
        onClearAll={onClearAll}
      />
    </div>
  );
}

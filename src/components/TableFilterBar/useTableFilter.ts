import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  DateRangeValue,
  FilterConfig,
  FilterState,
  FilterValue,
  SearchConfig,
  SortDirection,
  SortOption,
  SortState,
  UseTableFilterReturn,
} from "./types";

// Get nested value from object using dot notation (e.g., "suppliers.name")
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;

    // Handle arrays (take first element)
    if (Array.isArray(current)) {
      current = current[0];
      if (current === null || current === undefined) return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

// Normalize French text for accent-insensitive search
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Check if a date range value has any value set
function isDateRangeEmpty(value: DateRangeValue): boolean {
  return !value.from && !value.to;
}

type UseTableFilterOptions<T> = {
  data: T[];
  searchConfig?: SearchConfig;
  filters?: FilterConfig[];
  sortOptions?: SortOption[];
  defaultSort?: SortState;
  onDataChange?: (filteredData: T[]) => void;
};

function areArraysShallowEqual<T>(left: T[], right: T[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (!Object.is(left[i], right[i])) return false;
  }
  return true;
}

export function useTableFilter<T extends Record<string, unknown>>(
  options: UseTableFilterOptions<T>
): UseTableFilterReturn<T> {
  const { data, searchConfig, filters, sortOptions, defaultSort, onDataChange } = options;

  // Search state with deferred value for performance
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const isSearchPending = searchInput !== deferredSearch;

  // Filter state
  const [filterState, setFilterState] = useState<FilterState>(() => {
    const initial: FilterState = {};
    filters?.forEach((f) => {
      if (f.type === "date-range") {
        initial[f.key] = { from: "", to: "" };
      } else if (f.type === "multi-select") {
        initial[f.key] = [];
      } else {
        initial[f.key] = "";
      }
    });
    return initial;
  });

  // Sort state
  const [sortState, setSortState] = useState<SortState>(() => {
    if (defaultSort) return defaultSort;
    if (sortOptions && sortOptions.length > 0) {
      const first = sortOptions[0];
      return { key: first.key, direction: first.defaultDirection ?? "asc" };
    }
    return null;
  });

  const searchFieldsKey = searchConfig?.fields?.join("|") ?? "";

  // Filter the data
  const filteredData = useMemo(() => {
    let result = [...data];
    const searchFields = searchFieldsKey ? searchFieldsKey.split("|") : [];

    // 1. Apply search
    if (deferredSearch && searchFields.length > 0) {
      const searchNormalized = normalizeText(deferredSearch);
      result = result.filter((item) =>
        searchFields.some((field) => {
          const value = getNestedValue(item, field);
          if (value === null || value === undefined) return false;
          return normalizeText(String(value)).includes(searchNormalized);
        })
      );
    }

    // 2. Apply filters
    for (const [key, value] of Object.entries(filterState)) {
      const filterConfig = filters?.find((f) => f.key === key);
      if (!filterConfig) continue;

      if (filterConfig.type === "select") {
        if (!value || value === "") continue;
        result = result.filter((item) => {
          const itemValue = getNestedValue(item, key);
          return String(itemValue) === value;
        });
      } else if (filterConfig.type === "multi-select") {
        const values = value as string[];
        if (values.length === 0) continue;
        result = result.filter((item) => {
          const itemValue = getNestedValue(item, key);
          return values.includes(String(itemValue));
        });
      } else if (filterConfig.type === "date-range") {
        const { from, to } = value as DateRangeValue;
        if (!from && !to) continue;
        result = result.filter((item) => {
          const dateValue = getNestedValue(item, key);
          if (!dateValue) return false;
          const date = new Date(dateValue as string);
          if (from && date < new Date(from)) return false;
          if (to && date > new Date(to + "T23:59:59")) return false;
          return true;
        });
      }
    }

    // 3. Apply sort
    if (sortState) {
      const { key, direction } = sortState;
      result.sort((a, b) => {
        const aVal = getNestedValue(a, key);
        const bVal = getNestedValue(b, key);

        // Handle null/undefined
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return direction === "asc" ? 1 : -1;
        if (bVal == null) return direction === "asc" ? -1 : 1;

        // Compare values
        let comparison: number;
        if (typeof aVal === "string" && typeof bVal === "string") {
          comparison = aVal.localeCompare(bVal, "fr");
        } else if (typeof aVal === "number" && typeof bVal === "number") {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal), "fr");
        }

        return direction === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [data, deferredSearch, searchFieldsKey, filterState, filters, sortState]);

  // Notify parent of data changes
  const onDataChangeRef = useRef(onDataChange);
  const lastNotifiedDataRef = useRef<T[] | null>(null);

  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  useEffect(() => {
    const handler = onDataChangeRef.current;
    if (!handler) return;

    const lastNotified = lastNotifiedDataRef.current;
    if (lastNotified && areArraysShallowEqual(lastNotified, filteredData)) {
      return;
    }

    lastNotifiedDataRef.current = filteredData;
    handler(filteredData);
  }, [filteredData]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const [key, value] of Object.entries(filterState)) {
      const filterConfig = filters?.find((f) => f.key === key);
      if (!filterConfig) continue;

      if (filterConfig.type === "select" && value && value !== "") {
        count++;
      } else if (filterConfig.type === "multi-select" && (value as string[]).length > 0) {
        count++;
      } else if (filterConfig.type === "date-range" && !isDateRangeEmpty(value as DateRangeValue)) {
        count++;
      }
    }
    return count;
  }, [filterState, filters]);

  // Actions
  const setFilter = (key: string, value: FilterValue) => {
    setFilterState((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilter = (key: string) => {
    const filterConfig = filters?.find((f) => f.key === key);
    if (!filterConfig) return;

    setFilterState((prev) => {
      const next = { ...prev };
      if (filterConfig.type === "date-range") {
        next[key] = { from: "", to: "" };
      } else if (filterConfig.type === "multi-select") {
        next[key] = [];
      } else {
        next[key] = "";
      }
      return next;
    });
  };

  const clearAllFilters = () => {
    setSearchInput("");
    const reset: FilterState = {};
    filters?.forEach((f) => {
      if (f.type === "date-range") {
        reset[f.key] = { from: "", to: "" };
      } else if (f.type === "multi-select") {
        reset[f.key] = [];
      } else {
        reset[f.key] = "";
      }
    });
    setFilterState(reset);
  };

  const setSort = (key: string, direction?: SortDirection) => {
    const sortOption = sortOptions?.find((s) => s.key === key);
    const dir = direction ?? sortOption?.defaultDirection ?? "asc";
    setSortState({ key, direction: dir });
  };

  const toggleSortDirection = () => {
    if (!sortState) return;
    setSortState({
      ...sortState,
      direction: sortState.direction === "asc" ? "desc" : "asc",
    });
  };

  return {
    // Output
    filteredData,
    totalCount: data.length,
    filteredCount: filteredData.length,

    // Search
    searchValue: searchInput,
    setSearchValue: setSearchInput,
    isSearchPending,

    // Filters
    filterState,
    setFilter,
    clearFilter,
    clearAllFilters,
    activeFilterCount,

    // Sort
    sortState,
    setSort,
    toggleSortDirection,
  };
}

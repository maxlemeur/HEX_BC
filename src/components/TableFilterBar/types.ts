// Sort configuration
export type SortDirection = "asc" | "desc";

export type SortOption = {
  key: string;
  label: string;
  defaultDirection?: SortDirection;
};

export type SortState = {
  key: string;
  direction: SortDirection;
} | null;

// Filter configuration
export type FilterOption = {
  value: string;
  label: string;
};

export type SelectFilterConfig = {
  type: "select";
  key: string;
  label: string;
  placeholder: string;
  options: FilterOption[];
};

export type MultiSelectFilterConfig = {
  type: "multi-select";
  key: string;
  label: string;
  placeholder: string;
  options: FilterOption[];
};

export type DateRangeFilterConfig = {
  type: "date-range";
  key: string;
  label: string;
  placeholderFrom?: string;
  placeholderTo?: string;
};

export type FilterConfig =
  | SelectFilterConfig
  | MultiSelectFilterConfig
  | DateRangeFilterConfig;

export type DateRangeValue = {
  from: string;
  to: string;
};

export type FilterValue = string | string[] | DateRangeValue;

export type FilterState = Record<string, FilterValue>;

// Search configuration
export type SearchConfig = {
  placeholder: string;
  fields: string[];
};

// Main component props
export type TableFilterBarProps<T extends Record<string, unknown>> = {
  // Data
  data: T[];
  onDataChange: (filteredData: T[]) => void;

  // Configuration
  search?: SearchConfig;
  filters?: FilterConfig[];
  sortOptions?: SortOption[];

  // Display
  showResultCount?: boolean;
  resultCountLabel?: string;

  // Initial state
  defaultSort?: SortState;
};

// Hook return type
export type UseTableFilterReturn<T> = {
  // Filtered output
  filteredData: T[];
  totalCount: number;
  filteredCount: number;

  // Search state
  searchValue: string;
  setSearchValue: (value: string) => void;
  isSearchPending: boolean;

  // Filter state
  filterState: FilterState;
  setFilter: (key: string, value: FilterValue) => void;
  clearFilter: (key: string) => void;
  clearAllFilters: () => void;
  activeFilterCount: number;

  // Sort state
  sortState: SortState;
  setSort: (key: string, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
};

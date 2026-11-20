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

export type SearchConfig = {
  placeholder: string;
  fields: string[];
};

export type TableFilterBarProps<T extends Record<string, unknown>> = {
  data: T[];
  onDataChange: (filteredData: T[]) => void;

  search?: SearchConfig;
  filters?: FilterConfig[];
  sortOptions?: SortOption[];

  showResultCount?: boolean;
  resultCountLabel?: string;

  defaultSort?: SortState;
};

export type UseTableFilterReturn<T> = {
  filteredData: T[];
  totalCount: number;
  filteredCount: number;

  searchValue: string;
  setSearchValue: (value: string) => void;
  isSearchPending: boolean;

  filterState: FilterState;
  setFilter: (key: string, value: FilterValue) => void;
  clearFilter: (key: string) => void;
  clearAllFilters: () => void;
  activeFilterCount: number;

  sortState: SortState;
  setSort: (key: string, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
};

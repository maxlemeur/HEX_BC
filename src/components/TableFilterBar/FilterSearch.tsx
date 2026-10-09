"use client";

import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";

type FilterSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isPending?: boolean;
};

export function FilterSearch({
  value,
  onChange,
  placeholder = "Rechercher…",
  isPending = false,
}: FilterSearchProps) {
  return (
    <div className="table-filter-bar__search" role="search">
      <div className="table-filter-bar__search-icon">
        {isPending ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" size={20} />
        ) : (
          <SearchIcon aria-hidden="true" size={20} />
        )}
      </div>
      <input
        type="search"
        className="table-filter-bar__search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="table-filter-bar__search-clear"
          onClick={() => onChange("")}
          aria-label="Effacer la recherche"
        >
          <XIcon aria-hidden="true" size={16} />
        </button>
      )}
    </div>
  );
}

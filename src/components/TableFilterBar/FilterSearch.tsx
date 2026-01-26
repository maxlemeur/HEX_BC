"use client";

type FilterSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isPending?: boolean;
};

export function FilterSearch({
  value,
  onChange,
  placeholder = "Rechercher...",
  isPending = false,
}: FilterSearchProps) {
  return (
    <div className="table-filter-bar__search" role="search">
      <div className="table-filter-bar__search-icon">
        {isPending ? (
          <svg
            className="animate-spin"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
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
          <svg
            width="16"
            height="16"
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
        </button>
      )}
    </div>
  );
}

"use client";

import {
  IMPORT_HISTORY_STATUS_TABS,
  type StatusFilter,
} from "@/components/imports/importWizardHistory";

type ImportHistoryFiltersProps = {
  historySearch: string;
  onHistorySearchChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  statusFilter: StatusFilter;
};

export function ImportHistoryFilters({
  historySearch,
  onHistorySearchChange,
  onStatusFilterChange,
  statusFilter,
}: ImportHistoryFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--slate-200)] px-6 py-3">
      <div className="flex gap-1">
        {IMPORT_HISTORY_STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onStatusFilterChange(tab.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-[var(--brand-blue)] text-white"
                : "bg-[var(--slate-100)] text-[var(--slate-600)] hover:bg-[var(--slate-200)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <input
        className="form-input form-input--sm max-w-[200px]"
        placeholder="Rechercher par nom..."
        value={historySearch}
        onChange={(event) => onHistorySearchChange(event.target.value)}
      />
    </div>
  );
}

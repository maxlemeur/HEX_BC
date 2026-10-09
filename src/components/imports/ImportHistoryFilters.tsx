"use client";

import {
  IMPORT_HISTORY_STATUS_TABS,
  type StatusFilter,
} from "@/components/imports/importWizardHistory";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
      <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-1">
        {IMPORT_HISTORY_STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={statusFilter === tab.key}
            onClick={() => onStatusFilterChange(tab.key)}
            className={cn(
              "min-h-8 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              statusFilter === tab.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground-secondary hover:bg-surface-subtle hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Input
        size="sm"
        type="search"
        aria-label="Rechercher un import par nom"
        className="max-w-52"
        placeholder="Rechercher par nom…"
        value={historySearch}
        onChange={(event) => onHistorySearchChange(event.target.value)}
      />
    </div>
  );
}

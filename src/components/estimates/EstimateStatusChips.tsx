"use client";

import type { EstimateStatus } from "@/lib/estimates/client";
import { cn } from "@/lib/utils";

type EstimateStatusChipsProps = {
  counts: Record<EstimateStatus, number>;
  selected: EstimateStatus[];
  onChange: (selected: EstimateStatus[]) => void;
};

const CHIPS: { status: EstimateStatus; label: string; dot: string }[] = [
  { status: "draft", label: "Brouillon", dot: "bg-subtle-foreground" },
  { status: "sending", label: "Envoi en cours", dot: "bg-warning" },
  { status: "sent", label: "Envoyé", dot: "bg-info" },
  { status: "accepted", label: "Accepté", dot: "bg-success" },
  { status: "archived", label: "Archivé", dot: "bg-border-strong" },
];

export function EstimateStatusChips({ counts, selected, onChange }: EstimateStatusChipsProps) {
  const toggle = (status: EstimateStatus) => {
    if (selected.includes(status)) {
      onChange(selected.filter((s) => s !== status));
    } else {
      onChange([...selected, status]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
      {CHIPS.map(({ status, label, dot }) => {
        const isActive = selected.includes(status);
        const count = counts[status] ?? 0;

        return (
          <button
            key={status}
            type="button"
            onClick={() => toggle(status)}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-0",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-foreground-secondary hover:border-border-strong hover:bg-surface-subtle"
            )}
            aria-pressed={isActive}
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", isActive ? "bg-primary-foreground" : dot)}
            />
            {label}
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-micro font-bold leading-none tabular-nums",
                isActive ? "bg-white/20" : "bg-muted text-foreground-secondary"
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

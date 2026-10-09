"use client";

import type { TakeoffLevel, TakeoffMetricsPeriod } from "@/lib/takeoff/types";
import { TAKEOFF_METRICS_PERIODS } from "@/lib/takeoff/types";

const PERIOD_LABELS: Record<TakeoffMetricsPeriod, string> = {
  "7d": "7j",
  "30d": "30j",
  "90d": "90j",
};

const LEVEL_FILTER_OPTIONS: Array<{ value: "all" | TakeoffLevel; label: string }> = [
  { value: "all", label: "Tous niveaux" },
  { value: "A", label: "Niveau A" },
  { value: "B", label: "Niveau B" },
  { value: "C", label: "Niveau C" },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: TakeoffMetricsPeriod;
  onChange: (period: TakeoffMetricsPeriod) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-muted p-1">
      {TAKEOFF_METRICS_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            value === period
              ? "bg-surface text-slate-800 shadow-sm"
              : "text-muted-foreground hover:text-foreground-secondary"
          }`}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  );
}

export function LevelSelector({
  value,
  onChange,
}: {
  value: "all" | TakeoffLevel;
  onChange: (value: "all" | TakeoffLevel) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
      Niveau
      <select
        className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs font-medium text-foreground-secondary"
        value={value}
        onChange={(event) => onChange(event.target.value as "all" | TakeoffLevel)}
      >
        {LEVEL_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

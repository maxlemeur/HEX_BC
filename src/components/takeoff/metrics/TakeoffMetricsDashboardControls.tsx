"use client";

import type { TakeoffLevel, TakeoffMetricsPeriod } from "@/lib/takeoff/types";
import { TAKEOFF_METRICS_PERIODS } from "@/lib/takeoff/types";
import { NativeSelect } from "@/components/ui/native-select";

const PERIOD_LABELS: Record<TakeoffMetricsPeriod, { short: string; long: string }> = {
  "7d": { short: "7j", long: "7 jours" },
  "30d": { short: "30j", long: "30 jours" },
  "90d": { short: "90j", long: "90 jours" },
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
    <div role="group" aria-label="Période" className="inline-flex gap-1 rounded-full bg-muted p-1">
      {TAKEOFF_METRICS_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          aria-pressed={value === period}
          aria-label={PERIOD_LABELS[period].long}
          className={`min-h-8 rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
            value === period
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground-secondary"
          }`}
        >
          {PERIOD_LABELS[period].short}
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
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      Niveau
      <NativeSelect
        size="sm"
        wrapperClassName="w-auto"
        className="text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value as "all" | TakeoffLevel)}
      >
        {LEVEL_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

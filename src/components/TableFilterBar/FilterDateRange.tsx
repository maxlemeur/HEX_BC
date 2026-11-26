"use client";

import { useId, useState } from "react";
import { ArrowRightIcon, CalendarIcon, ChevronDownIcon, XIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRangeFilterConfig, DateRangeValue } from "./types";

type FilterDateRangeProps = {
  config: DateRangeFilterConfig;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  onClear: () => void;
};

function getPresetDates(preset: "week" | "month" | "30days"): DateRangeValue {
  const today = new Date();
  const toDate = today.toISOString().split("T")[0];

  let fromDate: string;
  if (preset === "week") {
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    fromDate = weekAgo.toISOString().split("T")[0];
  } else if (preset === "month") {
    const monthAgo = new Date(today);
    monthAgo.setMonth(today.getMonth() - 1);
    fromDate = monthAgo.toISOString().split("T")[0];
  } else {
    const daysAgo = new Date(today);
    daysAgo.setDate(today.getDate() - 30);
    fromDate = daysAgo.toISOString().split("T")[0];
  }

  return { from: fromDate, to: toDate };
}

export function FilterDateRange({ config, value, onChange, onClear }: FilterDateRangeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const baseId = useId();
  const fromId = `${baseId}-from`;
  const toId = `${baseId}-to`;

  const hasValue = value.from || value.to;

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  const getDisplayLabel = () => {
    if (!hasValue) return config.label;
    if (value.from && value.to) {
      return `${formatDisplayDate(value.from)} - ${formatDisplayDate(value.to)}`;
    }
    if (value.from) return `Depuis ${formatDisplayDate(value.from)}`;
    if (value.to) return `Jusqu'au ${formatDisplayDate(value.to)}`;
    return config.label;
  };

  const handlePreset = (preset: "week" | "month" | "30days") => {
    onChange(getPresetDates(preset));
  };

  const presetButtonClass =
    "flex-1 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-medium text-foreground-secondary transition-colors hover:border-primary hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const dateInputClass =
    "h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-foreground transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="filter-pill-container">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          className={`filter-pill ${hasValue ? "filter-pill--active" : ""}`}
          aria-label={`Filtrer par ${config.label}${hasValue ? ", filtre actif" : ""}`}
        >
          <CalendarIcon aria-hidden="true" className="filter-pill__icon" size={14} />
          <span className="filter-pill__label">{getDisplayLabel()}</span>
          <ChevronDownIcon aria-hidden="true" className="filter-pill__chevron" size={14} />
        </PopoverTrigger>

        <PopoverContent
          align="start"
          aria-label={config.label}
          className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-3"
        >
          <div className="flex gap-2">
            <button
              type="button"
              className={presetButtonClass}
              onClick={() => handlePreset("week")}
            >
              Cette semaine
            </button>
            <button
              type="button"
              className={presetButtonClass}
              onClick={() => handlePreset("month")}
            >
              Ce mois
            </button>
            <button
              type="button"
              className={presetButtonClass}
              onClick={() => handlePreset("30days")}
            >
              30 derniers jours
            </button>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label
                htmlFor={fromId}
                className="mb-1.5 block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
              >
                {config.placeholderFrom ?? "Du"}
              </label>
              <input
                id={fromId}
                type="date"
                className={dateInputClass}
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
              />
            </div>
            <div className="pb-2.5 text-subtle-foreground">
              <ArrowRightIcon aria-hidden="true" size={16} />
            </div>
            <div className="flex-1">
              <label
                htmlFor={toId}
                className="mb-1.5 block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
              >
                {config.placeholderTo ?? "Au"}
              </label>
              <input
                id={toId}
                type="date"
                className={dateInputClass}
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
              />
            </div>
          </div>

          {hasValue && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                onClear();
                setIsOpen(false);
              }}
            >
              <XIcon aria-hidden="true" size={14} />
              Effacer les dates
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

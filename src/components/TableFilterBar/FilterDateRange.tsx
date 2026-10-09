"use client";

import { useEffect, useRef, useState } from "react";
import type { DateRangeFilterConfig, DateRangeValue } from "./types";
import { ArrowRightIcon, CalendarIcon, ChevronDownIcon, XIcon } from "lucide-react";

type FilterDateRangeProps = {
  config: DateRangeFilterConfig;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  onClear: () => void;
};

// Quick date preset helpers
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
  const containerRef = useRef<HTMLDivElement>(null);

  const hasValue = value.from || value.to;

  // Format date for display
  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  // Get display label
  const getDisplayLabel = () => {
    if (!hasValue) return config.label;
    if (value.from && value.to) {
      return `${formatDisplayDate(value.from)} - ${formatDisplayDate(value.to)}`;
    }
    if (value.from) return `Depuis ${formatDisplayDate(value.from)}`;
    if (value.to) return `Jusqu'au ${formatDisplayDate(value.to)}`;
    return config.label;
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  const handlePreset = (preset: "week" | "month" | "30days") => {
    onChange(getPresetDates(preset));
  };

  return (
    <div className="filter-pill-container" ref={containerRef}>
      <button
        type="button"
        className={`filter-pill ${hasValue ? "filter-pill--active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Filtrer par ${config.label}${hasValue ? ", filtre actif" : ""}`}
      >
        <CalendarIcon aria-hidden="true" className="filter-pill__icon" size={14} />
        <span className="filter-pill__label">{getDisplayLabel()}</span>
        <ChevronDownIcon aria-hidden="true" className="filter-pill__chevron" size={14} />
      </button>

      {isOpen && (
        <div className="filter-dropdown filter-dropdown--date" role="dialog" aria-label={config.label}>
          {/* Quick presets */}
          <div className="filter-dropdown__presets">
            <button
              type="button"
              className="filter-dropdown__preset"
              onClick={() => handlePreset("week")}
            >
              Cette semaine
            </button>
            <button
              type="button"
              className="filter-dropdown__preset"
              onClick={() => handlePreset("month")}
            >
              Ce mois
            </button>
            <button
              type="button"
              className="filter-dropdown__preset"
              onClick={() => handlePreset("30days")}
            >
              30 derniers jours
            </button>
          </div>

          {/* Date inputs */}
          <div className="filter-dropdown__dates">
            <div className="filter-dropdown__date-field">
              <label className="filter-dropdown__date-label">
                {config.placeholderFrom ?? "Du"}
              </label>
              <input
                type="date"
                className="filter-dropdown__date-input"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
              />
            </div>
            <div className="filter-dropdown__date-separator">
              <ArrowRightIcon aria-hidden="true" size={16} />
            </div>
            <div className="filter-dropdown__date-field">
              <label className="filter-dropdown__date-label">
                {config.placeholderTo ?? "Au"}
              </label>
              <input
                type="date"
                className="filter-dropdown__date-input"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
              />
            </div>
          </div>

          {/* Clear button */}
          {hasValue && (
            <button
              type="button"
              className="filter-dropdown__clear"
              onClick={() => {
                onClear();
                setIsOpen(false);
              }}
            >
              <XIcon aria-hidden="true" size={14} />
              Effacer les dates
            </button>
          )}
        </div>
      )}
    </div>
  );
}

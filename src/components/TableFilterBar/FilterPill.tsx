"use client";

import { useEffect, useRef, useState } from "react";
import type { FilterOption, MultiSelectFilterConfig, SelectFilterConfig } from "./types";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";

type FilterPillProps = {
  config: SelectFilterConfig | MultiSelectFilterConfig;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  onClear: () => void;
};

export function FilterPill({ config, value, onChange, onClear }: FilterPillProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isMultiSelect = config.type === "multi-select";
  const selectedValues = isMultiSelect ? (value as string[]) : value ? [value as string] : [];
  const hasSelection = selectedValues.length > 0;

  // Get display label
  const getDisplayLabel = () => {
    if (!hasSelection) return config.label;
    if (isMultiSelect && selectedValues.length > 1) {
      return `${config.label} (${selectedValues.length})`;
    }
    const selected = config.options.find((o) => o.value === selectedValues[0]);
    return selected?.label ?? config.label;
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

  const handleOptionClick = (option: FilterOption) => {
    if (isMultiSelect) {
      const current = value as string[];
      if (current.includes(option.value)) {
        onChange(current.filter((v) => v !== option.value));
      } else {
        onChange([...current, option.value]);
      }
    } else {
      onChange(option.value === value ? "" : option.value);
      setIsOpen(false);
    }
  };

  const isOptionSelected = (option: FilterOption) => {
    return selectedValues.includes(option.value);
  };

  return (
    <div className="filter-pill-container" ref={containerRef}>
      <button
        type="button"
        className={`filter-pill ${hasSelection ? "filter-pill--active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Filtrer par ${config.label}${hasSelection ? `, ${selectedValues.length} selectionne(s)` : ""}`}
      >
        <span className="filter-pill__label">{getDisplayLabel()}</span>
        {isMultiSelect && selectedValues.length > 1 && (
          <span className="filter-pill__count">{selectedValues.length}</span>
        )}
        <ChevronDownIcon aria-hidden="true" className="filter-pill__chevron" size={14} />
      </button>

      {isOpen && (
        <div className="filter-dropdown" role="listbox" aria-label={`Options pour ${config.label}`}>
          {hasSelection && (
            <button
              type="button"
              className="filter-dropdown__clear"
              onClick={() => {
                onClear();
                if (!isMultiSelect) setIsOpen(false);
              }}
            >
              <XIcon aria-hidden="true" size={14} />
              Effacer
            </button>
          )}
          {config.options.map((option) => {
            const selected = isOptionSelected(option);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`filter-dropdown__option ${selected ? "filter-dropdown__option--selected" : ""}`}
                onClick={() => handleOptionClick(option)}
              >
                {isMultiSelect && (
                  <span className="filter-dropdown__checkbox">
                    {selected && (
                      <CheckIcon aria-hidden="true" strokeWidth="3" size={12} />
                    )}
                  </span>
                )}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

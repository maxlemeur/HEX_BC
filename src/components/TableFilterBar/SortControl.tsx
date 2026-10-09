"use client";

import { useEffect, useRef, useState } from "react";
import type { SortDirection, SortOption, SortState } from "./types";
import { ArrowDownUpIcon, ChevronUpIcon } from "lucide-react";

type SortControlProps = {
  options: SortOption[];
  value: SortState;
  onSortChange: (key: string, direction?: SortDirection) => void;
  onDirectionToggle: () => void;
};

export function SortControl({ options, value, onSortChange, onDirectionToggle }: SortControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption = options.find((o) => o.key === value?.key);
  const displayLabel = currentOption?.label ?? "Trier par";

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

  const handleOptionClick = (option: SortOption) => {
    if (value?.key === option.key) {
      // Same option - toggle direction
      onDirectionToggle();
    } else {
      // New option
      onSortChange(option.key, option.defaultDirection);
    }
    setIsOpen(false);
  };

  return (
    <div className="sort-control" ref={containerRef}>
      <button
        type="button"
        className={`sort-button ${value?.direction === "desc" ? "sort-button--desc" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Trier par ${displayLabel}, ordre ${value?.direction === "asc" ? "croissant" : "décroissant"}`}
      >
        <ArrowDownUpIcon aria-hidden="true" size={16} />
        <span className="sort-button__label">{displayLabel}</span>
        <ChevronUpIcon aria-hidden="true" className="sort-button__arrow" size={14} />
      </button>

      {isOpen && (
        <div className="sort-dropdown" role="listbox" aria-label="Options de tri">
          {options.map((option) => {
            const isSelected = value?.key === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`sort-dropdown__option ${isSelected ? "sort-dropdown__option--selected" : ""}`}
                onClick={() => handleOptionClick(option)}
              >
                <span>{option.label}</span>
                {isSelected && (
                  <ChevronUpIcon aria-hidden="true" className={value?.direction === "desc" ? "rotate-180" : ""} size={14} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

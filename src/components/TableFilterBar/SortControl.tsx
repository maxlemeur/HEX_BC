"use client";

import { useEffect, useRef, useState } from "react";
import type { SortDirection, SortOption, SortState } from "./types";

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
        aria-label={`Trier par ${displayLabel}, ordre ${value?.direction === "asc" ? "croissant" : "decroissant"}`}
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
          <path d="m3 16 4 4 4-4" />
          <path d="M7 20V4" />
          <path d="m21 8-4-4-4 4" />
          <path d="M17 4v16" />
        </svg>
        <span className="sort-button__label">{displayLabel}</span>
        <svg
          className="sort-button__arrow"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m18 15-6-6-6 6" />
        </svg>
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
                  <svg
                    className={value?.direction === "desc" ? "rotate-180" : ""}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

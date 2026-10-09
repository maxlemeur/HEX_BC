"use client";

import { ArrowDownUpIcon, ArrowDownIcon, ArrowUpIcon, ChevronUpIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { SortDirection, SortOption, SortState } from "./types";

type SortControlProps = {
  options: SortOption[];
  value: SortState;
  onSortChange: (key: string, direction?: SortDirection) => void;
  onDirectionToggle: () => void;
};

/**
 * Sort menu (keyboard: arrows, Enter, Escape). Choosing the active criterion again flips
 * the direction, as before.
 */
export function SortControl({ options, value, onSortChange, onDirectionToggle }: SortControlProps) {
  const currentOption = options.find((o) => o.key === value?.key);
  const displayLabel = currentOption?.label ?? "Trier par";
  const isDesc = value?.direction === "desc";
  const directionLabel = isDesc ? "décroissant" : "croissant";

  const handleOptionClick = (option: SortOption) => {
    if (value?.key === option.key) {
      onDirectionToggle();
    } else {
      onSortChange(option.key, option.defaultDirection);
    }
  };

  return (
    <div className="sort-control">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`sort-button ${isDesc ? "sort-button--desc" : ""}`}
          aria-label={`Trier par ${displayLabel}, ordre ${directionLabel}`}
        >
          <ArrowDownUpIcon aria-hidden="true" size={16} />
          <span className="sort-button__label">{displayLabel}</span>
          <ChevronUpIcon aria-hidden="true" className="sort-button__arrow" size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuRadioGroup value={value?.key ?? ""} aria-label="Options de tri">
            {options.map((option) => {
              const isSelected = value?.key === option.key;
              return (
                <DropdownMenuRadioItem
                  key={option.key}
                  value={option.key}
                  closeOnClick
                  className="min-h-10 px-2"
                  onClick={() => handleOptionClick(option)}
                >
                  <span className="flex-1">{option.label}</span>
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {isDesc ? (
                        <ArrowDownIcon aria-hidden="true" className="size-3.5" />
                      ) : (
                        <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                      )}
                      <span className="sr-only">ordre {directionLabel}</span>
                    </span>
                  ) : null}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

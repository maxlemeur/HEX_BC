"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MultiSelectFilterConfig, SelectFilterConfig } from "./types";

type FilterPillProps = {
  config: SelectFilterConfig | MultiSelectFilterConfig;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  onClear: () => void;
};

export function FilterPill({ config, value, onChange, onClear }: FilterPillProps) {
  const isMultiSelect = config.type === "multi-select";
  const selectedValues = isMultiSelect ? (value as string[]) : value ? [value as string] : [];
  const hasSelection = selectedValues.length > 0;

  const getDisplayLabel = () => {
    if (!hasSelection) return config.label;
    if (isMultiSelect && selectedValues.length > 1) {
      return `${config.label} (${selectedValues.length})`;
    }
    const selected = config.options.find((o) => o.value === selectedValues[0]);
    return selected?.label ?? config.label;
  };

  const handleToggleMulti = (optionValue: string) => {
    const current = value as string[];
    if (current.includes(optionValue)) {
      onChange(current.filter((v) => v !== optionValue));
    } else {
      onChange([...current, optionValue]);
    }
  };

  return (
    <div className="filter-pill-container">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`filter-pill ${hasSelection ? "filter-pill--active" : ""}`}
          aria-label={`Filtrer par ${config.label}${hasSelection ? `, ${selectedValues.length} sélectionné(s)` : ""}`}
        >
          <span className="filter-pill__label">{getDisplayLabel()}</span>
          {isMultiSelect && selectedValues.length > 1 && (
            <span className="filter-pill__count">{selectedValues.length}</span>
          )}
          <ChevronDownIcon aria-hidden="true" className="filter-pill__chevron" size={14} />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-auto min-w-56 max-h-72"
          aria-label={`Options pour ${config.label}`}
        >
          {hasSelection && (
            <>
              <DropdownMenuItem
                closeOnClick={!isMultiSelect}
                className="font-medium text-primary"
                onClick={onClear}
              >
                <XIcon aria-hidden="true" />
                Effacer
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {isMultiSelect ? (
            config.options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selectedValues.includes(option.value)}
                onCheckedChange={() => handleToggleMulti(option.value)}
                className="min-h-10"
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))
          ) : (
            <DropdownMenuRadioGroup
              value={typeof value === "string" ? value : ""}
              aria-label={`Options pour ${config.label}`}
            >
              {config.options.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  closeOnClick
                  className="min-h-10"
                  onClick={() => onChange(option.value === value ? "" : option.value)}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

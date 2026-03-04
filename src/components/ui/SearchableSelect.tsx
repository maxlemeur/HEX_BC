"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string[];
  disabled?: boolean;
};

export type SearchableSelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SearchableSelectOption[];
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  emptyMessage?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
};

export function SearchableSelect({
  id,
  name,
  value,
  defaultValue = "",
  options,
  label,
  placeholder = "Selectionner...",
  helperText,
  error,
  emptyMessage = "Aucun resultat.",
  className,
  required,
  disabled,
  onValueChange,
}: Readonly<SearchableSelectProps>) {
  const generatedId = useId();
  const inputId = id ?? `searchable-select-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const helperId = helperText ? `${inputId}-helper` : null;
  const errorId = error ? `${inputId}-error` : null;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = isControlled ? value ?? "" : internalValue;

  const selectedOption = useMemo(
    () => options.find((option) => option.value === selectedValue) ?? null,
    [options, selectedValue]
  );

  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const handleOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;

    return options.filter((option) => {
      const haystack = [option.label, ...(option.keywords ?? [])].join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, query]);

  const selectableOptions = useMemo(
    () => filteredOptions.filter((option) => !option.disabled),
    [filteredOptions]
  );

  const activeOption = activeIndex >= 0 ? selectableOptions[activeIndex] : null;

  function commitSelection(option: SearchableSelectOption) {
    if (!isControlled) {
      setInternalValue(option.value);
    }
    onValueChange?.(option.value);
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(-1);
  }

  const inputValue = open ? query : selectedOption?.label ?? query;

  return (
    <div className="space-y-1.5" ref={rootRef}>
      {label ? (
        <label className="block text-xs font-semibold text-slate-700" htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "relative flex h-11 items-center rounded-button border bg-surface transition",
          "border-slate-200 hover:border-slate-300 focus-within:border-ring",
          error ? "border-danger" : null,
          disabled ? "opacity-70" : null
        )}
      >
        <input
          id={inputId}
          role="combobox"
          className={cn(
            "h-full w-full rounded-button bg-transparent px-3 pr-10 text-sm",
            "focus-visible:outline-none",
            className
          )}
          type="text"
          value={inputValue}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-activedescendant={activeOption ? `${inputId}-option-${activeOption.value}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            if (disabled) return;
            setQuery(selectedOption?.label ?? "");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              setOpen(true);
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (selectableOptions.length === 0) return;
              setActiveIndex((previous) =>
                previous < selectableOptions.length - 1 ? previous + 1 : 0
              );
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (selectableOptions.length === 0) return;
              setActiveIndex((previous) =>
                previous > 0 ? previous - 1 : selectableOptions.length - 1
              );
              return;
            }

            if (event.key === "Enter") {
              if (!open) return;
              event.preventDefault();
              if (activeOption) {
                commitSelection(activeOption);
              }
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setQuery(selectedOption?.label ?? "");
              setActiveIndex(-1);
            }
          }}
        />

        <span className="pointer-events-none absolute right-3 text-slate-400">▾</span>

        {name ? (
          <input
            name={name}
            type="hidden"
            value={selectedValue}
            required={required}
            readOnly
          />
        ) : null}

        {open ? (
          <div
            role="listbox"
            id={listboxId}
            className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-surface p-1 shadow-lg"
          >
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">{emptyMessage}</p>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selectedValue === option.value;
                const optionIndex = selectableOptions.findIndex(
                  (selectableOption) => selectableOption.value === option.value
                );
                const isActive = optionIndex === activeIndex;

                return (
                  <button
                    key={option.value}
                    id={`${inputId}-option-${option.value}`}
                    role="option"
                    type="button"
                    className={cn(
                      "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm",
                      option.disabled
                        ? "cursor-not-allowed text-slate-400"
                        : "text-slate-700 hover:bg-slate-50",
                      isSelected ? "bg-info-light text-slate-900" : null,
                      isActive ? "bg-slate-100" : null
                    )}
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commitSelection(option)}
                  >
                    {option.label}
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p id={errorId ?? undefined} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {!error && helperText ? (
        <p id={helperId ?? undefined} className="text-xs text-slate-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

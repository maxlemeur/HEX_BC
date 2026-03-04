"use client";

import { useEffect, useRef, useState } from "react";

export type QuickInsertPickerItem = {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
};

type QuickInsertPickerProps = {
  isOpen: boolean;
  title: string;
  emptyLabel: string;
  items: QuickInsertPickerItem[];
  isLoading: boolean;
  isInserting: boolean;
  error: string | null;
  onSearch: (term: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function QuickInsertPicker({
  isOpen,
  title,
  emptyLabel,
  items,
  isLoading,
  isInserting,
  error,
  onSearch,
  onSelect,
  onClose,
}: QuickInsertPickerProps) {
  const [searchInput, setSearchInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setSearchInput("");
      setHighlightedIndex(0);
      onSearch("");
      // Focus search after render
      requestAnimationFrame(() => {
        searchRef.current?.focus();
      });
    }
  }, [isOpen, onSearch]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      onSearch(searchInput.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [isOpen, searchInput, onSearch]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape, keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter" && items.length > 0) {
        event.preventDefault();
        const item = items[highlightedIndex];
        if (item) onSelect(item.id);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, items, highlightedIndex, onSelect, onClose]);

  // Reset highlight when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [items]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-30 mt-2 flex flex-col rounded-xl border border-border bg-surface shadow-xl"
      style={{ width: "340px", maxHeight: "420px" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm px-1"
          onClick={onClose}
          aria-label="Fermer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          ref={searchRef}
          type="search"
          className="form-input h-8 w-full text-sm"
          placeholder="Rechercher par nom..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto px-1 pb-2" style={{ maxHeight: "300px" }}>
        {isLoading ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            Chargement...
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-sm text-destructive">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                index === highlightedIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-surface-subtle"
              }`}
              onClick={() => onSelect(item.id)}
              onMouseEnter={() => setHighlightedIndex(index)}
              disabled={isInserting}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.name}</div>
                {item.description && (
                  <div className="truncate text-xs text-muted-foreground">
                    {item.description}
                  </div>
                )}
              </div>
              <span className="shrink-0 rounded-md bg-surface-subtle px-1.5 py-0.5 text-xs text-muted-foreground">
                {item.itemCount} ligne{item.itemCount > 1 ? "s" : ""}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Inserting indicator */}
      {isInserting && (
        <div className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
          Insertion en cours...
        </div>
      )}
    </div>
  );
}

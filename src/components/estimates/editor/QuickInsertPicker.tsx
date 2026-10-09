"use client";

import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    const normalizedSearch = searchInput.trim();
    if (!normalizedSearch) {
      onSearch("");
      return;
    }
    const timer = window.setTimeout(() => {
      onSearch(normalizedSearch);
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
        setHighlightedIndex((prev) => {
          if (items.length === 0) return prev;
          return Math.min(prev + 1, items.length - 1);
        });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (items.length === 0) return prev;
          const clampedPrev = Math.min(prev, items.length - 1);
          return Math.max(clampedPrev - 1, 0);
        });
      } else if (event.key === "Enter" && items.length > 0) {
        event.preventDefault();
        const clampedIndex = Math.min(highlightedIndex, items.length - 1);
        const item = items[clampedIndex];
        if (item) onSelect(item.id);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, items, highlightedIndex, onSelect, onClose]);

  const clampedHighlightedIndex =
    items.length > 0 ? Math.min(highlightedIndex, items.length - 1) : -1;

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={title}
      className="absolute left-0 top-full z-30 mt-2 flex flex-col rounded-xl border border-border bg-surface shadow-dropdown"
      style={{
        width: "min(340px, calc(100vw - 32px))",
        maxHeight: "420px",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <IconButton
          type="button"
          size="icon-xs"
          label="Fermer"
          icon={<XIcon aria-hidden="true" />}
          onClick={onClose}
        />
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <Input
          type="search"
          size="sm"
          className="h-8"
          placeholder="Rechercher par nom…"
          aria-label="Rechercher par nom"
          value={searchInput}
          autoFocus
          onChange={(event) => {
            setSearchInput(event.target.value);
            setHighlightedIndex(0);
          }}
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto px-1 pb-2" style={{ maxHeight: "300px" }}>
        {isLoading ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground" role="status">
            Chargement…
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-sm text-danger" role="alert">
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
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-foreground transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                index === clampedHighlightedIndex
                  ? "bg-muted"
                  : "hover:bg-surface-subtle",
              )}
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
              <Badge variant="neutral" size="sm">
                {item.itemCount} ligne{item.itemCount > 1 ? "s" : ""}
              </Badge>
            </button>
          ))
        )}
      </div>

      {/* Inserting indicator */}
      {isInserting && (
        <div
          className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground"
          role="status"
        >
          Insertion en cours…
        </div>
      )}
    </div>
  );
}

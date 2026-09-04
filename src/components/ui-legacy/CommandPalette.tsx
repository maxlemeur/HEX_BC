"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import {
  useCommandPalette,
  type CommandGroup,
} from "@/hooks/useCommandPalette";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFocusableNodes(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    )
  ).filter(
    (node) =>
      !node.hasAttribute("disabled") &&
      node.getAttribute("aria-hidden") !== "true"
  );
}

// ---------------------------------------------------------------------------
// Group icon per type
// ---------------------------------------------------------------------------

function GroupIcon({ group }: { group: CommandGroup["key"] }) {
  if (group === "recent") {
    return (
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
        className="shrink-0 opacity-50"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (group === "actions") {
    return (
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
        className="shrink-0 opacity-50"
      >
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    );
  }
  // navigation
  return (
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
      className="shrink-0 opacity-50"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const {
    open,
    setOpen: close,
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    groups,
    flatItems,
    execute,
    handlePaletteKeyDown,
  } = useCommandPalette();

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || flatItems.length === 0) return;
    const item = listRef.current?.querySelector(
      `[data-command-index="${selectedIndex}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex, flatItems.length]);

  // Focus trap
  function handleTabTrap(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const container = panelRef.current;
    if (!container) return;
    const focusable = findFocusableNodes(container);
    if (focusable.length === 0) return;
    const currentIndex = focusable.findIndex(
      (el) => el === document.activeElement
    );
    if (e.shiftKey) {
      if (currentIndex <= 0) {
        e.preventDefault();
        focusable[focusable.length - 1]?.focus();
      }
    } else if (currentIndex === focusable.length - 1) {
      e.preventDefault();
      focusable[0]?.focus();
    }
  }

  if (!open) return null;

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(2_6_23_/_0.45)] pt-[15vh] transition-opacity sm:pt-[20vh]"
      onMouseDown={() => close()}
    >
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Recherche rapide"
        className={cn(
          "relative z-10 mx-4 flex w-full max-w-lg flex-col overflow-hidden rounded-xl",
          "border border-[var(--border)] bg-[var(--surface)] shadow-2xl",
          "max-h-[min(480px,60vh)]"
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          handlePaletteKeyDown(e);
          handleTabTrap(e);
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-[var(--muted-foreground)]"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
            placeholder="Rechercher une page, action..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher une page ou action"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={
              flatItems[selectedIndex]
                ? `command-item-${selectedIndex}`
                : undefined
            }
          />
          <button
            type="button"
            aria-label="Fermer la recherche rapide"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-slate-100 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-orange)] dark:hover:bg-slate-800"
            onClick={close}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="Résultats"
          className="flex-1 overflow-y-auto overscroll-contain px-2 py-2"
        >
          {groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
              Aucun résultat
            </div>
          ) : (
            groups.map((group) => {
              const groupItems = group.items;
              return (
                <div key={group.key} className="mb-1">
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    <GroupIcon group={group.key} />
                    {group.label}
                  </div>
                  {groupItems.map((item) => {
                    const idx = flatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={`${group.key}-${item.id}`}
                        id={`command-item-${idx}`}
                        role="option"
                        aria-selected={isSelected}
                        data-command-index={idx}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-[var(--brand-orange)]/10 text-[var(--foreground)]"
                            : "text-[var(--foreground)] hover:bg-slate-100 dark:hover:bg-slate-800"
                        )}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onClick={() => execute(item)}
                      >
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.description ? (
                          <span className="truncate text-xs text-[var(--muted-foreground)]">
                            {item.description}
                          </span>
                        ) : null}
                        {isSelected ? (
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
                            className="shrink-0 text-[var(--brand-orange)]"
                          >
                            <polyline points="9 10 4 15 9 20" />
                            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                          </svg>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1 py-px font-mono text-[10px]">
              &uarr;&darr;
            </kbd>
            Naviguer
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1 py-px font-mono text-[10px]">
              &crarr;
            </kbd>
            Ouvrir
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1 py-px font-mono text-[10px]">
              Esc
            </kbd>
            Fermer
          </span>
        </div>
      </div>
    </div>
  );
}

// Optional trigger button for future toolbar integration
export function CommandPaletteTrigger({
  className,
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-slate-50 dark:hover:bg-slate-800",
        className
      )}
      onClick={() => {
        // Simulate Ctrl+K to open the palette via the global listener
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
          })
        );
      }}
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
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      Recherche rapide
      <kbd className="ml-auto rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium">
        Ctrl K
      </kbd>
    </button>
  );
}

"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  useCommandPalette,
  type CommandGroup,
  type CommandItem,
} from "@/hooks/useCommandPalette";
import { ChevronRightIcon, ClockIcon, CornerDownLeftIcon, SearchIcon, XIcon, ZapIcon } from "lucide-react";

const LISTBOX_ID = "command-palette-list";

// ---------------------------------------------------------------------------
// Group icon per type
// ---------------------------------------------------------------------------

function GroupIcon({ group }: { group: CommandGroup["key"] }) {
  const className = "size-3.5 shrink-0 opacity-60";
  if (group === "recent") return <ClockIcon aria-hidden="true" className={className} />;
  if (group === "actions") return <ZapIcon aria-hidden="true" className={className} />;
  return <ChevronRightIcon aria-hidden="true" className={className} />;
}

function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-micro text-foreground-secondary">
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Global quick search (Ctrl/⌘ K) on the house dialog: focus trap, Escape and focus return
 * come from Base UI; the search field is an ARIA combobox driving the listbox through
 * `aria-activedescendant` (focus stays in the field while arrows move the selection).
 */
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

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // An executed command may open its own dialog: do not pull focus back to the trigger then.
  const executedRef = useRef(false);

  useEffect(() => {
    if (open) executedRef.current = false;
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || flatItems.length === 0) return;
    const item = listRef.current?.querySelector(
      `[data-command-index="${selectedIndex}"]`
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [open, selectedIndex, flatItems.length]);

  function runCommand(item: CommandItem) {
    executedRef.current = true;
    execute(item);
  }

  let flatIndex = 0;
  const activeOptionId = flatItems[selectedIndex]
    ? `command-item-${selectedIndex}`
    : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        size="md"
        showCloseButton={false}
        initialFocus={inputRef}
        finalFocus={() => !executedRef.current}
        className="top-[15vh] max-h-[min(480px,70dvh)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[20vh] sm:p-0"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            const item = flatItems[selectedIndex];
            if (item) executedRef.current = true;
          }
          handlePaletteKeyDown(event);
        }}
      >
        <DialogTitle className="sr-only">Recherche rapide</DialogTitle>

        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border py-2 pr-2 pl-4">
          <SearchIcon aria-hidden="true" className="size-4.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            placeholder="Rechercher une page, une action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher une page ou une action"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={LISTBOX_ID}
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            spellCheck={false}
          />
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" />}
            aria-label="Fermer la recherche rapide"
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </div>

        {/* Results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {groups.length === 0 ? (
            <p role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
              Aucun résultat
            </p>
          ) : null}
          <div id={LISTBOX_ID} role="listbox" aria-label="Résultats">
            {groups.map((group) => {
              const labelId = `command-group-${group.key}`;
              return (
                <div key={group.key} role="group" aria-labelledby={labelId} className="mb-1">
                  <div
                    id={labelId}
                    role="presentation"
                    className="flex items-center gap-2 px-3 pt-2 pb-1 text-micro font-semibold tracking-wider text-muted-foreground uppercase"
                  >
                    <GroupIcon group={group.key} />
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const idx = flatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <div
                        key={`${group.key}-${item.id}`}
                        id={`command-item-${idx}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={isSelected}
                        data-command-index={idx}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors",
                          isSelected ? "bg-brand-orange/10" : "hover:bg-muted"
                        )}
                        // Keep focus in the combobox field while picking with the mouse.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => {
                          if (!isSelected) setSelectedIndex(idx);
                        }}
                        onClick={() => runCommand(item)}
                      >
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.description ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                        {isSelected ? (
                          <CornerDownLeftIcon aria-hidden="true" className="size-3.5 shrink-0 text-brand-orange-dark" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer hints */}
        <div
          aria-hidden="true"
          className="flex items-center gap-4 border-t border-border px-4 py-2 text-micro text-muted-foreground"
        >
          <span className="flex items-center gap-1">
            <KeyHint>&uarr;&darr;</KeyHint>
            Naviguer
          </span>
          <span className="flex items-center gap-1">
            <KeyHint>&crarr;</KeyHint>
            Ouvrir
          </span>
          <span className="flex items-center gap-1">
            <KeyHint>Échap</KeyHint>
            Fermer
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Optional trigger button for future toolbar integration
export function CommandPaletteTrigger({
  className,
}: {
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("text-muted-foreground", className)}
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
      <SearchIcon aria-hidden="true" />
      Recherche rapide
      <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-micro font-medium">
        Ctrl K
      </kbd>
    </Button>
  );
}

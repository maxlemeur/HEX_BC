"use client";

import { type ReactNode, useCallback, useRef } from "react";

import type { CockpitSuggestion, CockpitIntent } from "@/lib/cockpit/suggestions";
import { useCockpitCommandBar } from "@/hooks/useCockpitCommandBar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LucideEye, LucideFileText, LucidePlay, LucideShieldCheck, LucideUpload, SquareMenuIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function PlayIcon() {
  return (
    <LucidePlay aria-hidden="true" size={14} />
  );
}

function EyeIcon() {
  return (
    <LucideEye aria-hidden="true" size={14} />
  );
}

function ListIcon() {
  return (
    <SquareMenuIcon aria-hidden="true" size={14} />
  );
}

function ShieldCheckIcon() {
  return (
    <LucideShieldCheck aria-hidden="true" size={14} />
  );
}

function UploadIcon() {
  return (
    <LucideUpload aria-hidden="true" size={14} />
  );
}

function FileTextIcon() {
  return (
    <LucideFileText aria-hidden="true" size={14} />
  );
}

const INTENT_ICONS: Record<CockpitIntent, ReactNode> = {
  add_files: <UploadIcon />,
  review_intake: <FileTextIcon />,
  add_missing_pieces: <UploadIcon />,
  confirm_brief: <ShieldCheckIcon />,
  analyze_plans: <PlayIcon />,
  generate_structure: <PlayIcon />,
  continue_hybrid: <PlayIcon />,
  view_exceptions: <EyeIcon />,
  list_hypotheses: <ListIcon />,
  prepare_validation: <ShieldCheckIcon />,
};

function PinnedBadge() {
  return (
    <Badge variant="brand" size="sm">
      Épinglée
    </Badge>
  );
}

type CockpitCommandBarProps = {
  suggestions: CockpitSuggestion[];
  onExecute: (suggestion: CockpitSuggestion) => void;
  onToggleHidden: (actionId: string, isHidden: boolean) => void;
  onTogglePinned: (actionId: string, isPinned: boolean) => void;
};

function ManageRow({
  suggestion,
  onToggleHidden,
  onTogglePinned,
}: {
  suggestion: CockpitSuggestion;
  onToggleHidden: (actionId: string, isHidden: boolean) => void;
  onTogglePinned: (actionId: string, isPinned: boolean) => void;
}) {
  return (
    <li className="rounded-md px-2 py-2 hover:bg-surface-subtle">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <span className="shrink-0 text-muted-foreground">{INTENT_ICONS[suggestion.intent]}</span>
        <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <label className="flex min-h-8 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={!suggestion.isHidden}
            onChange={(event) => onToggleHidden(suggestion.actionId, !event.target.checked)}
          />
          Visible
        </label>
        <label className="flex min-h-8 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={suggestion.isPinned}
            onChange={(event) => onTogglePinned(suggestion.actionId, event.target.checked)}
          />
          Épinglée
        </label>
      </div>
    </li>
  );
}

export function CockpitCommandBar({
  suggestions,
  onExecute,
  onToggleHidden,
  onTogglePinned,
}: Readonly<CockpitCommandBarProps>) {
  const {
    filteredSuggestions,
    overflowSuggestions,
    activeIndex,
    setActiveIndex,
  } = useCockpitCommandBar(suggestions);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const totalPills = filteredSuggestions.length + (overflowSuggestions.length > 0 ? 1 : 0);
  const hasVisibleSuggestions = filteredSuggestions.length > 0 || overflowSuggestions.length > 0;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (totalPills === 0) return;
      // Arrow keys inside an open menu or popover belong to that popup.
      if (!(event.target instanceof HTMLElement) || !pillRefs.current.includes(event.target as HTMLButtonElement)) {
        return;
      }

      let nextIndex = activeIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        nextIndex = (activeIndex + 1) % totalPills;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        nextIndex = (activeIndex - 1 + totalPills) % totalPills;
      } else if (event.key === "Home") {
        event.preventDefault();
        nextIndex = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        nextIndex = totalPills - 1;
      } else {
        return;
      }

      setActiveIndex(nextIndex);
      pillRefs.current[nextIndex]?.focus();
    },
    [activeIndex, totalPills, setActiveIndex],
  );

  if (suggestions.length === 0) {
    return null;
  }

  const pillClass = cn(buttonVariants({ variant: "outline", size: "md" }));

  return (
    <div
      role="toolbar"
      aria-label="Actions contextuelles"
      className="cockpit-command-strip"
      onKeyDown={handleKeyDown}
    >
      {filteredSuggestions.map((suggestion, index) => (
        <button
          key={suggestion.actionId}
          ref={(element) => {
            pillRefs.current[index] = element;
          }}
          type="button"
          className={pillClass}
          tabIndex={index === activeIndex ? 0 : -1}
          onClick={() => onExecute(suggestion)}
        >
          {INTENT_ICONS[suggestion.intent]}
          {suggestion.label}
          {suggestion.isPinned ? <PinnedBadge /> : null}
        </button>
      ))}

      {overflowSuggestions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            ref={(element: HTMLButtonElement | null) => {
              pillRefs.current[filteredSuggestions.length] = element;
            }}
            className={pillClass}
            tabIndex={filteredSuggestions.length === activeIndex ? 0 : -1}
          >
            +{overflowSuggestions.length} autre{overflowSuggestions.length !== 1 ? "s" : ""}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto min-w-72">
            {overflowSuggestions.map((suggestion) => (
              <DropdownMenuItem
                key={suggestion.actionId}
                className="min-h-10 px-2"
                onClick={() => onExecute(suggestion)}
              >
                {INTENT_ICONS[suggestion.intent]}
                <span className="flex-1">{suggestion.label}</span>
                {suggestion.isPinned ? <PinnedBadge /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Popover>
        <PopoverTrigger
          className={cn(buttonVariants({ variant: "link", size: "xs" }), "text-xs font-medium text-muted-foreground hover:text-foreground-secondary")}
        >
          Gérer
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]" aria-label="Gérer les actions contextuelles">
          <ul className="flex flex-col">
            {suggestions.map((suggestion) => (
              <ManageRow
                key={suggestion.actionId}
                suggestion={suggestion}
                onToggleHidden={onToggleHidden}
                onTogglePinned={onTogglePinned}
              />
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      {!hasVisibleSuggestions ? (
        <span className="text-xs text-muted-foreground">
          Toutes les actions sont masquées.
        </span>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {filteredSuggestions.length + overflowSuggestions.length} action
        {filteredSuggestions.length + overflowSuggestions.length !== 1 ? "s" : ""} disponible
        {filteredSuggestions.length + overflowSuggestions.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

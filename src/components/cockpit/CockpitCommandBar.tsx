"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";

import type { CockpitSuggestion, CockpitIntent } from "@/lib/cockpit/suggestions";
import { useCockpitCommandBar } from "@/hooks/useCockpitCommandBar";
import { LucideEye, LucideFileText, LucidePlay, LucideShieldCheck, LucideUpload, SquareMenuIcon } from "lucide-react";

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
    <div className="rounded px-2 py-2 hover:bg-surface-subtle">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <span className="shrink-0 text-muted-foreground">{INTENT_ICONS[suggestion.intent]}</span>
        <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={!suggestion.isHidden}
            onChange={(event) => onToggleHidden(suggestion.actionId, !event.target.checked)}
          />
          Visible
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={suggestion.isPinned}
            onChange={(event) => onTogglePinned(suggestion.actionId, event.target.checked)}
          />
          Epinglee
        </label>
      </div>
    </div>
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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showManageMenu, setShowManageMenu] = useState(false);
  const totalPills = filteredSuggestions.length + (overflowSuggestions.length > 0 ? 1 : 0);
  const hasVisibleSuggestions = filteredSuggestions.length > 0 || overflowSuggestions.length > 0;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (totalPills === 0) return;

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

  const pillClass = "btn btn-secondary btn-sm inline-flex items-center gap-1.5";

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
          {suggestion.isPinned ? <span className="text-[10px] uppercase text-primary">Pin</span> : null}
        </button>
      ))}

      {overflowSuggestions.length > 0 ? (
        <div className="relative inline-block">
          <button
            ref={(element) => {
              pillRefs.current[filteredSuggestions.length] = element;
            }}
            type="button"
            className={pillClass}
            tabIndex={filteredSuggestions.length === activeIndex ? 0 : -1}
            aria-expanded={showOverflowMenu}
            onClick={() => {
              setShowOverflowMenu((current) => !current);
              setShowManageMenu(false);
            }}
          >
            +{overflowSuggestions.length} autre{overflowSuggestions.length !== 1 ? "s" : ""}
          </button>
          {showOverflowMenu ? (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[280px] rounded-lg border border-border bg-surface p-2 shadow-lg">
              {overflowSuggestions.map((suggestion) => (
                <button
                  key={suggestion.actionId}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-surface-subtle"
                  onClick={() => {
                    setShowOverflowMenu(false);
                    onExecute(suggestion);
                  }}
                >
                  {INTENT_ICONS[suggestion.intent]}
                  <span className="flex-1">{suggestion.label}</span>
                  {suggestion.isPinned ? <span className="text-[10px] uppercase text-primary">Pin</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative inline-block">
        <button
          type="button"
          className="text-xs text-muted-foreground underline hover:text-foreground-secondary"
          aria-expanded={showManageMenu}
          onClick={() => {
            setShowManageMenu((current) => !current);
            setShowOverflowMenu(false);
          }}
        >
          Gérer
        </button>
        {showManageMenu ? (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[320px] rounded-lg border border-border bg-surface p-2 shadow-lg">
            {suggestions.map((suggestion) => (
              <ManageRow
                key={suggestion.actionId}
                suggestion={suggestion}
                onToggleHidden={onToggleHidden}
                onTogglePinned={onTogglePinned}
              />
            ))}
          </div>
        ) : null}
      </div>

      {!hasVisibleSuggestions ? (
        <span className="text-xs text-muted-foreground">
          Toutes les actions sont masquees.
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

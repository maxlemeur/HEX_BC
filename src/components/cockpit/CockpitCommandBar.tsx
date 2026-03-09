"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useRef } from "react";

import type { CockpitSuggestion, CockpitIntent } from "@/lib/cockpit/suggestions";
import { useCockpitCommandBar } from "@/hooks/useCockpitCommandBar";

const CockpitCommandPreview = dynamic(
  () =>
    import("./CockpitCommandPreview").then((m) => ({
      default: m.CockpitCommandPreview,
    })),
  { ssr: false },
);

/* ------------------------------------------------------------------ */
/*  Icons (14x14 SVG)                                                  */
/* ------------------------------------------------------------------ */

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const INTENT_ICONS: Record<CockpitIntent, React.ReactNode> = {
  analyze_plans: <PlayIcon />,
  generate_structure: <PlayIcon />,
  view_exceptions: <EyeIcon />,
  list_hypotheses: <ListIcon />,
  prepare_validation: <ShieldCheckIcon />,
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type CockpitCommandBarProps = {
  suggestions: CockpitSuggestion[];
  projectId: string;
  onOpenDialog: (dialogId: string) => void;
  onExecute?: (suggestion: CockpitSuggestion) => void;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CockpitCommandBar({
  suggestions,
  projectId,
  onOpenDialog,
  onExecute,
}: Readonly<CockpitCommandBarProps>) {
  const {
    filteredSuggestions,
    overflowSuggestions,
    previewSuggestion,
    activeIndex,
    setActiveIndex,
    execute,
    confirmPreview,
    cancelPreview,
    hideAction,
    resetHidden,
  } = useCockpitCommandBar(suggestions, projectId);

  const pillRefs = useRef<(HTMLElement | null)[]>([]);
  const manageRef = useRef<HTMLDivElement | null>(null);
  const manageButtonRef = useRef<HTMLButtonElement | null>(null);

  const totalPills = filteredSuggestions.length + (overflowSuggestions.length > 0 ? 1 : 0);

  /* -- Roving tabindex keyboard handler -- */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (totalPills === 0) return;
      let nextIndex = activeIndex;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (activeIndex + 1) % totalPills;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (activeIndex - 1 + totalPills) % totalPills;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = totalPills - 1;
      } else {
        return;
      }
      setActiveIndex(nextIndex);
      pillRefs.current[nextIndex]?.focus();
    },
    [activeIndex, totalPills, setActiveIndex],
  );

  /* -- Execute action dispatch -- */
  const handleExecute = useCallback(
    (suggestion: CockpitSuggestion) => {
      const result = execute(suggestion);
      if (result) {
        onExecute?.(result);
        if (result.target.kind === "open_dialog") {
          onOpenDialog(result.target.dialogId);
        }
      }
    },
    [execute, onExecute, onOpenDialog],
  );

  /* -- Confirm preview dispatch -- */
  const handleConfirm = useCallback(() => {
    const result = confirmPreview();
    if (result) {
      onExecute?.(result);
      if (result.target.kind === "open_dialog") {
        onOpenDialog(result.target.dialogId);
      }
    }
  }, [confirmPreview, onExecute, onOpenDialog]);

  /* -- Manage popover toggle -- */
  const toggleManage = useCallback(() => {
    const el = manageRef.current;
    if (!el) return;
    el.hidden = !el.hidden;
  }, []);

  if (filteredSuggestions.length === 0 && overflowSuggestions.length === 0) {
    return null;
  }

  const pillClass = "btn btn-secondary btn-sm inline-flex items-center gap-1.5";

  return (
    <>
      <div
        role="toolbar"
        aria-label="Actions contextuelles"
        className="cockpit-command-strip"
        onKeyDown={handleKeyDown}
      >
        {filteredSuggestions.map((s, i) => {
          const icon = INTENT_ICONS[s.intent];
          const tabIdx = i === activeIndex ? 0 : -1;

          if (s.target.kind === "navigate") {
            return (
              <Link
                key={s.actionId}
                ref={(el) => { pillRefs.current[i] = el; }}
                href={s.target.href}
                className={pillClass}
                tabIndex={tabIdx}
                onClick={() => handleExecute(s)}
              >
                {icon}
                {s.label}
              </Link>
            );
          }

          return (
            <button
              key={s.actionId}
              ref={(el) => { pillRefs.current[i] = el; }}
              type="button"
              className={pillClass}
              tabIndex={tabIdx}
              onClick={() => handleExecute(s)}
            >
              {icon}
              {s.label}
            </button>
          );
        })}

        {overflowSuggestions.length > 0 ? (
          <button
            ref={(el) => { pillRefs.current[filteredSuggestions.length] = el; }}
            type="button"
            className={pillClass}
            tabIndex={filteredSuggestions.length === activeIndex ? 0 : -1}
            onClick={toggleManage}
          >
            +{overflowSuggestions.length} autre{overflowSuggestions.length !== 1 ? "s" : ""}
          </button>
        ) : null}

        {/* Manage popover */}
        <div className="relative inline-block">
          <button
            ref={manageButtonRef}
            type="button"
            className="text-xs text-slate-500 underline hover:text-slate-700"
            onClick={toggleManage}
          >
            Gerer
          </button>
          <div
            ref={manageRef}
            hidden
            className="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-lg border border-slate-200 bg-surface p-2 shadow-lg"
          >
            {suggestions.map((s) => (
              <label
                key={s.actionId}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={filteredSuggestions.some((f) => f.actionId === s.actionId) || overflowSuggestions.some((o) => o.actionId === s.actionId)}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      hideAction(s.actionId);
                    }
                  }}
                />
                {s.label}
              </label>
            ))}
            <button
              type="button"
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-50"
              onClick={resetHidden}
            >
              Reinitialiser
            </button>
          </div>
        </div>

        <span className="sr-only" aria-live="polite">
          {filteredSuggestions.length} action{filteredSuggestions.length !== 1 ? "s" : ""} disponible{filteredSuggestions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {previewSuggestion ? (
        <CockpitCommandPreview
          suggestion={previewSuggestion}
          onConfirm={handleConfirm}
          onCancel={cancelPreview}
        />
      ) : null}
    </>
  );
}

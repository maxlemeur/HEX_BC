"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { markApprovalQueueItemStateAction } from "@/app/dashboard/_actions/approval-queue";
import type { ReviewerState } from "@/lib/approvals/server";

const STATE_OPTIONS: { value: ReviewerState; label: string; ariaLabel: string }[] = [
  { value: "seen", label: "Vu", ariaLabel: "Marquer comme vu" },
  { value: "review_laurent", label: "A revoir", ariaLabel: "Marquer a revoir" },
  { value: "blocking", label: "Bloquant", ariaLabel: "Marquer comme bloquant" },
  { value: "acceptable", label: "Acceptable", ariaLabel: "Marquer comme acceptable" },
];

type ApprovalQueueStateActionsProps = {
  cycleId: string;
  currentState: ReviewerState | null;
  onStateChange?: (state: ReviewerState) => void;
};

export function ApprovalQueueStateActions({
  cycleId,
  currentState,
  onStateChange,
}: ApprovalQueueStateActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handleSelect = (state: ReviewerState) => {
    setIsOpen(false);
    startTransition(async () => {
      try {
        await markApprovalQueueItemStateAction({ cycleId, state });
        onStateChange?.(state);
        setFeedback(`Marque comme "${STATE_OPTIONS.find((o) => o.value === state)?.label}"`);
      } catch {
        setFeedback("Erreur lors de la mise a jour");
      }
    });
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        disabled={isPending}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1 text-xs font-medium text-[var(--slate-600)] hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-blue)] disabled:opacity-50 sm:min-h-8 sm:min-w-8"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Actions de triage"
      >
        {isPending ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-[var(--slate-200)] bg-white py-1 shadow-lg"
          role="listbox"
          aria-label="Etats de triage"
        >
          {STATE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={currentState === option.value}
              aria-label={option.ariaLabel}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSelect(option.value);
              }}
              className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--slate-50)] sm:min-h-0 sm:py-1.5 ${
                currentState === option.value
                  ? "font-semibold text-[var(--brand-blue)]"
                  : "text-[var(--slate-700)]"
              }`}
            >
              {currentState === option.value && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span className={currentState === option.value ? "" : "ml-5"}>{option.label}</span>
            </button>
          ))}
        </div>
      )}

      {feedback && (
        <span className="absolute right-0 top-full mt-1 whitespace-nowrap rounded bg-[var(--slate-800)] px-2 py-1 text-[10px] text-white" aria-live="polite">
          {feedback}
        </span>
      )}
    </div>
  );
}

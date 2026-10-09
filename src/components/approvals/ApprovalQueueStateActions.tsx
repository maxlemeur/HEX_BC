"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { markApprovalQueueItemStateAction } from "@/app/dashboard/_actions/approval-queue";
import type { ReviewerState } from "@/lib/approvals/server";
import { CheckIcon, EllipsisIcon, LoaderIcon } from "lucide-react";

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
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium text-slate-600 hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 sm:min-h-8 sm:min-w-8"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Actions de triage"
      >
        {isPending ? (
          <LoaderIcon aria-hidden="true" className="h-3 w-3 animate-spin" />
        ) : (
          <EllipsisIcon aria-hidden="true" size={14} />
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-border bg-surface py-1 shadow-lg"
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
              className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-subtle sm:min-h-0 sm:py-1.5 ${
                currentState === option.value
                  ? "font-semibold text-primary"
                  : "text-foreground-secondary"
              }`}
            >
              {currentState === option.value && (
                <CheckIcon aria-hidden="true" strokeWidth="3" size={12} />
              )}
              <span className={currentState === option.value ? "" : "ml-5"}>{option.label}</span>
            </button>
          ))}
        </div>
      )}

      {feedback && (
        <span className="absolute right-0 top-full mt-1 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white" aria-live="polite">
          {feedback}
        </span>
      )}
    </div>
  );
}

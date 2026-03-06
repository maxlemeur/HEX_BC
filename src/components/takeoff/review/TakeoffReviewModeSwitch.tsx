"use client";

import { useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewMode = "assisted" | "production" | "validation";

type TakeoffReviewModeSwitchProps = {
  mode: ReviewMode;
  onModeChange: (mode: ReviewMode) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_OPTIONS: { value: ReviewMode; label: string; description: string }[] = [
  {
    value: "assisted",
    label: "Assiste",
    description: "Revue guidee carte par carte",
  },
  {
    value: "production",
    label: "Production",
    description: "Table experte avec edition rapide",
  },
  {
    value: "validation",
    label: "Validation",
    description: "Exceptions et couverture",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TakeoffReviewModeSwitch({
  mode,
  onModeChange,
}: TakeoffReviewModeSwitchProps) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = MODE_OPTIONS.findIndex((o) => o.value === mode);
      let nextIndex = currentIndex;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        nextIndex = (currentIndex + 1) % MODE_OPTIONS.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        nextIndex =
          (currentIndex - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length;
      } else if (event.key === "Home") {
        event.preventDefault();
        nextIndex = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        nextIndex = MODE_OPTIONS.length - 1;
      } else {
        return;
      }

      onModeChange(MODE_OPTIONS[nextIndex].value);
    },
    [mode, onModeChange]
  );

  return (
    <div
      role="radiogroup"
      aria-label="Mode de revue"
      onKeyDown={handleKeyDown}
      className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--slate-50)] p-0.5"
    >
      {MODE_OPTIONS.map((option) => {
        const isSelected = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${option.label} : ${option.description}`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onModeChange(option.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 ${
              isSelected
                ? "bg-white text-[var(--slate-900)] shadow-sm"
                : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

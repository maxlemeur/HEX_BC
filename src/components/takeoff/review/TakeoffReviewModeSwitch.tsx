"use client";

import { useCallback, useEffect, useRef } from "react";

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
  const buttonRefs = useRef<Map<ReviewMode, HTMLButtonElement>>(new Map());
  const pendingFocusRef = useRef<ReviewMode | null>(null);

  // Focus the target button after React re-renders (panel swap may steal focus)
  useEffect(() => {
    if (pendingFocusRef.current !== null) {
      const target = pendingFocusRef.current;
      pendingFocusRef.current = null;
      // Double-rAF to ensure focus runs after Suspense/lazy panel paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          buttonRefs.current.get(target)?.focus();
        });
      });
    }
  }, [mode]);

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

      const nextMode = MODE_OPTIONS[nextIndex].value;
      pendingFocusRef.current = nextMode;
      onModeChange(nextMode);
    },
    [mode, onModeChange]
  );

  return (
    <div
      role="tablist"
      aria-label="Modes métier de la revue"
      onKeyDown={handleKeyDown}
      className="production-ribbon__tabs"
    >
      {MODE_OPTIONS.map((option) => {
        const isSelected = option.value === mode;
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) buttonRefs.current.set(option.value, el);
            }}
            id={`takeoff-review-mode-${option.value}-tab`}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls="takeoff-review-mode-panel"
            aria-label={`${option.label} : ${option.description}`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onModeChange(option.value)}
            className="production-ribbon__tab min-h-11 sm:min-h-[38px]"
            data-active={isSelected ? "true" : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

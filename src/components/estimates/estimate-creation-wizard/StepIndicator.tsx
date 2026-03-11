"use client";

import { STEPS } from "@/components/estimates/estimate-creation-wizard/shared";

type StepIndicatorProps = {
  currentStep: number;
  validatedSteps: Set<number>;
  onStepClick: (step: number) => void;
};

export function StepIndicator({
  currentStep,
  validatedSteps,
  onStepClick,
}: StepIndicatorProps) {
  return (
    <nav aria-label="Étapes de création" className="mb-8">
      <ol className="flex items-center">
        {STEPS.map((step, index) => {
          const isActive = index === currentStep;
          const isValidated = validatedSteps.has(index);
          const isPast = index < currentStep;
          const isClickable = (isPast || isValidated) && !isActive;

          return (
            <li
              key={step.label}
              className={`flex items-center ${index > 0 ? "flex-1" : ""}`}
            >
              {index > 0 && (
                <div
                  className={`h-px flex-1 ${
                    isPast || isValidated
                      ? "bg-[var(--primary)]"
                      : "bg-[var(--slate-200)]"
                  }`}
                />
              )}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(index)}
                className={`flex flex-col items-center gap-1 ${
                  isClickable ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-[var(--primary)] text-white"
                      : isValidated
                        ? "bg-[var(--success)] text-white"
                        : "bg-[var(--slate-100)] text-[var(--slate-500)]"
                  }`}
                >
                  {isValidated && !isActive ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={`text-xs whitespace-nowrap text-center ${
                    isActive
                      ? "font-semibold text-[var(--primary)]"
                      : "text-[var(--slate-500)]"
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

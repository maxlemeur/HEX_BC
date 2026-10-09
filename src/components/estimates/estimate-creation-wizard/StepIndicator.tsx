"use client";

import { STEPS } from "@/components/estimates/estimate-creation-wizard/shared";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

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
              className={cn("flex items-center", index > 0 && "flex-1")}
            >
              {index > 0 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    "mx-2 h-px flex-1",
                    isPast || isValidated ? "bg-primary" : "bg-border"
                  )}
                />
              )}
              <button
                type="button"
                disabled={!isClickable}
                aria-current={isActive ? "step" : undefined}
                onClick={() => isClickable && onStepClick(index)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-control px-1 py-0.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  isClickable ? "cursor-pointer" : "cursor-default"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors motion-reduce:transition-none",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isValidated
                        ? "bg-success text-success-foreground"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {isValidated && !isActive ? (
                    <CheckIcon strokeWidth="3" size={14} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-center text-xs",
                    isActive
                      ? "font-semibold text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
                {isValidated && !isActive ? (
                  <span className="sr-only">(étape validée)</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

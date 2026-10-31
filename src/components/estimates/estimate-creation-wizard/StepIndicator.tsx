"use client";

import { STEPS } from "@/components/estimates/estimate-creation-wizard/shared";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

import "@/components/journey/journey.css";

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
    <nav aria-label="Étapes de création" className="mb-6">
      <ol className="journey-rail">
        {STEPS.map((step, index) => {
          const isActive = index === currentStep;
          const isValidated = validatedSteps.has(index);
          const isPast = index < currentStep;
          const isClickable = (isPast || isValidated) && !isActive;

          return (
            <li key={step.label}>
              <button
                type="button"
                disabled={!isClickable}
                aria-current={isActive ? "step" : undefined}
                onClick={() => isClickable && onStepClick(index)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "journey-number",
                    isActive && "journey-current",
                    isValidated && !isActive && "journey-done"
                  )}
                >
                  {isValidated && !isActive ? (
                    <CheckIcon strokeWidth="3" size={12} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span>
                  {step.label}
                  {isValidated && !isActive ? (
                    <span className="sr-only"> (étape validée)</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

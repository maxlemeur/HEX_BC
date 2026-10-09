import { STEP_LABELS, type Step } from "./types";
import { CheckIcon } from "lucide-react";

type ProgressHeaderProps = {
  currentStep: Step;
  steps: readonly Step[];
};

export function ProgressHeader({ currentStep, steps }: ProgressHeaderProps) {
  const stepperIndex = steps.indexOf(currentStep);
  const currentIndex = stepperIndex >= 0 ? stepperIndex : steps.length;

  return (
    <nav className="flex items-center gap-1" aria-label="Progression import">
      {steps.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step} className="flex items-center gap-1">
            {index > 0 && (
              <div
                className={`hidden h-px w-6 sm:block ${
                  isDone ? "bg-success" : "bg-border"
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? "bg-primary text-white"
                  : isDone
                    ? "bg-success-subtle text-success"
                    : "bg-muted text-subtle-foreground"
              }`}
            >
              {isDone ? (
                <CheckIcon aria-hidden="true" strokeWidth="3" size={12} />
              ) : (
                <span>{index + 1}</span>
              )}
              <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
              {step === "plans" && (
                <span className="ml-1 hidden text-micro font-normal opacity-70 sm:inline">
                  optionnel
                </span>
              )}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

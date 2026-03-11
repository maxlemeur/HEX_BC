import { STEP_LABELS, type Step } from "./types";

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
                  isDone ? "bg-[var(--success)]" : "bg-[var(--slate-200)]"
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? "bg-[var(--brand-blue)] text-white"
                  : isDone
                    ? "bg-[var(--success)]/10 text-[var(--success)]"
                    : "bg-[var(--slate-100)] text-[var(--slate-400)]"
              }`}
            >
              {isDone ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <span>{index + 1}</span>
              )}
              <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
              {step === "plans" && (
                <span className="ml-1 hidden text-[10px] font-normal opacity-70 sm:inline">
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

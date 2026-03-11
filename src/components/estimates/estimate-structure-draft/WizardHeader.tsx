import { WIZARD_STEPS, type WizardStep } from "./shared";

type WizardHeaderProps = {
  step: WizardStep;
  onClose: () => void;
  isSubmitting: boolean;
};

export function WizardHeader({ step, onClose, isSubmitting }: WizardHeaderProps) {
  return (
    <div className="border-b border-[var(--slate-200)] px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="estimate-structure-draft-dialog-title"
            className="text-lg font-semibold text-[var(--slate-900)]"
          >
            Structure IA
          </h2>
          <nav aria-label="Etapes du wizard" className="mt-3">
            <ol className="flex items-center gap-0">
              {WIZARD_STEPS.map((wizardStep, index) => {
                const isDone = step > wizardStep.step || step === 4;
                const isActive = step === wizardStep.step;

                return (
                  <li key={wizardStep.step} className="flex items-center">
                    {index > 0 && (
                      <div
                        className={`mx-2 h-0.5 w-8 rounded ${
                          isDone
                            ? "bg-emerald-400"
                            : isActive
                              ? "bg-blue-300"
                              : "bg-slate-200"
                        }`}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                          isDone
                            ? "bg-emerald-100 text-emerald-700"
                            : isActive
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {isDone ? "\u2713" : wizardStep.step}
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          isDone
                            ? "text-emerald-700"
                            : isActive
                              ? "text-blue-700"
                              : "text-slate-400"
                        }`}
                      >
                        {wizardStep.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

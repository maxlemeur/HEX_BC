import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { WIZARD_STEPS, type WizardStep } from "./shared";

type WizardHeaderProps = {
  step: WizardStep;
  onClose: () => void;
  isSubmitting: boolean;
};

export function WizardHeader({ step, onClose, isSubmitting }: WizardHeaderProps) {
  return (
    <div className="border-b border-border px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogTitle id="estimate-structure-draft-dialog-title">
            Structure IA
          </DialogTitle>
          <DialogDescription className="mt-1">
            Prévisualisez les lots proposés, choisissez ceux à retenir puis appliquez-les au devis.
          </DialogDescription>
          <nav aria-label="Étapes de l'assistant" className="mt-3">
            <ol className="flex flex-wrap items-center gap-y-2">
              {WIZARD_STEPS.map((wizardStep, index) => {
                const isDone = step > wizardStep.step || step === 4;
                const isActive = step === wizardStep.step;

                return (
                  <li
                    key={wizardStep.step}
                    className="flex items-center"
                    aria-current={isActive ? "step" : undefined}
                  >
                    {index > 0 && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mx-2 h-0.5 w-6 rounded sm:w-8",
                          isDone
                            ? "bg-success"
                            : isActive
                              ? "bg-primary/40"
                              : "bg-border"
                        )}
                      />
                    )}
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                          isDone
                            ? "bg-success-light text-success"
                            : isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                        )}
                      >
                        {isDone ? <CheckIcon className="size-3.5" /> : wizardStep.step}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-medium",
                          isDone
                            ? "text-success"
                            : isActive
                              ? "text-primary"
                              : "text-muted-foreground"
                        )}
                      >
                        {wizardStep.label}
                        {isDone ? <span className="sr-only"> (terminée)</span> : null}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Fermer
        </Button>
      </div>
    </div>
  );
}

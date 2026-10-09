"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ImportStep } from "@/components/estimates/estimate-creation-wizard/ImportStep";
import { PricingStep } from "@/components/estimates/estimate-creation-wizard/PricingStep";
import { ProjectStep } from "@/components/estimates/estimate-creation-wizard/ProjectStep";
import { StepIndicator } from "@/components/estimates/estimate-creation-wizard/StepIndicator";
import {
  STEPS,
  type EstimateCreationResourcesState,
} from "@/components/estimates/estimate-creation-wizard/shared";
import {
  quickCreateEstimateCreation,
  submitEstimateCreation,
} from "@/components/estimates/estimate-creation-wizard/submitEstimateCreation";
import {
  clearEstimateCreationDraft,
  useEstimateCreationDraft,
} from "@/components/estimates/hooks/useEstimateCreationDraft";
import { useEstimateCreationResources } from "@/components/estimates/hooks/useEstimateCreationResources";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2Icon } from "lucide-react";

const QUICK_CREATE_HINT = "Créer directement avec les paramètres par défaut";

export type EstimateCreationResult = {
  linkedDpgfImportWarning?: string;
};

type EstimateCreationWizardProps = {
  onCreated: (versionId: string, result?: EstimateCreationResult) => void;
  projectId?: string;
};

export function EstimateCreationWizard({
  onCreated,
  projectId,
}: EstimateCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const projectNameInputRef = useRef<HTMLInputElement | null>(null);
  const quickCreateHintId = useId();

  const {
    data,
    errors,
    validatedSteps,
    setData,
    setErrors,
    updateField,
    clearErrors,
    validateStep,
    markStepValidated,
  } = useEstimateCreationDraft(projectId);

  const resources: EstimateCreationResourcesState = useEstimateCreationResources({
    projectId,
    setData,
    setErrors,
  });

  useEffect(() => {
    if (currentStep !== 0) return;
    projectNameInputRef.current?.focus();
  }, [currentStep]);

  function goNext() {
    if (!validateStep(currentStep)) return;
    markStepValidated(currentStep);
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  }

  function goBack() {
    clearErrors();
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }

  async function handleSubmit() {
    if (!validateStep(currentStep)) return;
    markStepValidated(currentStep);
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitEstimateCreation({ data, projectId });
      clearEstimateCreationDraft();
      if (result.linkedDpgfImportWarning) {
        onCreated(result.versionId, {
          linkedDpgfImportWarning: result.linkedDpgfImportWarning,
        });
      } else {
        onCreated(result.versionId);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Impossible de créer le chiffrage."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleQuickCreate() {
    if (!projectId && !data.projectName.trim()) {
      setErrors({ projectName: "Le nom du projet est obligatoire." });
      setCurrentStep(0);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const versionId = await quickCreateEstimateCreation({ data, projectId });
      clearEstimateCreationDraft();
      onCreated(versionId);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Impossible de créer le chiffrage."
      );
      setIsSubmitting(false);
      return;
    }
  }

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div>
      <StepIndicator
        currentStep={currentStep}
        validatedSteps={validatedSteps}
        onStepClick={(step) => {
          clearErrors();
          setCurrentStep(step);
        }}
      />

      {submitError && (
        <Alert variant="danger" className="mb-6">
          {submitError}
        </Alert>
      )}

      {errors._root && (
        <Alert variant="danger" className="mb-6">
          {errors._root}
        </Alert>
      )}

      <Card className="p-5 sm:p-8">
        <h2 className="mb-1 text-lg font-semibold text-foreground">
          {STEPS[currentStep].label}
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {STEPS[currentStep].description}
        </p>

        {currentStep === 0 && (
          <ProjectStep
            data={data}
            errors={errors}
            projectId={projectId}
            projectNameInputRef={projectNameInputRef}
            updateField={updateField}
          />
        )}
        {currentStep === 1 && (
          <PricingStep
            data={data}
            errors={errors}
            updateField={updateField}
          />
        )}
        {currentStep === 2 && (
          <ImportStep
            data={data}
            errors={errors}
            projectId={projectId}
            resources={resources}
            updateField={updateField}
          />
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-6">
          <div className="flex items-center gap-3">
            {currentStep > 0 && (
              <Button
                variant="outline"
                size="lg"
                onClick={goBack}
                disabled={isSubmitting}
              >
                Retour
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!isLastStep && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={handleQuickCreate}
                      disabled={isSubmitting}
                      aria-describedby={quickCreateHintId}
                    />
                  }
                >
                  Créer directement
                </TooltipTrigger>
                <TooltipContent>{QUICK_CREATE_HINT}</TooltipContent>
              </Tooltip>
            )}
            {!isLastStep && (
              <span id={quickCreateHintId} className="sr-only">
                {QUICK_CREATE_HINT}
              </span>
            )}

            {isLastStep ? (
              <Button
                variant="primary"
                size="lg"
                onClick={handleSubmit}
                disabled={isSubmitting}
                aria-busy={isSubmitting || undefined}
              >
                {isSubmitting ? (
                  <>
                    <Loader2Icon
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                    Création…
                  </>
                ) : (
                  "Créer le chiffrage"
                )}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={goNext}
                disabled={isSubmitting}
              >
                Suivant
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

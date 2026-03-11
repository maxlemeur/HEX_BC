"use client";

import { useEffect, useRef, useState } from "react";

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

    setIsSubmitting(false);
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
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {submitError}
        </div>
      )}

      {errors._root && (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {errors._root}
        </div>
      )}

      <div className="dashboard-card p-8">
        <h2 className="mb-1 text-lg font-semibold text-[var(--slate-800)]">
          {STEPS[currentStep].label}
        </h2>
        <p className="mb-6 text-sm text-[var(--slate-500)]">
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

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--slate-100)] pt-6">
          <div className="flex items-center gap-3">
            {currentStep > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={goBack}
                disabled={isSubmitting}
              >
                Retour
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!isLastStep && (
              <button
                type="button"
                className="btn btn-ghost text-sm"
                onClick={handleQuickCreate}
                disabled={isSubmitting}
                title="Créer directement avec les paramètres par défaut"
              >
                Créer directement
              </button>
            )}

            {isLastStep ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Création...
                  </>
                ) : (
                  "Créer le chiffrage"
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={goNext}
                disabled={isSubmitting}
              >
                Suivant
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  FIELD_STEP_INDEX,
  HISTORICAL_CREATION_ENGINE,
  STORAGE_KEY,
  getStepValidationErrors,
  initialWizardData,
  normalizeStoredDraft,
  type EstimateCreationEngine,
  type StepErrors,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

function loadDraft(): Partial<WizardData> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeStoredDraft(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function saveDraft(data: WizardData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded, ignore draft persistence failures.
  }
}

export function clearEstimateCreationDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useEstimateCreationDraft(
  projectId?: string,
  creationEngine: EstimateCreationEngine = HISTORICAL_CREATION_ENGINE
) {
  const [validatedSteps, setValidatedSteps] = useState<Set<number>>(
    () => new Set()
  );
  const [data, setData] = useState<WizardData>(() => {
    const initial = initialWizardData(creationEngine);
    const draft = loadDraft();
    if (!draft) return initial;
    const restored = { ...initial, ...draft };
    // Sous-lot 2.10a : un brouillon sans coefficient (enregistré en moteur 2) reprend ceux de la politique.
    return {
      ...restored,
      saleCoefficientFo: restored.saleCoefficientFo || initial.saleCoefficientFo,
      saleCoefficientMo: restored.saleCoefficientMo || initial.saleCoefficientMo,
    };
  });
  const [errors, setErrors] = useState<StepErrors>({});

  useEffect(() => {
    saveDraft(data);
  }, [data]);

  const updateField = useCallback(
    <K extends keyof WizardData>(key: K, value: WizardData[K]) => {
      setData((prev) => ({ ...prev, [key]: value }));
      setValidatedSteps((prev) => {
        if (prev.size === 0) return prev;
        const stepIndex = FIELD_STEP_INDEX[key];
        const next = new Set<number>();
        let didChange = false;

        for (const step of prev) {
          if (step < stepIndex) {
            next.add(step);
          } else {
            didChange = true;
          }
        }

        return didChange ? next : prev;
      });
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  const validateStep = useCallback(
    (step: number) => {
      const stepErrors = getStepValidationErrors(step, data, projectId, creationEngine);
      if (stepErrors) {
        setErrors(stepErrors);
        return false;
      }
      setErrors({});
      return true;
    },
    [creationEngine, data, projectId]
  );

  const markStepValidated = useCallback((step: number) => {
    setValidatedSteps((prev) => new Set(prev).add(step));
  }, []);

  return {
    data,
    errors,
    validatedSteps,
    setData,
    setErrors,
    updateField,
    clearErrors,
    validateStep,
    markStepValidated,
  };
}

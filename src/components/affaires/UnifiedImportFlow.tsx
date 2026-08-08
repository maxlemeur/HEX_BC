"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useMemo, useState } from "react";

import type { ConfirmUnifiedImportFlowResult } from "@/app/dashboard/affaires/_actions/import-flow";
import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import { useUiMode } from "@/hooks/useUiMode";
import type { MappingTemplateExactMatch } from "@/lib/mappings/server";

import { ConfirmationStep } from "./unified-import-flow/ConfirmationStep";
import { MappingStep } from "./unified-import-flow/MappingStep";
import { PreviewStep } from "./unified-import-flow/PreviewStep";
import { ProgressHeader } from "./unified-import-flow/ProgressHeader";
import {
  STEPPER_STEPS_BASE,
  STEPPER_STEPS_WITH_PLANS,
  type PreviewStepResult,
  type Step,
} from "./unified-import-flow/types";
import { UploadStep } from "./unified-import-flow/UploadStep";

const LazyPlansStep = dynamic(
  () =>
    import("@/components/affaires/PlansStep").then((mod) => ({
      default: mod.PlansStep,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-8 text-center text-sm text-[var(--slate-500)]">
        Chargement…
      </div>
    ),
  },
);

export type UnifiedImportFlowProps = {
  projectId: string;
  takeoffEnabled?: boolean;
  onCancel?: () => void;
  onComplete?: (result: ConfirmUnifiedImportFlowResult) => void;
};

export function UnifiedImportFlow({
  projectId,
  takeoffEnabled = false,
  onCancel,
  onComplete,
}: UnifiedImportFlowProps) {
  const { isSimplified } = useUiMode();
  const router = useRouter();

  const [step, setStep] = useState<Step>("upload");
  const [confirmResult, setConfirmResult] =
    useState<ConfirmUnifiedImportFlowResult | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [currentMapping, setCurrentMapping] = useState<ColumnMapping>({});
  const [wasAutoAdvanced, setWasAutoAdvanced] = useState(false);
  const [autoAppliedTemplateMatch, setAutoAppliedTemplateMatch] =
    useState<MappingTemplateExactMatch | null>(null);
  const [previewData, setPreviewData] = useState<PreviewStepResult | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const hasStartedImport = importId !== null;
  const stepperSteps = useMemo(
    () => (takeoffEnabled ? STEPPER_STEPS_WITH_PLANS : STEPPER_STEPS_BASE),
    [takeoffEnabled],
  );

  const handleImportReady = useCallback((id: string) => {
    setImportId(id);
    setCurrentMapping({});
    setWasAutoAdvanced(false);
    setAutoAppliedTemplateMatch(null);
    setPreviewData(null);
    startTransition(() => setStep("mapping"));
  }, []);

  const handleMappingNext = useCallback(
    (result: {
      mapping: ColumnMapping;
      autoAdvanced?: boolean;
      templateExactMatch?: MappingTemplateExactMatch | null;
    }) => {
      setCurrentMapping(result.mapping);
      setWasAutoAdvanced(result.autoAdvanced ?? false);
      setAutoAppliedTemplateMatch(result.templateExactMatch ?? null);
      startTransition(() => setStep("preview"));
    },
    [],
  );

  const handleEditMapping = useCallback(() => {
    setWasAutoAdvanced(false);
    setAutoAppliedTemplateMatch(null);
    startTransition(() => setStep("mapping"));
  }, []);

  const handlePreviewNext = useCallback((data: PreviewStepResult) => {
    setPreviewData(data);
    startTransition(() => setStep("confirmation"));
  }, []);

  const handleConfirmSuccess = useCallback(
    (result: ConfirmUnifiedImportFlowResult) => {
      setConfirmResult(result);

      const shouldShowPlans =
        takeoffEnabled &&
        result.mode === "version_created" &&
        result.projectId &&
        result.versionId;

      if (shouldShowPlans) {
        startTransition(() => setStep("plans"));
      } else if (result.redirectTo) {
        router.push(result.redirectTo);
        router.refresh();
      } else {
        onComplete?.(result);
      }
    },
    [onComplete, router, takeoffEnabled],
  );

  const skipPlansStep = useCallback(() => {
    if (!confirmResult) {
      return;
    }

    if (confirmResult.redirectTo) {
      router.push(confirmResult.redirectTo);
      router.refresh();
      return;
    }

    if (onComplete) {
      onComplete(confirmResult);
      return;
    }

    if (confirmResult.projectId) {
      router.push(`/dashboard/affaires/${confirmResult.projectId}`);
      router.refresh();
    }
  }, [confirmResult, onComplete, router]);

  const finishPlansStep = useCallback(() => {
    if (!confirmResult?.projectId) {
      return;
    }

    if (onComplete) {
      onComplete(confirmResult);
      return;
    }

    router.push(`/dashboard/affaires/${confirmResult.projectId}`);
    router.refresh();
  }, [confirmResult, onComplete, router]);

  const handleBack = useCallback(() => {
    if (step === "plans") {
      return;
    }

    const currentIndex = (stepperSteps as readonly Step[]).indexOf(step);
    if (currentIndex <= 0) {
      if (hasStartedImport) {
        setShowCancelConfirm(true);
        return;
      }

      onCancel?.();
      return;
    }

    startTransition(() => setStep(stepperSteps[currentIndex - 1]));
  }, [hasStartedImport, onCancel, step, stepperSteps]);

  const backButton = (
    <button
      type="button"
      onClick={handleBack}
      className="btn btn-secondary btn-sm inline-flex shrink-0 items-center gap-1.5"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {step === "upload" ? "Annuler" : "Retour"}
    </button>
  );

  return (
    <div className="animate-fade-in space-y-4">
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Annuler l&apos;import ?
            </h3>
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Votre progression sera perdue. Le fichier importe et le mapping en cours ne seront pas conserves.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowCancelConfirm(false)}
              >
                Continuer l&apos;import
              </button>
              <button
                type="button"
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  setShowCancelConfirm(false);
                  onCancel?.();
                }}
              >
                Annuler l&apos;import
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <ProgressHeader currentStep={step} steps={stepperSteps} />
        {step !== "plans" && confirmResult === null && backButton}
      </div>

      {step === "upload" && (
        <UploadStep projectId={projectId} onImportReady={handleImportReady} />
      )}

      {step === "mapping" && importId && (
        <MappingStep
          importId={importId}
          isSimplified={isSimplified}
          initialMapping={currentMapping}
          forceShowMapping={Object.keys(currentMapping).length > 0}
          onBack={handleBack}
          onNext={handleMappingNext}
        />
      )}

      {step === "preview" && importId && (
        <PreviewStep
          importId={importId}
          mapping={currentMapping}
          wasAutoAdvanced={wasAutoAdvanced}
          templateExactMatch={autoAppliedTemplateMatch}
          onEditMapping={handleEditMapping}
          onBack={handleBack}
          onNext={handlePreviewNext}
        />
      )}

      {step === "confirmation" && importId && (
        <ConfirmationStep
          importId={importId}
          projectId={projectId}
          mapping={currentMapping}
          validation={previewData?.validation ?? null}
          structurePreview={previewData?.structurePreview ?? null}
          structurePlan={previewData?.structurePlan ?? { decisions: [] }}
          onBack={handleBack}
          onSuccess={handleConfirmSuccess}
          onResultReady={setConfirmResult}
        />
      )}

      {step === "plans" && confirmResult?.projectId && confirmResult?.versionId && (
        <LazyPlansStep
          projectId={confirmResult.projectId}
          versionId={confirmResult.versionId}
          onSkip={skipPlansStep}
          onContinue={finishPlansStep}
          showSuccessBanner
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/client";
import type {
  TakeoffMappingOverride,
  TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { TakeoffApplyWizardConfirmationStep } from "./takeoff-apply-wizard/TakeoffApplyWizardConfirmationStep";
import { TakeoffApplyWizardPreviewStep } from "./takeoff-apply-wizard/TakeoffApplyWizardPreviewStep";
import { TakeoffApplyWizardStrategyStep } from "./takeoff-apply-wizard/TakeoffApplyWizardStrategyStep";
import { TakeoffApplyWizardTargetStep } from "./takeoff-apply-wizard/TakeoffApplyWizardTargetStep";
import {
  AUTO_OVERRIDE_VALUE,
  buildOverrideFromAction,
  buildSectionOptions,
  serializeTakeoffOverrides,
  toOverrideList,
  type SectionOption,
  type TakeoffApplyStrategy,
  type TakeoffApplyWizardSubmitPayload,
  type WizardStep,
} from "./takeoff-apply-wizard/shared";
import { useTakeoffApplyPreview } from "./takeoff-apply-wizard/useTakeoffApplyPreview";

export type {
  TakeoffApplyStrategy,
  TakeoffApplyWizardSubmitPayload,
} from "./takeoff-apply-wizard/shared";

type TakeoffApplyWizardProps = {
  open: boolean;
  jobId: string;
  versionId: string;
  targetVersionLabel?: string | null;
  includedCount: number;
  excludedCount: number;
  isSubmitting: boolean;
  submitError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: TakeoffApplyWizardSubmitPayload) => Promise<void>;
  items?: TakeoffJobItem[];
  sourceFileName?: string | null;
  jobLevel?: string | null;
  confidenceThreshold?: number;
  isAdmin?: boolean;
  onReturnToReview?: () => void;
  reviewHref?: string;
  presetStrategy?: TakeoffApplyStrategy;
};

export function TakeoffApplyWizard({
  open,
  jobId,
  versionId,
  targetVersionLabel,
  includedCount,
  excludedCount,
  isSubmitting,
  submitError,
  onOpenChange,
  onConfirm,
  items: externalItems,
  sourceFileName,
  jobLevel,
  confidenceThreshold,
  isAdmin = false,
  onReturnToReview,
  reviewHref,
  presetStrategy,
}: TakeoffApplyWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<TakeoffApplyStrategy>("append");
  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [overridesByItemId, setOverridesByItemId] =
    useState<Record<string, TakeoffMappingOverride>>({});
  const overridesRef = useRef<Record<string, TakeoffMappingOverride>>({});
  const [guardResult, setGuardResult] = useState<ApplyGuardResult | null>(null);
  const [overrideJustification, setOverrideJustification] = useState("");
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  const threshold = confidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const isLevelC = jobLevel === "C";
  const hasGuardItems = !!externalItems && externalItems.length > 0;
  const isPreset = presetStrategy !== undefined;
  const totalSteps = isPreset ? 2 : 4;
  const displayStep = isPreset && step === 4 ? 2 : step;

  useEffect(() => {
    overridesRef.current = overridesByItemId;
  }, [overridesByItemId]);

  useEffect(() => {
    if (!open) return;
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [open, step]);

  useEffect(() => {
    if (!isLevelC || !hasGuardItems || step !== 4) {
      setGuardResult(null);
      return;
    }
    const result = checkApplyGuard(externalItems!, threshold);
    setGuardResult(result);
  }, [externalItems, hasGuardItems, isLevelC, step, threshold]);

  const {
    previewData,
    previewError,
    isLoadingPreview,
    previewOverridesSignature,
    refreshPreview,
    resetPreview,
  } = useTakeoffApplyPreview({
    open,
    step,
    isPreset,
    jobId,
    strategy,
    targetSectionId,
    overridesRef,
  });

  useEffect(() => {
    if (!open) return;

    let active = true;

    const loadSections = async () => {
      setStep(1);
      setTargetSectionId(null);
      setStrategy(presetStrategy ?? "append");
      setSectionOptions([]);
      setSectionsError(null);
      setIsLoadingSections(true);
      resetPreview();
      setOverridesByItemId({});
      setGuardResult(null);
      setOverrideJustification("");

      try {
        const estimateItems = await fetchEstimateItemsForVersion(versionId);
        if (!active) return;
        const options = buildSectionOptions(estimateItems);
        setSectionOptions(options);
        setTargetSectionId(options[0]?.id ?? null);
      } catch (error) {
        if (!active) return;
        setSectionsError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les sections du devis."
        );
      } finally {
        if (!active) return;
        setIsLoadingSections(false);
      }
    };

    void loadSections();

    return () => {
      active = false;
    };
  }, [open, presetStrategy, resetPreview, versionId]);

  const selectedSectionLabel = useMemo(() => {
    if (!targetSectionId) return "Aucune section selectionnee";
    return (
      sectionOptions.find((option) => option.id === targetSectionId)?.summaryLabel ??
      "Section cible"
    );
  }, [sectionOptions, targetSectionId]);

  const serializedOverrides = useMemo(
    () => toOverrideList(overridesByItemId),
    [overridesByItemId]
  );
  const currentOverridesSignature = useMemo(
    () => serializeTakeoffOverrides(overridesByItemId),
    [overridesByItemId]
  );
  const sourceByItemId = useMemo(
    () => new Map((externalItems ?? []).map((item) => [item.id, item])),
    [externalItems]
  );
  const overrideCount = previewData?.summary.overridden_count ?? serializedOverrides.length;
  const totalExcludedCount =
    excludedCount + (previewData?.summary.excluded_by_mapping_count ?? 0);
  const hasPreviewReady =
    previewData !== null &&
    previewError === null &&
    isLoadingPreview === false &&
    previewOverridesSignature === currentOverridesSignature;
  const isPreviewStale =
    previewData !== null && previewOverridesSignature !== currentOverridesSignature;
  const guardBlocking =
    isLevelC && guardResult !== null && !guardResult.passed;
  const canProceed = isPreset ? step < 4 && step === 1 : step < 4;
  const canGoBack = isPreset ? step === 4 : step > 1;
  const canConfirm =
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    step === 4 &&
    !guardBlocking;
  const canAdminOverride =
    isAdmin &&
    guardBlocking &&
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    step === 4;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy,
      overrides: serializedOverrides,
    });
  };

  const handleOverrideConfirm = async () => {
    const justification = overrideJustification.trim();
    if (
      !canAdminOverride ||
      justification.length < 10 ||
      justification.length > 500
    ) {
      return;
    }

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy,
      overrides: serializedOverrides,
      override: true,
      overrideJustification: justification,
    });
  };

  const handleOverrideActionChange = (
    item: TakeoffPreviewConversionResponse["items"][number],
    value: string
  ) => {
    if (value === AUTO_OVERRIDE_VALUE) {
      setOverridesByItemId((previous) => {
        const next = { ...previous };
        delete next[item.item_id];
        return next;
      });
      return;
    }

    const action = value as TakeoffMappingOverride["action"];
    setOverridesByItemId((previous) => ({
      ...previous,
      [item.item_id]: buildOverrideFromAction({
        item,
        action,
      }),
    }));
  };

  const handleOverrideParamChange = (
    itemId: string,
    nextOverride: TakeoffMappingOverride
  ) => {
    setOverridesByItemId((previous) => ({
      ...previous,
      [itemId]: nextOverride,
    }));
  };

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content
        containerClassName="sm:max-w-4xl"
        closeOnOverlayClick={!isSubmitting}
      >
        <Modal.Header>
          <div>
            <Modal.Title>Appliquer au devis</Modal.Title>
            <p
              aria-live="polite"
              className="mt-1 text-sm text-[var(--slate-500)]"
            >
              Etape {displayStep} / {totalSteps}
            </p>
          </div>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>

        <Modal.Body>
          <div
            ref={bodyScrollRef}
            data-testid="takeoff-apply-wizard-body"
            role="region"
            aria-label={`Contenu de l'etape ${displayStep} sur ${totalSteps}`}
            tabIndex={0}
            className="max-h-[calc(100dvh-15rem)] space-y-4 overflow-y-auto overscroll-contain pr-1"
          >
            <div
              aria-label="Progression de l'application"
              className="mb-2 flex items-center gap-2"
            >
              {Array.from({ length: totalSteps }, (_, index) => index + 1).map((value) => {
                const active = displayStep === value;
                const done = displayStep > value;
                return (
                  <span
                    key={value}
                    aria-current={active ? "step" : undefined}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                      active
                        ? "bg-[var(--info)] text-white"
                        : done
                          ? "bg-[var(--success)] text-white"
                          : "bg-[var(--slate-100)] text-[var(--slate-500)]"
                    }`}
                  >
                    {value}
                  </span>
                );
              })}
            </div>

            {step === 1 && (
              <TakeoffApplyWizardTargetStep
                targetVersionLabel={targetVersionLabel}
                targetSectionId={targetSectionId}
                sectionOptions={sectionOptions}
                isLoadingSections={isLoadingSections}
                sectionsError={sectionsError}
                isSubmitting={isSubmitting}
                onTargetSectionChange={(value) => {
                  setTargetSectionId(value);
                  resetPreview();
                }}
              />
            )}

            {step === 2 && !isPreset && (
              <TakeoffApplyWizardStrategyStep
                strategy={strategy}
                isSubmitting={isSubmitting}
                onStrategyChange={(value) => {
                  setStrategy(value);
                  resetPreview();
                }}
              />
            )}

            {step === 3 && !isPreset && (
              <TakeoffApplyWizardPreviewStep
                strategy={strategy}
                sourceFileName={sourceFileName}
                includedCount={includedCount}
                previewData={previewData}
                previewError={previewError}
                isLoadingPreview={isLoadingPreview}
                isPreviewStale={isPreviewStale}
                overrideCount={overrideCount}
                overridesByItemId={overridesByItemId}
                sourceByItemId={sourceByItemId}
                isSubmitting={isSubmitting}
                onRefreshPreview={() => void refreshPreview(overridesByItemId)}
                onOverrideActionChange={handleOverrideActionChange}
                onOverrideParamChange={handleOverrideParamChange}
              />
            )}

            {step === 4 && (
              <TakeoffApplyWizardConfirmationStep
                guardBlocking={guardBlocking}
                guardResult={guardResult}
                isAdmin={isAdmin}
                canOverride={canAdminOverride}
                overrideJustification={overrideJustification}
                onReturnToReview={onReturnToReview}
                reviewHref={reviewHref}
                onOverrideJustificationChange={setOverrideJustification}
                onOverrideConfirm={() => void handleOverrideConfirm()}
                isLevelC={isLevelC}
                previewData={previewData}
                includedCount={includedCount}
                totalExcludedCount={totalExcludedCount}
                overrideCount={overrideCount}
                targetVersionLabel={targetVersionLabel}
                selectedSectionLabel={selectedSectionLabel}
                strategy={strategy}
                sourceFileName={sourceFileName}
                hasPreviewReady={hasPreviewReady}
              />
            )}

          </div>
          {submitError && (
            <div className="alert alert-error mt-3" role="alert">
              {submitError}
            </div>
          )}
        </Modal.Body>

        <Modal.Footer>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </button>

          {canGoBack && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setStep(isPreset ? 1 : ((step - 1) as WizardStep))}
              disabled={isSubmitting}
            >
              Retour
            </button>
          )}

          {canProceed ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setStep(isPreset ? 4 : ((step + 1) as WizardStep))}
              disabled={
                isSubmitting ||
                (step === 1 && !targetSectionId) ||
                (step === 3 && (!hasPreviewReady || isLoadingPreview))
              }
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
            >
              {isSubmitting ? "Application..." : "Confirmer l'application"}
            </button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/editor-read-client";
import type {
  TakeoffMappingOverride,
  TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
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
import { TakeoffPageDecisionsPanel } from "./takeoff-apply-wizard/TakeoffPageDecisionsPanel";
import { initialConfirmationDraft, resolveConfirmation, type ConfirmationDraft } from "./takeoff-apply-wizard/page-decisions";
import { fetchTakeoffPageReplacement } from "@/lib/takeoff/page-replacement-client";
import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";
import { forcedOverrideOf, type ForcedDrafts } from "./takeoff-apply-wizard/forced-drafts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import flowMotion from "@/styles/flow-motion.module.css";

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
  /** The guard of the last refusal: a page decision refused (TI-682 lot D) reads the proposal again. */
  submitErrorGuard?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: TakeoffApplyWizardSubmitPayload) => Promise<void>;
  items?: TakeoffJobItem[];
  sourceFileName?: string | null;
  jobLevel?: string | null;
  confidenceThreshold?: number;
  isAdmin?: boolean;
  onReturnToReview?: () => void;
  reviewHref?: string;
  /** The job's targeted review (TI-664 L5c), offered beside the blocked lines. */
  targetedReviewHref?: string;
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
  submitErrorGuard = null,
  onOpenChange,
  onConfirm,
  items: externalItems,
  sourceFileName,
  jobLevel,
  confidenceThreshold,
  isAdmin = false,
  onReturnToReview,
  reviewHref,
  targetedReviewHref,
  presetStrategy,
}: TakeoffApplyWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [stepDirection, setStepDirection] = useState<"forward" | "backward" | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<TakeoffApplyStrategy>("append");
  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [hasDpgfLines, setHasDpgfLines] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [overridesByItemId, setOverridesByItemId] =
    useState<Record<string, TakeoffMappingOverride>>({});
  const overridesRef = useRef<Record<string, TakeoffMappingOverride>>({});
  // TI-686 D10: each blocked line's coded reason and justification, written in the guard panel.
  const [forcedDrafts, setForcedDrafts] = useState<ForcedDrafts>({});
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  // TI-682 lot D: the pages of this takeoff the estimate already holds from another takeoff, decided before the last click.
  const [pageProposal, setPageProposal] = useState<{ key: string; data: TakeoffPageReplacementResponse | null; error: string | null } | null>(null);
  // The estimator's choices at « Pages déjà au devis », one draft for the whole application; kept when the proposal is
  // read again, over the pairs the new proposal makes.
  const [pageChoices, setPageChoices] = useState<ConfirmationDraft>({ pages: {}, pairs: {}, vanished: {}, parts: {}, takes: {} });
  const [pageReadCount, setPageReadCount] = useState(0);

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
      setStepDirection(null);
      setTargetSectionId(null);
      setStrategy(presetStrategy ?? "append");
      setSectionOptions([]);
      setSectionsError(null);
      setIsLoadingSections(true);
      setHasDpgfLines(false);
      resetPreview();
      setOverridesByItemId({});
      setForcedDrafts({});

      try {
        const estimateItems = await fetchEstimateItemsForVersion(versionId);
        if (!active) return;
        const options = buildSectionOptions(estimateItems);
        const dpgf = estimateItems.some(item => item.source_provider === "dpgf");
        setHasDpgfLines(dpgf);
        if (dpgf) setStrategy("merge");
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
    if (!targetSectionId) return "Aucune section sélectionnée";
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
  // Every level (TI-664): the fixed rules block a line on any level, the existing reasons on level C. The lines the
  // mapping plan skips or folds into an assembly are left out first, as the server's guard and the RPC leave them
  // (TI-664 L5c): read from a preview of the current choices only. Without one (loading, or computed for other
  // overrides) every included line is guarded, the safe side.
  const guardResult = useMemo<ApplyGuardResult | null>(() => {
    if (!jobLevel || !hasGuardItems || step !== 4) return null;
    const planned = hasPreviewReady && previewData
      ? new Set(previewData.items.filter((item) => item.action === "skip" || item.action === "apply_assembly").map((item) => item.item_id))
      : null;
    const guarded = planned ? externalItems!.map((item) => (planned.has(item.id) ? { ...item, is_excluded: true } : item)) : externalItems!;
    // A duplicate whose partners the plan all leaves out no longer blocks, as on the server (TI-677).
    return checkApplyGuard(guarded, threshold, { level: jobLevel, leftOut: leftOutByPartners });
  }, [externalItems, hasGuardItems, hasPreviewReady, jobLevel, previewData, step, threshold]);
  const guardBlocking = guardResult !== null && !guardResult.passed;
  const canProceed = isPreset ? step < 4 && step === 1 : step < 4;
  const canGoBack = isPreset ? step === 4 : step > 1;
  // TI-682 lot D: read at the confirmation, with the preview's overrides (the lines that reach the estimate), the section
  // and the strategy; read again after the application refused a page decision (the estimate changed meanwhile).
  const pageRequest = step === 4 && open && (isPreset || hasPreviewReady)
    ? JSON.stringify([strategy, targetSectionId, serializedOverrides, pageReadCount]) : null;
  useEffect(() => {
    if (!pageRequest) return;
    const [requestStrategy, sectionId, overrides] = JSON.parse(pageRequest) as [TakeoffApplyStrategy, string | null, TakeoffMappingOverride[]];
    const controller = new AbortController();
    void fetchTakeoffPageReplacement(jobId, { strategy: requestStrategy, target_section_id: sectionId,
      overrides: overrides.length > 0 ? overrides : undefined }, { signal: controller.signal }).then(
      (data) => setPageProposal({ key: pageRequest, data, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setPageProposal({ key: pageRequest, data: null,
          error: error instanceof Error ? error.message : "Impossible de proposer le remplacement des pages déjà au devis." });
      });
    return () => controller.abort();
  }, [jobId, pageRequest]);
  useEffect(() => {
    if (submitErrorGuard === "page_already_applied" || submitErrorGuard === "page_decision") setPageReadCount((count) => count + 1);
  }, [submitError, submitErrorGuard]);
  const pageRead = pageProposal && pageProposal.key === pageRequest ? pageProposal : null;
  const pageDraft = useMemo(() => {
    if (!pageRead?.data) return null;
    const initial = initialConfirmationDraft(pageRead.data);
    return { ...pageChoices, pairs: { ...initial.pairs, ...pageChoices.pairs } };
  }, [pageRead, pageChoices]);
  const pageResolution = useMemo(() => (pageRead?.data && pageDraft ? resolveConfirmation(pageRead.data, pageDraft) : null), [pageRead, pageDraft]);
  const pageCount = pageRead?.data?.pages.length ?? 0;
  const pagesReady = pageRequest !== null && pageRead !== null && pageRead.error === null && (pageResolution?.complete ?? true);
  // Outside a DPGF version, a page measured again is applied with « Ajouter »: each earlier line is updated in place,
  // and « Fusionner » by title would replace or move lines the estimator did not see paired.
  const appliedStrategy: TakeoffApplyStrategy = pageCount > 0 && !pageRead?.data?.merge_required ? "append" : strategy;
  const pageStrategyNotice = appliedStrategy !== strategy
    ? "« Ajouter » est retenu : chaque ligne précédente est mise à jour à sa place ; la fusion par désignation ou le remplacement de section ne s’appliquent pas à des pages déjà au devis."
    : null;

  const canConfirm =
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    step === 4 &&
    !guardBlocking &&
    pagesReady;
  const canAdminOverride =
    isAdmin &&
    guardBlocking &&
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    step === 4 &&
    pagesReady;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy: appliedStrategy,
      overrides: serializedOverrides,
      pageDecisions: pageResolution?.payload ?? [],
    });
  };

  const handleOverrideConfirm = async () => {
    const forced = guardResult ? forcedOverrideOf(guardResult.blocked_items, forcedDrafts) : null;
    if (!canAdminOverride || !forced) {
      return;
    }

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy: appliedStrategy,
      overrides: serializedOverrides,
      override: true,
      forced,
      pageDecisions: pageResolution?.payload ?? [],
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => handleOpenChange(nextOpen)}
      disablePointerDismissal={isSubmitting}
    >
      <DialogContent size="xl" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Appliquer au devis</DialogTitle>
          <DialogDescription aria-live="polite">
            Étape {displayStep} / {totalSteps}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div
            ref={bodyScrollRef}
            data-testid="takeoff-apply-wizard-body"
            role="region"
            aria-label={`Contenu de l'étape ${displayStep} sur ${totalSteps}`}
            tabIndex={0}
            className="max-h-[calc(100dvh-15rem)] space-y-4 overflow-y-auto overscroll-contain pr-1"
          >
            <div
              role="group"
              aria-label="Progression de l’application"
              className="mb-2 flex items-center gap-2"
            >
              {Array.from({ length: totalSteps }, (_, index) => index + 1).map((value) => {
                const active = displayStep === value;
                const done = displayStep > value;
                return (
                  <span
                    key={value}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-full text-xs font-semibold",
                      active
                        ? "bg-info text-info-foreground"
                        : done
                          ? "bg-success text-success-foreground"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {value}
                  </span>
                );
              })}
            </div>

            <div
              key={step}
              className={cn(
                "space-y-4",
                stepDirection === "forward" && flowMotion.stepForward,
                stepDirection === "backward" && flowMotion.stepBackward
              )}
            >
              {step === 1 && (
                <TakeoffApplyWizardTargetStep
                  targetVersionLabel={targetVersionLabel}
                  targetSectionId={targetSectionId}
                  sectionOptions={sectionOptions}
                  isLoadingSections={isLoadingSections}
                  sectionsError={sectionsError}
                  isSubmitting={isSubmitting}
                  reconcilesDpgf={hasDpgfLines}
                  onTargetSectionChange={(value) => {
                    setTargetSectionId(value);
                    resetPreview();
                  }}
                />
              )}

              {step === 2 && !isPreset && (
                <TakeoffApplyWizardStrategyStep
                  strategy={strategy}
                  reconcilesDpgf={hasDpgfLines}
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
                <TakeoffPageDecisionsPanel proposal={pageRead?.data ?? null} error={pageRead?.error ?? null}
                  loading={pageRequest !== null && pageRead === null} draft={pageDraft} strategyNotice={pageStrategyNotice}
                  disabled={isSubmitting} onDraftChange={setPageChoices} />
              )}

              {step === 4 && (
                <TakeoffApplyWizardConfirmationStep
                  guardBlocking={guardBlocking}
                  guardResult={guardResult}
                  isAdmin={isAdmin}
                  canOverride={canAdminOverride}
                  forcedDrafts={forcedDrafts}
                  onReturnToReview={onReturnToReview}
                  reviewHref={reviewHref}
                  targetedReviewHref={targetedReviewHref}
                  onForcedDraftsChange={setForcedDrafts}
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

          </div>
          {submitError && (
            <Alert variant="danger" className="mt-3">
              {submitError}
            </Alert>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </Button>

          {canGoBack && (
            <Button
              variant="outline"
              onClick={(event) => {
                setStepDirection(event.detail === 0 ? null : "backward");
                setStep(isPreset ? 1 : ((step - 1) as WizardStep));
              }}
              disabled={isSubmitting}
            >
              Retour
            </Button>
          )}

          {canProceed ? (
            <Button
              onClick={(event) => {
                setStepDirection(event.detail === 0 ? null : "forward");
                setStep(isPreset ? 4 : ((step + 1) as WizardStep));
              }}
              disabled={
                isSubmitting ||
                (step === 1 && !targetSectionId) ||
                (step === 3 && (!hasPreviewReady || isLoadingPreview))
              }
            >
              Suivant
            </Button>
          ) : (
            <Button
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
            >
              {isSubmitting ? "Application…" : "Confirmer l'application"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

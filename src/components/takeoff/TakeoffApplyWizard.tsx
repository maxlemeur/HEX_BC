"use client";

import { useEffect, useMemo, useState } from "react";

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
import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { TakeoffApplyDestination } from "./takeoff-apply-wizard/TakeoffApplyDestination";
import { TakeoffApplyGuardSection } from "./takeoff-apply-wizard/TakeoffApplyGuardSection";
import { TakeoffApplyImpact } from "./takeoff-apply-wizard/TakeoffApplyImpact";
import { TakeoffApplyLinesList } from "./takeoff-apply-wizard/TakeoffApplyLinesList";
import {
  buildSectionOptions,
  takeoffApplyStrategyFor,
  type SectionOption,
  type TakeoffApplyStrategy,
  type TakeoffApplyWizardSubmitPayload,
} from "./takeoff-apply-wizard/shared";
import { useTakeoffApplyPreview } from "./takeoff-apply-wizard/useTakeoffApplyPreview";
import { TakeoffPageDecisionsPanel } from "./takeoff-apply-wizard/TakeoffPageDecisionsPanel";
import { TakeoffDpgfTargetsPanel } from "./takeoff-apply-wizard/TakeoffDpgfTargetsPanel";
import { TakeoffDpgfMergePanel } from "./takeoff-apply-wizard/TakeoffDpgfMergePanel";
import { initialConfirmationDraft, resolveConfirmation, type ConfirmationDraft } from "./takeoff-apply-wizard/page-decisions";
import { fetchTakeoffPageReplacement } from "@/lib/takeoff/page-replacement-client";
import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";
import { forcedOverrideOf, type ForcedDrafts } from "./takeoff-apply-wizard/forced-drafts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export type {
  TakeoffApplyStrategy,
  TakeoffApplyWizardSubmitPayload,
} from "./takeoff-apply-wizard/shared";

export const TAKEOFF_APPLY_TITLE = "Envoyer au tableau de chiffrage";

const EMPTY_CHOICES: ConfirmationDraft = { pages: {}, pairs: {}, vanished: {}, parts: {}, takes: {} };

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
  /** TI-723: the job's DPGF reconciliation, offered beside a line the merge would send onto a DPGF line outside it. */
  dpgfReviewHref?: string;
  /** TI-723: opens that reconciliation from a host without its address (the dialog closes first). */
  onOpenDpgfReview?: () => void;
};

/**
 * « Envoyer au tableau de chiffrage » (2026-11-18): one screen, in this order: the destination section; the impact
 * preview, computed without a click for that section; the lines sent, read-only, with what the administrator's mapping
 * rules did; then, only when they have something to show, the decisions (DPGF merge, pages already in the estimate,
 * DPGF lines) and the guard. Nothing is written before « Confirmer l'envoi », enabled only with an up-to-date preview.
 * The strategy follows the version (merge with DPGF lines, append otherwise); no overrides are sent.
 */
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
  dpgfReviewHref,
  onOpenDpgfReview,
}: TakeoffApplyWizardProps) {
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  // Opened mounted (the reviews), the sections are being read from the first frame.
  const [isLoadingSections, setIsLoadingSections] = useState(open);
  const [hasDpgfLines, setHasDpgfLines] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  // TI-686 D10: each blocked line's coded reason and justification, written in the guard panel.
  const [forcedDrafts, setForcedDrafts] = useState<ForcedDrafts>({});
  // TI-682 lot D: the pages of this takeoff the estimate already holds from another takeoff, decided before the last click.
  const [pageProposal, setPageProposal] = useState<{ key: string; data: TakeoffPageReplacementResponse | null; error: string | null } | null>(null);
  // The estimator's choices at « Pages déjà au devis », one draft for the whole application; kept when the proposal is
  // read again, over the pairs the new proposal makes.
  const [pageChoices, setPageChoices] = useState<ConfirmationDraft>(EMPTY_CHOICES);
  const [pageReadCount, setPageReadCount] = useState(0);

  const threshold = confidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const isLevelC = jobLevel === "C";
  const hasGuardItems = !!externalItems && externalItems.length > 0;
  const strategy = takeoffApplyStrategyFor({ holdsDpgfLines: hasDpgfLines });
  // What is computed and sent: the sections read, one chosen. Without one, nothing is computed.
  const ready = open && !isLoadingSections && sectionsError === null && targetSectionId !== null;
  const previewRequest = useMemo(() => (ready && targetSectionId ? { strategy, targetSectionId } : null),
    [ready, strategy, targetSectionId]);
  const { previewData, previewError, isLoadingPreview, retry: retryPreview, reset: resetPreview } =
    useTakeoffApplyPreview({ jobId, request: previewRequest });

  useEffect(() => {
    if (!open) return;

    let active = true;

    const loadSections = async () => {
      setTargetSectionId(null);
      setSectionOptions([]);
      setSectionsError(null);
      setIsLoadingSections(true);
      setHasDpgfLines(false);
      resetPreview();
      setForcedDrafts({});
      setPageProposal(null);
      setPageChoices(EMPTY_CHOICES);

      try {
        const estimateItems = await fetchEstimateItemsForVersion(versionId);
        if (!active) return;
        const options = buildSectionOptions(estimateItems);
        setHasDpgfLines(estimateItems.some(item => item.source_provider === "dpgf"));
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
        if (active) setIsLoadingSections(false);
      }
    };

    void loadSections();

    return () => {
      active = false;
    };
  }, [open, resetPreview, versionId]);

  const selectedSectionLabel = useMemo(() => {
    if (!targetSectionId) return "Aucune section sélectionnée";
    return (
      sectionOptions.find((option) => option.id === targetSectionId)?.summaryLabel ??
      "Section cible"
    );
  }, [sectionOptions, targetSectionId]);

  const sourceByItemId = useMemo(
    () => new Map((externalItems ?? []).map((item) => [item.id, item])),
    [externalItems]
  );
  // Read under the request it was computed for only (useTakeoffApplyPreview): never an earlier section's.
  const hasPreviewReady = previewData !== null && previewError === null && !isLoadingPreview;
  // Every level (TI-664): the fixed rules block a line on any level, the existing reasons on level C. The lines the
  // mapping plan skips or folds into an assembly are left out first, as the server's guard and the RPC leave them
  // (TI-664 L5c): read from the up-to-date preview, before which nothing is judged nor confirmed.
  const guardResult = useMemo<ApplyGuardResult | null>(() => {
    if (!jobLevel || !hasGuardItems || !hasPreviewReady || !previewData) return null;
    const planned = new Set(previewData.items.filter((item) => item.action === "skip" || item.action === "apply_assembly").map((item) => item.item_id));
    const guarded = externalItems!.map((item) => (planned.has(item.id) ? { ...item, is_excluded: true } : item));
    // A duplicate whose partners the plan all leaves out no longer blocks, as on the server (TI-677).
    return checkApplyGuard(guarded, threshold, { level: jobLevel, leftOut: leftOutByPartners });
  }, [externalItems, hasGuardItems, hasPreviewReady, jobLevel, previewData, threshold]);
  const guardBlocking = guardResult !== null && !guardResult.passed;
  // TI-682 lot D: read with the section and the strategy, beside the preview; read again after the application refused a
  // page decision (the estimate changed meanwhile).
  const pageRequest = ready ? JSON.stringify([strategy, targetSectionId, pageReadCount]) : null;
  useEffect(() => {
    if (!pageRequest) return;
    const [requestStrategy, sectionId] = JSON.parse(pageRequest) as [TakeoffApplyStrategy, string | null];
    const controller = new AbortController();
    void fetchTakeoffPageReplacement(jobId, { strategy: requestStrategy, target_section_id: sectionId },
      { signal: controller.signal }).then(
      (data) => setPageProposal({ key: pageRequest, data, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setPageProposal({ key: pageRequest, data: null,
          error: error instanceof Error ? error.message : "Impossible de proposer le remplacement des pages déjà au devis." });
      });
    return () => controller.abort();
  }, [jobId, pageRequest]);
  useEffect(() => {
    // TI-723: a DPGF refusal too (the reconciliation's links may have changed): the proposal names the merges it refuses.
    if (submitErrorGuard === "page_already_applied" || submitErrorGuard === "page_decision" || submitErrorGuard === "dpgf_quantities") {
      setPageReadCount((count) => count + 1);
    }
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
  // Outside a merge the page requires, a page measured again is sent with « append »: each earlier line is updated in
  // place, and a merge by title would replace or move lines the estimator did not see paired.
  const appliedStrategy: TakeoffApplyStrategy = pageCount > 0 && !pageRead?.data?.merge_required ? "append" : strategy;
  const pageStrategyNotice = appliedStrategy !== strategy
    ? "Chaque ligne précédente de ces pages est mise à jour à sa place : aucune fusion par désignation ne s’applique à une page déjà au devis."
    : null;

  const canConfirm =
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    !guardBlocking &&
    pagesReady;
  const canAdminOverride =
    isAdmin &&
    guardBlocking &&
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    pagesReady;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const basePayload = (): TakeoffApplyWizardSubmitPayload => ({
    targetSectionId,
    targetSectionLabel: selectedSectionLabel,
    strategy: appliedStrategy,
    pageDecisions: pageResolution?.payload ?? [],
  });

  const handleConfirm = async () => {
    if (!canConfirm) return;
    await onConfirm(basePayload());
  };

  const handleOverrideConfirm = async () => {
    const forced = guardResult ? forcedOverrideOf(guardResult.blocked_items, forcedDrafts) : null;
    if (!canAdminOverride || !forced) {
      return;
    }
    await onConfirm({ ...basePayload(), override: true, forced });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => handleOpenChange(nextOpen)}
      disablePointerDismissal={isSubmitting}
    >
      <DialogContent size="xl" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>{TAKEOFF_APPLY_TITLE}</DialogTitle>
          <DialogDescription>
            Vérifiez la destination et l’aperçu d’impact, puis confirmez : rien n’est écrit dans le devis avant.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div
            data-testid="takeoff-apply-wizard-body"
            role="region"
            aria-label="Contenu de l’envoi"
            tabIndex={0}
            className="max-h-[calc(100dvh-15rem)] space-y-4 overflow-y-auto overscroll-contain pr-1"
          >
            <TakeoffApplyDestination
              targetVersionLabel={targetVersionLabel}
              targetSectionId={targetSectionId}
              sectionOptions={sectionOptions}
              isLoadingSections={isLoadingSections}
              sectionsError={sectionsError}
              isSubmitting={isSubmitting}
              reconcilesDpgf={hasDpgfLines}
              onTargetSectionChange={setTargetSectionId}
            />

            {previewRequest ? (
              <TakeoffApplyImpact
                previewData={previewData}
                previewError={previewError}
                isLoadingPreview={isLoadingPreview}
                excludedCount={excludedCount}
                sourceFileName={sourceFileName}
                isSubmitting={isSubmitting}
                onRetry={retryPreview}
              />
            ) : null}

            {previewData ? <TakeoffApplyLinesList items={previewData.items} sourceByItemId={sourceByItemId} /> : null}

            {/* TI-723: a line the merge would send onto a DPGF line outside the reconciliation: named before anything is
                sent, the confirmation withheld (the resolution is not complete), the reconciliation offered. */}
            <TakeoffDpgfMergePanel resolution={pageResolution} dpgfReviewHref={dpgfReviewHref}
              onOpenDpgfReview={dpgfReviewHref || onOpenDpgfReview ? () => { handleOpenChange(false); onOpenDpgfReview?.(); } : undefined} />

            <TakeoffPageDecisionsPanel proposal={pageRead?.data ?? null} error={pageRead?.error ?? null}
              loading={pageRequest !== null && pageRead === null} draft={pageDraft} strategyNotice={pageStrategyNotice}
              disabled={isSubmitting} onDraftChange={setPageChoices} />

            {/* TI-682 D4: what each DPGF line the application touches will hold, under the page decisions. */}
            <TakeoffDpgfTargetsPanel proposal={pageRead?.data ?? null} resolution={pageResolution} />

            <TakeoffApplyGuardSection
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
            />

            {includedCount === 0 ? (
              <Alert variant="info">Aucune ligne retenue à envoyer : réintégrez au moins une ligne dans la revue.</Alert>
            ) : null}
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
          <Button
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
          >
            {isSubmitting ? "Envoi…" : "Confirmer l'envoi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

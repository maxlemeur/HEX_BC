"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchEstimateItemsForVersion, type EstimateItem } from "@/lib/estimates/editor-read-client";
import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";
import { isDpgfTargetLine } from "@/lib/takeoff/dpgf-target-line";
import { mergeOverwrites } from "@/lib/takeoff/merge-overwrites";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { TakeoffApplyDestination } from "./takeoff-apply-wizard/TakeoffApplyDestination";
import { TakeoffApplyGuardSection } from "./takeoff-apply-wizard/TakeoffApplyGuardSection";
import { TakeoffApplyImpact } from "./takeoff-apply-wizard/TakeoffApplyImpact";
import { TakeoffApplyLinesList } from "./takeoff-apply-wizard/TakeoffApplyLinesList";
import { TakeoffMergeOverwritePanel } from "./takeoff-apply-wizard/TakeoffMergeOverwritePanel";
import {
  buildSectionOptions,
  mergeSentLinesOf,
  takeoffApplyStrategyFor,
  type SectionOption,
  type TakeoffApplyWizardSubmitPayload,
} from "./takeoff-apply-wizard/shared";
import { useTakeoffApplyReads, type TakeoffApplyGeneration } from "./takeoff-apply-wizard/useTakeoffApplyReads";
import { TakeoffPageDecisionsPanel } from "./takeoff-apply-wizard/TakeoffPageDecisionsPanel";
import { TakeoffDpgfTargetsPanel } from "./takeoff-apply-wizard/TakeoffDpgfTargetsPanel";
import { TakeoffDpgfMergePanel } from "./takeoff-apply-wizard/TakeoffDpgfMergePanel";
import {
  currentConfirmationChoices,
  initialConfirmationDraft,
  NO_CONFIRMATION_CHOICES,
  recordConfirmationChoices,
  resolveConfirmation,
  type ConfirmationDraft,
  type RevisedConfirmationDraft,
} from "./takeoff-apply-wizard/page-decisions";
import { forcedOverrideOf, type ForcedDrafts } from "./takeoff-apply-wizard/forced-drafts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export type {
  TakeoffApplyStrategy,
  TakeoffApplyWizardSubmitPayload,
} from "./takeoff-apply-wizard/shared";

export const TAKEOFF_APPLY_TITLE = "Envoyer au tableau de chiffrage";

/**
 * The refusals after which what the screen computed may no longer hold: a page decision or a DPGF quantity refused, a
 * plan found stale, a DPGF authorization refused (`dpgf_authorization`: a DPGF line appeared under the version's lock, so
 * the strategy changes, or the authorization expired). The sections are read again (the strategy with them), then both
 * computations, before any new click. The other guards of apply-errors.ts name what the review or the version's status
 * must settle (a quantity source, a unit, the draft, the database's guard): this screen reads neither, and reading it
 * again would show the same.
 */
const READ_AGAIN_AFTER = new Set(["page_already_applied", "page_decision", "dpgf_quantities", "atomic_mapping_stale", "dpgf_authorization"]);

/** The section chosen and whether the version holds DPGF lines; `generation` grows with each change (useTakeoffApplyReads). */
type Selection = { generation: number; targetSectionId: string | null; holdsDpgfLines: boolean };

type TakeoffApplyWizardProps = {
  open: boolean;
  jobId: string;
  versionId: string;
  targetVersionLabel?: string | null;
  includedCount: number;
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
 * DPGF lines) and the guard. Nothing is written before « Confirmer l'envoi », enabled only once both computations
 * (the preview, the proposal of the pages already in the estimate) answered for the current selection and the preview
 * retains a line. The strategy follows the version (merge with DPGF lines, append otherwise), as the server reads it when
 * the proposal is computed; the same strategy is previewed, proposed and sent. No overrides are sent. A merge that would
 * overwrite an ordinary line of the destination section withholds both confirmations (TakeoffMergeOverwritePanel).
 *
 * Everything the screen read and every choice made in it belong to one job of one version (the re-check of 0fd09a20,
 * finding 2: shown for job B and back to A, A's earlier answers and choices were current again): another job or version
 * remounts it, empty.
 */
export function TakeoffApplyWizard(props: TakeoffApplyWizardProps) {
  return <TakeoffApplyScreen key={`${props.jobId}\u0000${props.versionId}`} {...props} />;
}

function TakeoffApplyScreen({
  open,
  jobId,
  versionId,
  targetVersionLabel,
  includedCount,
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
  const [selection, setSelection] = useState<Selection>({ generation: 0, targetSectionId: null, holdsDpgfLines: false });
  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  // The version's lines as read with the sections: what « Fusionner » would match in the section (mergeOverwrites).
  const [estimateItems, setEstimateItems] = useState<EstimateItem[]>([]);
  // Opened mounted (the reviews), the sections are being read from the first frame.
  const [isLoadingSections, setIsLoadingSections] = useState(open);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  // Each new read of the sections (« Réessayer », a refusal): the version's DPGF lines, hence the strategy, read again.
  const [sectionsRead, setSectionsRead] = useState(0);
  // TI-686 D10: each blocked line's coded reason and justification, written in the guard panel.
  const [forcedDrafts, setForcedDrafts] = useState<ForcedDrafts>({});
  // TI-682 lot D: the estimator's choices at « Pages déjà au devis », one draft for the whole application, kept when the
  // proposal is read again, except those about a line edited since (RevisedConfirmationDraft).
  const [pageChoices, setPageChoices] = useState<RevisedConfirmationDraft>(NO_CONFIRMATION_CHOICES);

  const threshold = confidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const isLevelC = jobLevel === "C";
  const hasGuardItems = !!externalItems && externalItems.length > 0;
  const { targetSectionId } = selection;
  const strategy = takeoffApplyStrategyFor({ holdsDpgfLines: selection.holdsDpgfLines });

  // A refusal after which the computations may be stale: invalidated at once (the sections are being read), before the
  // render that would show the confirmation enabled.
  const readAgainOn = submitErrorGuard !== null && READ_AGAIN_AFTER.has(submitErrorGuard) ? submitError : null;
  const [refusalRead, setRefusalRead] = useState(readAgainOn);
  if (readAgainOn !== refusalRead) {
    setRefusalRead(readAgainOn);
    if (readAgainOn !== null) {
      setIsLoadingSections(true);
      setSectionsRead((count) => count + 1);
    }
  }

  // What is computed and sent: the sections read, one chosen. Without one, nothing is computed.
  const ready = open && !isLoadingSections && sectionsError === null && targetSectionId !== null;
  const generation = useMemo<TakeoffApplyGeneration | null>(() => (ready && targetSectionId
    ? { id: selection.generation, targetSectionId, strategy } : null), [ready, selection.generation, strategy, targetSectionId]);
  // The proposal found the version's DPGF lines changed since the sections were read: a new generation for that strategy.
  const handleStrategyChange = useCallback((generationId: number, holdsDpgfLines: boolean) => {
    setSelection((current) => (current.generation === generationId
      ? { ...current, holdsDpgfLines, generation: current.generation + 1 } : current));
  }, []);
  const { preview, pages } = useTakeoffApplyReads({ jobId, generation, onStrategyChange: handleStrategyChange });
  // Read under the generation it was computed for only (useTakeoffApplyReads): never an earlier selection's.
  const previewData = preview.data;

  // The callers mount the screen only while it is open, and another job or version remounts it: a read after the first
  // (a refusal, « Réessayer ») is for the same version, the section chosen and the estimator's choices stand.
  useEffect(() => {
    let active = true;

    const loadSections = async () => {
      setSectionsError(null);
      setIsLoadingSections(true);

      try {
        const estimateItems = await fetchEstimateItemsForVersion(versionId);
        if (!active) return;
        const options = buildSectionOptions(estimateItems);
        setSectionOptions(options);
        setEstimateItems(estimateItems);
        // The server's own test of a DPGF version (hasTakeoffDpgfTargetLines): a DPGF line, never a DPGF section alone.
        const holdsDpgfLines = estimateItems.some(isDpgfTargetLine);
        setSelection((current) => ({
          generation: current.generation + 1,
          targetSectionId: options.some((option) => option.id === current.targetSectionId)
            ? current.targetSectionId : options[0]?.id ?? null,
          holdsDpgfLines,
        }));
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
  }, [sectionsRead, versionId]);

  const handleTargetSectionChange = (sectionId: string | null) => {
    setSelection((current) => ({ ...current, targetSectionId: sectionId, generation: current.generation + 1 }));
  };

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
  // Every level (TI-664): the fixed rules block a line on any level, the existing reasons on level C. The lines the
  // mapping plan skips or folds into an assembly are left out first, as the server's guard and the RPC leave them
  // (TI-664 L5c): read from the up-to-date preview, before which nothing is judged nor confirmed.
  const guardResult = useMemo<ApplyGuardResult | null>(() => {
    if (!jobLevel || !hasGuardItems || !previewData) return null;
    const planned = new Set(previewData.items.filter((item) => item.action === "skip" || item.action === "apply_assembly").map((item) => item.item_id));
    const guarded = externalItems!.map((item) => (planned.has(item.id) ? { ...item, is_excluded: true } : item));
    // A duplicate whose partners the plan all leaves out no longer blocks, as on the server (TI-677).
    return checkApplyGuard(guarded, threshold, { level: jobLevel, leftOut: leftOutByPartners });
  }, [externalItems, hasGuardItems, jobLevel, previewData, threshold]);
  const guardBlocking = guardResult !== null && !guardResult.passed;
  // TI-682 lot D: the proposal, read beside the preview for the same generation.
  const proposal = pages.data;
  const pageDraft = useMemo<ConfirmationDraft | null>(() => {
    if (!proposal) return null;
    const initial = initialConfirmationDraft(proposal);
    const choices = currentConfirmationChoices(pageChoices, proposal);
    return { ...choices, pairs: { ...initial.pairs, ...choices.pairs } };
  }, [proposal, pageChoices]);
  const pageResolution = useMemo(() => (proposal && pageDraft ? resolveConfirmation(proposal, pageDraft) : null), [proposal, pageDraft]);
  const pagesReady = proposal !== null && (pageResolution?.complete ?? true);
  const handlePageDraftChange = (next: ConfirmationDraft) => {
    if (proposal) setPageChoices((current) => recordConfirmationChoices(current, next, proposal));
  };
  // The re-check of 0fd09a20 (finding 1): the ordinary lines of the section « Fusionner » would overwrite, read once both
  // computations answered. Accounted for elsewhere: an earlier line the proposal pairs by the merge (its page decision
  // says what it becomes), a DPGF target (the database refuses a merge onto a DPGF line outside its reconciliation).
  const overwrites = useMemo(() => {
    if (strategy !== "merge" || !previewData || !proposal || !targetSectionId) return [];
    const accounted = new Set([...proposal.pairs.filter((pair) => pair.locked).map((pair) => pair.estimate_item_id),
      ...proposal.dpgf_targets.map((target) => target.id)]);
    return mergeOverwrites({ sent: mergeSentLinesOf(previewData), estimateItems, targetSectionId, accounted });
  }, [estimateItems, previewData, proposal, strategy, targetSectionId]);
  const mergeWouldOverwrite = overwrites.length > 0;

  // The lines the current preview retains, not the review's count read before it (another reviewer may have excluded
  // the last one meanwhile): both confirmations wait for at least one.
  const retainedCount = previewData?.summary.included_count ?? 0;
  const nothingRetained = previewData ? retainedCount === 0 : includedCount === 0;
  // What both confirmations need (a retained line implies the current preview answered); the guard then picks one.
  const sendable = retainedCount > 0 && !isSubmitting && pagesReady && !mergeWouldOverwrite;
  const canConfirm = sendable && !guardBlocking;
  const canAdminOverride = sendable && isAdmin && guardBlocking;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const basePayload = (): TakeoffApplyWizardSubmitPayload => ({
    targetSectionId,
    targetSectionLabel: selectedSectionLabel,
    strategy,
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
              reconcilesDpgf={strategy === "merge"}
              onTargetSectionChange={handleTargetSectionChange}
              onRetrySections={() => setSectionsRead((count) => count + 1)}
            />

            <TakeoffMergeOverwritePanel overwrites={overwrites} sectionLabel={selectedSectionLabel} />

            {generation ? (
              <TakeoffApplyImpact
                previewData={previewData}
                previewError={preview.error}
                isLoadingPreview={preview.loading}
                sourceFileName={sourceFileName}
                targetSectionLabel={selectedSectionLabel}
                isSubmitting={isSubmitting}
                onRetry={preview.retry}
              />
            ) : null}

            {previewData ? (
              <TakeoffApplyLinesList items={previewData.items} sourceByItemId={sourceByItemId} reconcilesDpgf={strategy === "merge"} />
            ) : null}

            {/* TI-723: a line the merge would send onto a DPGF line outside the reconciliation: named before anything is
                sent, the confirmation withheld (the resolution is not complete), the reconciliation offered. */}
            <TakeoffDpgfMergePanel resolution={pageResolution} dpgfReviewHref={dpgfReviewHref}
              onOpenDpgfReview={dpgfReviewHref || onOpenDpgfReview ? () => { handleOpenChange(false); onOpenDpgfReview?.(); } : undefined} />

            {generation ? (
              <TakeoffPageDecisionsPanel proposal={proposal} error={pages.error} loading={pages.loading} draft={pageDraft}
                disabled={isSubmitting} onDraftChange={handlePageDraftChange} onRetry={pages.retry} />
            ) : null}

            {/* TI-682 D4: what each DPGF line the application touches will hold, under the page decisions. */}
            <TakeoffDpgfTargetsPanel proposal={proposal} resolution={pageResolution} />

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
              disabled={isSubmitting}
            />

            {nothingRetained ? (
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

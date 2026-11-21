"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/feedback/toast-provider";
import type { TakeoffApplyWizardSubmitPayload } from "@/components/takeoff/TakeoffApplyWizard";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { takeoffApplyLandingHref } from "@/lib/takeoff/apply-landing";
import { applyTakeoffJob, isTakeoffApiError } from "@/lib/takeoff/client";
import { TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY } from "@/lib/takeoff/constants";
import { parseLowConfidenceThreshold } from "@/lib/takeoff/guards";
import { plural } from "@/lib/text/plural";
import type { TakeoffApplyResponse } from "@/lib/takeoff/types";

// Shared by the takeoff review and its targeted review (TI-664 L5c): the low confidence threshold the guard reads,
// and the application of a job through the version's draft lock.

const errorGuardOf = (details: unknown) => {
  const guard = details && typeof details === "object" ? (details as { guard?: unknown }).guard : null;
  return typeof guard === "string" ? guard : null;
};

/** One call of the review: whether it is pending, and its refusal. */
type Outcome = { id: number; submitting: boolean; error: string | null; errorGuard: string | null };

export const TAKEOFF_APPLY_SENT_TITLE = "Métré envoyé au tableau de chiffrage";

/** The toast's counts once sent: « 2 lignes créées, 1 mise à jour, 0 ignorée. » */
export function takeoffApplySentDescription(summary: Pick<TakeoffApplyResponse["summary"], "created_count" | "updated_count" | "ignored_count">) {
  return `${plural(summary.created_count, "ligne créée", "lignes créées")}, ${plural(summary.updated_count, "mise à jour", "mises à jour")}, `
    + `${plural(summary.ignored_count, "ignorée", "ignorées")}.`;
}

/** The tenant's low confidence threshold (feature flag), as the apply guard reads it. */
export function useTakeoffLowConfidenceThreshold() {
  const { enabled, value } = useFeatureFlag(TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY);
  return useMemo(() => parseLowConfidenceThreshold(enabled ? value : null), [enabled, value]);
}

/**
 * Sends a job to the estimate table from its review: takes the version's draft lock (or keeps the editor's), applies,
 * then gives the lock back when it took it. On success, once that lock is given back, the sending is said in a toast
 * (the root layout's provider outlives the review, so whatever became of it); then, only while the review that asked is
 * still shown for this job and version, `onApplied` updates the review and the estimator lands in the estimate table on
 * the takeoff's lines (takeoffApplyLandingHref): Back, or a link, may have left it meanwhile, and the landing would then
 * move the estimator from another screen. Any refusal (the guard's 422, the lock) is `error`. One application at a time:
 * a second call while one is pending does nothing.
 *
 * The lease is scoped by version, user and page identity, and a client-side navigation keeps the identity
 * (draft-lock-session-client.ts): the editor the landing opens adopts a lease still held, and a release landing after
 * that would delete the editor's lease. So the release is awaited before the landing. A failed release leaves a lease of
 * this page's identity, which the editor adopts as its own.
 *
 * What the review shows (`submitting`, `error`, `errorGuard`) belongs to its current call for the job and version shown:
 * another job or version shown since, even the same one again, starts empty, and a call it superseded changes nothing
 * there (the re-check of 0fd09a20, finding 6: a late refusal showed on the next review). The lease that call took is given
 * back all the same.
 */
export function useTakeoffApplyConfirm(input: {
  jobId: string;
  versionId: string | null;
  /** The review's own state once sent, before the landing; only while the review that asked is still shown. */
  onApplied: (response: TakeoffApplyResponse, payload: TakeoffApplyWizardSubmitPayload) => void;
}) {
  const { jobId, versionId, onApplied } = input;
  const toast = useToast();
  const router = useRouter();
  // The call shown, for the job and version shown: emptied when another is shown (adjusted while rendering, before the
  // render that would show the earlier one). TI-682 lot D: `errorGuard` is the guard of a refusal (a page decision
  // refused): the wizard reads its proposal again.
  const scope = `${jobId}\u0000${versionId}`;
  const [shown, setShown] = useState<{ scope: string; call: Outcome | null }>({ scope, call: null });
  if (shown.scope !== scope) setShown({ scope, call: null });
  const outcome = shown.scope === scope ? shown.call : null;
  // Set synchronously, before any await: two clicks in the same frame start one application.
  const pending = useRef(false);
  // The review's current call; any other (the review left, another job or version shown) no longer lands.
  const current = useRef(0);
  useEffect(() => {
    const call = current;
    return () => { call.current += 1; };
  }, [jobId, versionId]);
  const setError = useCallback((error: string | null) => {
    setShown((view) => ({ ...view, call: view.call ? { ...view.call, error, errorGuard: null } : null }));
  }, []);
  const confirm = useCallback(async (payload: TakeoffApplyWizardSubmitPayload) => {
    if (!versionId || pending.current) return;
    pending.current = true;
    const call = ++current.current;
    setShown({ scope, call: { id: call, submitting: true, error: null, errorGuard: null } });
    // Only while this call is still the one shown.
    const show = (next: Partial<Omit<Outcome, "id">>) =>
      setShown((view) => (view.call?.id === call ? { ...view, call: { ...view.call, ...next } } : view));
    let shouldReleaseDraftLock = false;
    let response: TakeoffApplyResponse | null = null;
    try {
      const lockResult = await ensureTakeoffApplyDraftLock(versionId);
      if (!lockResult.acquired) {
        show({ error: lockResult.errorMessage ?? "Impossible d'acquérir le verrou de brouillon de la version cible." });
        return;
      }
      shouldReleaseDraftLock = lockResult.shouldRelease;
      // The administrator's mapping rules apply as the server reads them: the screen sends no overrides.
      response = await applyTakeoffJob(jobId, {
        strategy: payload.strategy,
        target_section_id: payload.targetSectionId,
        override: payload.override,
        forced_justifications: payload.forced?.forced_justifications,
        forced_items: payload.forced?.forced_items,
        page_decisions: payload.pageDecisions,
      }, versionId);
    } catch (err) {
      show({ error: isTakeoffApiError(err) ? err.message : "Erreur lors de l'envoi au tableau de chiffrage.",
        errorGuard: isTakeoffApiError(err) ? errorGuardOf(err.details) : null });
    } finally {
      // Whatever became of the review: a lease this call took is always given back.
      if (shouldReleaseDraftLock) {
        await releaseEstimateDraftLock(versionId).catch(() => false);
      }
      pending.current = false;
      show({ submitting: false });
    }
    if (!response) return;
    toast.success({ title: TAKEOFF_APPLY_SENT_TITLE, description: takeoffApplySentDescription(response.summary) });
    if (current.current !== call) return;
    onApplied(response, payload);
    router.push(takeoffApplyLandingHref(versionId, response.summary));
  }, [jobId, onApplied, router, scope, toast, versionId]);
  return { submitting: outcome?.submitting ?? false, error: outcome?.error ?? null, errorGuard: outcome?.errorGuard ?? null, setError,
    confirm };
}

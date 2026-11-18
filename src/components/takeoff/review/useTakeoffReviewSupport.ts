"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TakeoffApplyWizardSubmitPayload } from "@/components/takeoff/TakeoffApplyWizard";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { applyTakeoffJob, isTakeoffApiError } from "@/lib/takeoff/client";
import { TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY } from "@/lib/takeoff/constants";
import { parseLowConfidenceThreshold } from "@/lib/takeoff/guards";
import type { TakeoffApplyResponse } from "@/lib/takeoff/types";

// Shared by the takeoff review and its targeted review (TI-664 L5c): the low confidence threshold the guard reads,
// and the application of a job through the version's draft lock.

const errorGuardOf = (details: unknown) => {
  const guard = details && typeof details === "object" ? (details as { guard?: unknown }).guard : null;
  return typeof guard === "string" ? guard : null;
};

export const TAKEOFF_APPLY_SENT_TITLE = "Métré envoyé au tableau de chiffrage";

const counted = (count: number, singular: string, plural: string) => `${count} ${count > 1 ? plural : singular}`;

/** The toast's counts once sent: « 2 lignes créées, 1 mise à jour, 0 ignorée. » */
export function takeoffApplySentDescription(summary: Pick<TakeoffApplyResponse["summary"], "created_count" | "updated_count" | "ignored_count">) {
  return `${counted(summary.created_count, "ligne créée", "lignes créées")}, ${counted(summary.updated_count, "mise à jour", "mises à jour")}, `
    + `${counted(summary.ignored_count, "ignorée", "ignorées")}.`;
}

/** The tenant's low confidence threshold (feature flag), as the apply guard reads it. */
export function useTakeoffLowConfidenceThreshold() {
  const { enabled, value } = useFeatureFlag(TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY);
  return useMemo(() => parseLowConfidenceThreshold(enabled ? value : null), [enabled, value]);
}

/**
 * Sends a job to the estimate table from its review: takes the version's draft lock (or keeps the editor's), applies,
 * then gives the lock back when it took it. On success `onSent` runs (the toast, whatever became of the review), then
 * `onApplied` (the landing in the editor), once that lock is given back and only while the review that asked is still
 * shown for this job and version: Back, or a link, may have left it meanwhile, and the landing would then move the
 * estimator from another screen. Any refusal (the guard's 422, the lock) is `error`. One application at a time: a second
 * call while one is pending does nothing.
 *
 * The lease is scoped by version, user and page identity, and a client-side navigation keeps the identity
 * (draft-lock-session-client.ts): the editor `onApplied` opens adopts a lease still held, and a release landing after
 * that would delete the editor's lease. So the release is awaited before `onApplied`. A failed release leaves a lease of
 * this page's identity, which the editor adopts as its own.
 */
export function useTakeoffApplyConfirm(input: {
  jobId: string;
  versionId: string;
  onApplied: (response: TakeoffApplyResponse, payload: TakeoffApplyWizardSubmitPayload) => void;
  /** Runs on every success, before `onApplied`, even once the review is left: the sending happened. */
  onSent?: (response: TakeoffApplyResponse) => void;
}) {
  const { jobId, versionId, onApplied, onSent } = input;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // TI-682 lot D: the guard of a refusal (a page decision refused): the wizard reads its proposal again.
  const [errorGuard, setErrorGuard] = useState<string | null>(null);
  // Set synchronously, before any await: two clicks in the same frame start one application.
  const pending = useRef(false);
  // The review's current call; any other (the review left, another job or version shown) no longer lands.
  const current = useRef(0);
  useEffect(() => {
    const call = current;
    return () => { call.current += 1; };
  }, [jobId, versionId]);
  const confirm = useCallback(async (payload: TakeoffApplyWizardSubmitPayload) => {
    if (pending.current) return;
    pending.current = true;
    const call = ++current.current;
    setSubmitting(true);
    setError(null);
    setErrorGuard(null);
    let shouldReleaseDraftLock = false;
    let response: TakeoffApplyResponse | null = null;
    try {
      const lockResult = await ensureTakeoffApplyDraftLock(versionId);
      if (!lockResult.acquired) {
        setError(lockResult.errorMessage ?? "Impossible d'acquérir le verrou de brouillon de la version cible.");
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
      setError(isTakeoffApiError(err) ? err.message : "Erreur lors de l'envoi au tableau de chiffrage.");
      setErrorGuard(isTakeoffApiError(err) ? errorGuardOf(err.details) : null);
    } finally {
      // Whatever became of the review: a lease this call took is always given back.
      if (shouldReleaseDraftLock) {
        await releaseEstimateDraftLock(versionId).catch(() => false);
      }
      pending.current = false;
      setSubmitting(false);
    }
    if (!response) return;
    onSent?.(response);
    if (current.current === call) onApplied(response, payload);
  }, [jobId, onApplied, onSent, versionId]);
  return { submitting, error, errorGuard, setError, confirm };
}

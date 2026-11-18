"use client";

import { useCallback, useMemo, useState } from "react";

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
 * then gives the lock back when it took it. `onApplied` runs on success only, once that lock is given back; any refusal
 * (the guard's 422, the lock) is `error`.
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
}) {
  const { jobId, versionId, onApplied } = input;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // TI-682 lot D: the guard of a refusal (a page decision refused): the wizard reads its proposal again.
  const [errorGuard, setErrorGuard] = useState<string | null>(null);
  const confirm = useCallback(async (payload: TakeoffApplyWizardSubmitPayload) => {
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
      if (shouldReleaseDraftLock) {
        await releaseEstimateDraftLock(versionId).catch(() => false);
      }
      setSubmitting(false);
    }
    if (response) onApplied(response, payload);
  }, [jobId, onApplied, versionId]);
  return { submitting, error, errorGuard, setError, confirm };
}

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

/** The tenant's low confidence threshold (feature flag), as the apply guard reads it. */
export function useTakeoffLowConfidenceThreshold() {
  const { enabled, value } = useFeatureFlag(TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY);
  return useMemo(() => parseLowConfidenceThreshold(enabled ? value : null), [enabled, value]);
}

/**
 * Applies a job from its review: takes the version's draft lock (or keeps the editor's), applies, then gives the lock
 * back when it took it. `onApplied` runs on success only; any refusal (the guard's 422, the lock) is `error`.
 */
export function useTakeoffApplyConfirm(input: {
  jobId: string;
  versionId: string;
  onApplied: (response: TakeoffApplyResponse, payload: TakeoffApplyWizardSubmitPayload) => void;
}) {
  const { jobId, versionId, onApplied } = input;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useCallback(async (payload: TakeoffApplyWizardSubmitPayload) => {
    setSubmitting(true);
    setError(null);
    let shouldReleaseDraftLock = false;
    try {
      const lockResult = await ensureTakeoffApplyDraftLock(versionId);
      if (!lockResult.acquired) {
        setError(lockResult.errorMessage ?? "Impossible d'acquérir le verrou de brouillon de la version cible.");
        return;
      }
      shouldReleaseDraftLock = lockResult.shouldRelease;
      const response = await applyTakeoffJob(jobId, {
        strategy: payload.strategy,
        target_section_id: payload.targetSectionId,
        overrides: payload.overrides.length > 0 ? payload.overrides : undefined,
        override: payload.override,
        override_justification: payload.overrideJustification,
      }, versionId);
      onApplied(response, payload);
    } catch (err) {
      setError(isTakeoffApiError(err) ? err.message : "Erreur lors de l'application.");
    } finally {
      if (shouldReleaseDraftLock) {
        void releaseEstimateDraftLock(versionId).catch(() => false);
      }
      setSubmitting(false);
    }
  }, [jobId, onApplied, versionId]);
  return { submitting, error, setError, confirm };
}

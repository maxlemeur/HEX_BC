import { describe, expect, it } from "vitest";

import { buildTakeoffContinuitySnapshot } from "@/lib/takeoff/continuity";
import type { TakeoffResumeDecision } from "@/lib/takeoff/operator-state";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

function job(patch: Partial<TakeoffActivityCenterJobRow>): TakeoffActivityCenterJobRow {
  return {
    jobId: "job-old", analysisCompletion: null, estimateVersionId: "v1", versionLabel: "V1", lotLabel: null, planSetLabel: null,
    levelLabel: "Détaillé", processingStrategy: "sync", providerBatchState: null, providerBatchUpdatedAt: null,
    statusLabel: "Analyse terminée", statusRaw: "completed", technicalStatusRaw: "completed", canCancel: false, canResubmit: false,
    resume: { action: "none", reason: "not_stopped", availableAt: null }, errorCode: null, nextRetryAt: null, itemCount: 2,
    coveragePercent: null, exceptionCount: 0, confidenceLabel: "Élevée", appliedCount: 0, createdAt: "2026-11-20T07:00:00.000Z",
    carriedOverFrom: null, neverApplied: true, retryCount: 0, ...patch,
  };
}

function partialFailure(resume: TakeoffResumeDecision | undefined) {
  return buildTakeoffContinuitySnapshot({ jobs: [job({}), job({
    jobId: "job-new", versionLabel: "V2", statusLabel: "Échec à corriger", statusRaw: "action_required", technicalStatusRaw: "failed",
    errorCode: "AI_TIMEOUT", createdAt: "2026-11-20T09:00:00.000Z", resume, canResubmit: resume?.action === "retry_now",
  })] });
}

// Fix round 2, point 1: the affaire's overview shows a stopped analysis with its decision, or with no instruction.
describe("buildTakeoffContinuitySnapshot for a partial failure", () => {
  it.each([
    [{ action: "retry_now", reason: "retry_available", availableAt: null }, "Reprendre l'analyse", /Vous pouvez soumettre cette analyse à nouveau/],
    [{ action: "wait_retry", reason: "retry_scheduled", availableAt: "2026-11-21T10:00:15.000Z" }, "Suivre la reprise",
      /Une reprise automatique est programmée/],
    [{ action: "new_analysis", reason: "analysis_closed", availableAt: null }, "Ouvrir le suivi du métré", /Cette analyse est close/],
    [{ action: "none", reason: "read_only", availableAt: null }, "Ouvrir le suivi du métré", /Ce profil ne peut pas relancer l’analyse/],
  ] as const)("follows the decision %o", (resume, actionLabel, text) => {
    const snapshot = partialFailure(resume);
    expect(snapshot).toMatchObject({ title: "Reprise après échec partiel", actionLabel });
    expect(snapshot?.description).toMatch(/^Les analyses déjà acquises restent visibles\./);
    expect(snapshot?.description).toMatch(text);
    expect(snapshot?.description).not.toMatch(/Corrigez ou relancez/);
  });

  it("gives no instruction without a decision", () => {
    const snapshot = partialFailure(undefined);
    expect(snapshot?.actionLabel).toBe("Ouvrir le suivi du métré");
    expect(snapshot?.description).toMatch(/Rechargez la page/);
  });
});

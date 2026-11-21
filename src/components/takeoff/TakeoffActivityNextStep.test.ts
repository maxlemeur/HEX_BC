import { describe, expect, it } from "vitest";

import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

import { resolveTakeoffNextStep } from "./TakeoffActivityNextStep";

function job(patch: Partial<TakeoffActivityCenterJobRow>): TakeoffActivityCenterJobRow {
  return {
    jobId: "11111111-1111-4111-8111-111111111111", analysisCompletion: null, estimateVersionId: null, versionLabel: "Sans devis",
    lotLabel: null, planSetLabel: null, levelLabel: "Détaillé", processingStrategy: "sync", providerBatchState: null,
    providerBatchUpdatedAt: null, statusLabel: "Échec à corriger", statusRaw: "action_required", technicalStatusRaw: "failed",
    canCancel: false, canResubmit: false, resume: { action: "none", reason: "read_only", availableAt: null }, errorCode: "AI_TIMEOUT",
    nextRetryAt: null, itemCount: 0, coveragePercent: null, exceptionCount: 0, confidenceLabel: "Faible", appliedCount: 0,
    createdAt: "2026-11-20T07:00:00.000Z", carriedOverFrom: null, neverApplied: false, retryCount: 1,
    ...patch,
  };
}

function step(latestJob: TakeoffActivityCenterJobRow) {
  return resolveTakeoffNextStep({
    projectId: "project-1", latestJob, canLaunch: true, firstUsablePlanSetName: "Plans", planSetCount: 1,
    latestJobContext: { jobId: latestJob.jobId, reviewVersionId: "v", failureReasonLabel: "Délai dépassé. Relancez l'analyse ou restreignez les sources." },
  });
}

// Fix round 1, point 1: the banner says what the latest analysis's decision says, and offers only what it allows.
describe("resolveTakeoffNextStep for a stopped analysis", () => {
  it("offers no new analysis while the automatic retry is awaited", () => {
    const next = step(job({ resume: { action: "wait_retry", reason: "retry_scheduled", availableAt: "2026-11-21T10:00:15.000Z" } }));
    expect(next.action).toBeNull();
    expect(next.description).toMatch(/Une reprise automatique est programmée/);
    expect(next.description).not.toMatch(/Relancez|Préparez/);
  });

  it("offers nothing to a member who cannot act", () => {
    const next = step(job({ resume: { action: "none", reason: "read_only", availableAt: null } }));
    expect(next.action).toBeNull();
    expect(next.description).toMatch(/Ce profil ne peut pas relancer l’analyse/);
  });

  it("points to the row when the same analysis can be submitted again", () => {
    const next = step(job({ canResubmit: true, resume: { action: "retry_now", reason: "retry_available", availableAt: null } }));
    expect(next.action).toBeNull();
    expect(next.description).toMatch(/Vous pouvez soumettre cette analyse à nouveau/);
  });

  it("offers a new analysis only when the decision does", () => {
    const closed = step(job({ errorCode: "AI_PROVIDER", resume: { action: "new_analysis", reason: "analysis_closed", availableAt: null } }));
    expect(closed.action).toEqual({ kind: "launch", label: "Préparer un nouveau métré" });
    const canceledForReader = step(job({ technicalStatusRaw: "canceled", errorCode: null,
      resume: { action: "none", reason: "analysis_closed", availableAt: null } }));
    expect(canceledForReader.action).toBeNull();
  });

  it("offers nothing and asks to reload when the answer has no decision", () => {
    const { resume: _resume, ...old } = job({});
    void _resume;
    const next = step(old as TakeoffActivityCenterJobRow);
    expect(next.action).toBeNull();
    expect(next.description).toMatch(/Rechargez la page/);
  });
});

import { describe, expect, it } from "vitest";

import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

import {
  FIXTURE_PROJECT, fixtureActivityJob, fixtureJob, fixtureRequest, fixtureThreePlans, fixtureUnit,
} from "@/lib/takeoff/request-activity.test-fixtures";

import { resolveTakeoffNextStep, resolveTakeoffRequestStep } from "./TakeoffActivityNextStep";

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

// Lot 3 PR 4: the step follows the latest launch request and its plans, never the latest job by date.
describe("resolveTakeoffRequestStep", () => {
  const requestStep = (request: Parameters<typeof resolveTakeoffRequestStep>[0]["request"], canLaunch = true) =>
    resolveTakeoffRequestStep({ projectId: FIXTURE_PROJECT, request, canLaunch });

  it("opens the review of the first plan read while the others are still read", () => {
    const next = requestStep(fixtureThreePlans());
    expect(next).toMatchObject({
      title: "Premiers plans prêts à revoir",
      action: { kind: "href", label: "Revoir Plan A — niveau 1.pdf", href: `/dashboard/affaires/${FIXTURE_PROJECT}/takeoff/${fixtureJob("a")}/review` },
    });
    expect(next?.description).toBe("1 plan lu sur 3 · 1 en lecture · 1 en attente. Les autres plans sont encore lus : cette page se met à jour toute seule.");
  });

  it("keeps the review of a read plan when a later plan failed", () => {
    const request = fixtureRequest([
      fixtureUnit("a", 1, { state: "succeeded", reviewable: true }), fixtureUnit("b", 2, { state: "failed" }),
    ], [fixtureActivityJob("a", { itemCount: 2 }), fixtureActivityJob("b", { resume: { action: "new_analysis", reason: "analysis_closed", availableAt: null } })],
    { state: "closed", outcome: "partial", closedAt: "2026-11-21T09:10:00.000Z" });
    expect(requestStep(request)).toMatchObject({ title: "Vérifier le métré proposé", action: { kind: "href", label: "Revoir Plan A — niveau 1.pdf" } });
  });

  it("says the analysis runs when no plan is read yet, without an action", () => {
    expect(requestStep(fixtureRequest([fixtureUnit("a", 1, { state: "running" })], [fixtureActivityJob("a")])))
      .toMatchObject({ title: "Analyse en cours", action: null });
  });

  it("offers a new analysis after nothing was read only when a plan's decision offers it to this member", () => {
    const failed = (resume: { action: "new_analysis" | "none"; reason: "analysis_closed"; availableAt: null }) => fixtureRequest(
      [fixtureUnit("a", 1, { state: "failed" })], [fixtureActivityJob("a", { resume })],
      { state: "closed", outcome: "failure", closedAt: "2026-11-21T09:10:00.000Z" });
    expect(requestStep(failed({ action: "new_analysis", reason: "analysis_closed", availableAt: null })))
      .toMatchObject({ title: "Aucun plan n’a pu être lu", action: { kind: "launch" } });
    expect(requestStep(failed({ action: "none", reason: "analysis_closed", availableAt: null }))?.action).toBeNull();
  });

  // Review finding 4: read plans whose analyses the member does not read are not « plans that could not be read ».
  it("says the plans were read when their reviews are out of this member's reach", () => {
    const request = fixtureRequest([fixtureUnit("a", 1, { state: "succeeded", reviewable: true })], [],
      { state: "closed", outcome: "success", closedAt: "2026-11-21T09:10:00.000Z" });
    expect(requestStep(request)).toMatchObject({ title: "Plans lus", action: null });
    expect(requestStep(request)?.description).toBe("1 plan lu sur 1. Leur revue n’est pas accessible avec votre profil.");
  });

  it("words a grouped analysis as one analysis", () => {
    const grouped = fixtureRequest([fixtureUnit("d", 1, { key: "grouped", state: "succeeded", reviewable: true })], [fixtureActivityJob("d", { itemCount: 2 })]);
    const view = { ...grouped, units: { ...grouped.units!, format: "grouped" as const }, groupedPlans: [
      { planFileId: null, name: "A.pdf", pages: [] }, { planFileId: null, name: "B.pdf", pages: [] }] };
    expect(requestStep(view)).toMatchObject({ title: "Vérifier le métré proposé", action: { label: "Ouvrir la revue" } });
    const running = { ...view, units: { ...view.units, units: [{ ...view.units.units[0], state: "running" as const, reviewable: false }] } };
    expect(requestStep(running)?.description).not.toMatch(/un par un|autres plans/);
  });

  it("says the request waits, or did not start, with its reason", () => {
    const blocked = (code: string) => fixtureRequest(null, [], { reason: { code, message: `Motif ${code}` } });
    expect(requestStep(blocked("ANOTHER_ANALYSIS_RUNNING"))).toMatchObject({ title: "Métré en attente", description: "Motif ANOTHER_ANALYSIS_RUNNING" });
    expect(requestStep(blocked("MANDATE_REQUIRED"))).toMatchObject({ title: "Métré non démarré", action: null });
  });

  it("gives way to the job's own step when the request was set aside", () => {
    expect(requestStep(fixtureRequest(null, [], { state: "superseded" }))).toBeNull();
    expect(requestStep(null)).toBeNull();
  });
});

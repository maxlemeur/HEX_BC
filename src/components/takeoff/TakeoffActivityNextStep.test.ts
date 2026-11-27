import { describe, expect, it } from "vitest";

import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";
import { TAKEOFF_KEY_STOP_MESSAGES } from "@/lib/takeoff/visible-status";

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

  // Follow-up of #684's review: the banner reads the job's stored message through the server, like the activity's plan.
  it.each(Object.entries(TAKEOFF_KEY_STOP_MESSAGES))("tells why a request a key paid stopped, as its worker recorded it (%s)", (_reason, message) => {
    const latestJob = job({ errorCode: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", resume: { action: "none", reason: "read_only", availableAt: null } });
    const next = resolveTakeoffNextStep({ projectId: "project-1", latestJob, canLaunch: true, firstUsablePlanSetName: "Plans",
      planSetCount: 1, latestJobContext: { jobId: latestJob.jobId, reviewVersionId: "v", failureReasonLabel: message } });
    expect(next.description).toBe(`La dernière analyse n’a pas abouti. ${message} Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur.`);
    expect(next.description).not.toMatch(/budget/);
  });

  it("keeps the fact of the code for any other label, and for another job's", () => {
    const latestJob = job({ errorCode: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED" });
    const budget = "La dernière analyse n’a pas abouti. Le budget de cette analyse était épuisé : ce plan n’a pas été lu en entier.";
    const withLabel = (failureReasonLabel: string, jobId = latestJob.jobId) => resolveTakeoffNextStep({ projectId: "project-1", latestJob,
      canLaunch: true, firstUsablePlanSetName: "Plans", planSetCount: 1, latestJobContext: { jobId, reviewVersionId: "v", failureReasonLabel } });
    expect(withLabel("FICTIONAL_PLAN_MARKER").description).toMatch(new RegExp(`^${budget}`, "u"));
    expect(withLabel(TAKEOFF_KEY_STOP_MESSAGES.callOverBound, "22222222-2222-4222-8222-222222222222").description)
      .toMatch(new RegExp(`^${budget}`, "u"));
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
    expect(requestStep(request)?.description).toBe("Plan A — niveau 1.pdf · Lu. La revue n’est pas accessible avec votre profil.");
  });

  // Fix round 1: A sent and B read but out of this member's reach: never « the plans read are in the estimate ».
  it("says only that the plans this member reviews are sent when another read plan is out of their reach", () => {
    const request = fixtureRequest([fixtureUnit("a", 1, { state: "succeeded", reviewable: true }),
      fixtureUnit("b", 2, { state: "succeeded", reviewable: true })], [fixtureActivityJob("a", { applied: true, itemCount: 2 })],
    { state: "closed", outcome: "success", closedAt: "2026-11-21T09:10:00.000Z" });
    const next = requestStep(request);
    expect(next?.title).toBe("Plans lus");
    expect(next?.description).not.toContain("Les plans lus sont dans le devis");
    expect(next?.description).toContain("les autres ne sont pas accessibles avec votre profil");
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

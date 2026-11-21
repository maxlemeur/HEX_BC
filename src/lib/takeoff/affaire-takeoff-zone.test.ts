import { describe, expect, it } from "vitest";

import {
  buildAffaireTakeoffZone,
  type AffaireTakeoffZoneData,
  type AffaireTakeoffZoneInput,
  type AffaireTakeoffZoneJob,
  type AffaireTakeoffZoneRequest,
} from "@/lib/takeoff/affaire-takeoff-zone";
import { formatTakeoffCompletionDate } from "@/lib/takeoff/completion-outcome";
import { describeTakeoffLaunchReason } from "@/lib/takeoff/launch-request";

const projectId = "11111111-1111-4111-8111-111111111111";
const reviewOf = (jobId: string) => `/dashboard/affaires/${projectId}/takeoff/${jobId}/review`;

function job(overrides: Partial<AffaireTakeoffZoneJob> = {}): AffaireTakeoffZoneJob {
  return {
    id: "22222222-2222-4222-8222-222222222222", name: "Plans RDC.pdf", status: "completed", statusLabel: "Analyse terminée",
    failure: null, reviewHref: reviewOf("22222222-2222-4222-8222-222222222222"),
    createdAt: "2026-11-21T08:00:00.000Z", finishedAt: "2026-11-21T08:20:00.000Z", ...overrides,
  };
}

function request(overrides: Partial<AffaireTakeoffZoneRequest> = {}): AffaireTakeoffZoneRequest {
  return {
    id: "33333333-3333-4333-8333-333333333333", origin: "automatic", state: "blocked", mandateRevision: 2,
    reason: "MANDATE_REQUIRED", pieces: [], hasPayer: false, payerIsViewer: false,
    createdAt: "2026-11-21T08:00:00.000Z", admittedAt: null, closedAt: null, outcome: null,
    units: { expected: null, succeeded: 0, failed: 0, canceled: 0 }, action: "none", jobs: [], coverage: null,
    completionEventId: null, ...overrides,
  };
}

function data(overrides: Partial<AffaireTakeoffZoneData> = {}): AffaireTakeoffZoneData {
  return { active: true, canOperate: true, confirmedBeforeActivation: false, request: null, dossierChangedSinceAnalysis: null,
    latestJob: null, latestReview: null, latestEnd: null, ...overrides };
}

function zone(overrides: Partial<AffaireTakeoffZoneInput> = {}) {
  return buildAffaireTakeoffZone({ projectId, data: data(), dossier: "confirmed", planFileCount: 1, canOperate: true, ...overrides });
}

describe("buildAffaireTakeoffZone", () => {
  it("shows nothing for an affaire without plans, dossier, request or analysis", () => {
    expect(zone({ data: data({ active: false }), dossier: "empty", planFileCount: 0 })).toBeNull();
  });

  it("says when the takeoff cannot be read, without offering anything", () => {
    expect(zone({ data: null })).toMatchObject({
      status: "Indisponible", message: "L’état du métré n’a pas pu être lu. Réessayez dans un instant.", options: null, gesture: null,
    });
  });

  describe("before the automatic start is active", () => {
    it("offers an operator the options and today's launch on a version, and a reader only the state", () => {
      const operator = zone({ data: data({ active: false }), dossier: "brief_to_confirm" });
      expect(operator).toMatchObject({ status: "Non démarré", options: { mode: "version" }, gesture: null, live: false,
        message: "Aucune analyse des plans pour le moment. Lancez-la depuis les options du métré." });
      // Before the activation nothing starts at the dossier's confirmation: the zone never says it will.
      expect(operator!.message).not.toMatch(/démarrera/);
      expect(zone({ data: data({ active: false }), canOperate: false })).toMatchObject({
        options: null, message: "Aucune analyse des plans pour le moment." });
    });

    it("offers nothing to a member the takeoff's write rule refuses, even outside a director's review", () => {
      const model = zone({ data: data({ active: false, canOperate: false }) });
      expect(model).toMatchObject({ options: null, gesture: null, message: "Aucune analyse des plans pour le moment." });
      expect(zone({ data: data({ canOperate: false, request: request({ action: "take_on" }) }) })).toMatchObject({ gesture: null, options: null });
    });

    it("never offers a take-over a request could still show once the activation was withdrawn", () => {
      const model = zone({ data: data({ active: false, request: request({ action: "take_on" }) }) });
      expect(model).toMatchObject({ gesture: null, options: { mode: "version" } });
    });
  });

  describe("once the automatic start is active", () => {
    it("waits for the dossier: its piece or its brief, options saved but no competing launch", () => {
      const model = zone({ dossier: "brief_to_confirm" });
      expect(model).toMatchObject({ status: "En attente du dossier", message: describeTakeoffLaunchReason("BRIEF_NOT_CONFIRMED"),
        links: [expect.objectContaining({ kind: "brief", label: "Revoir le brief" })] });
      expect(model!.options).toMatchObject({ mode: "save_only" });
    });

    it("offers a first analysis on an affaire whose plans have no dossier, and after a dossier confirmed before the activation", () => {
      expect(zone({ dossier: "empty" })).toMatchObject({ options: { mode: "request", predecessorJobId: null } });
      expect(zone({ data: data({ confirmedBeforeActivation: true }) })).toMatchObject({
        status: "Non démarré", message: "Dossier confirmé avant l’activation — options disponibles",
        options: { mode: "request", predecessorJobId: null } });
    });

    it("gives the member who may pay the gesture the request allows, and only the state to a director", () => {
      const takeOn = zone({ data: data({ request: request({ action: "take_on" }) }) });
      expect(takeOn).toMatchObject({ status: "Non démarré", message: describeTakeoffLaunchReason("MANDATE_REQUIRED"),
        gesture: { kind: "take_on", label: "Prendre en charge avec mon forfait", requestId: request().id, revision: 2 },
        options: { mode: "save_only" } });
      const director = zone({ canOperate: false, data: data({ request: request({ reason: "OPERATOR_REQUIRED" }) }) });
      expect(director).toMatchObject({ message: "Métré non démarré — prise en charge par un métreur requise",
        gesture: null, options: null });
    });

    it("sends the payer to Mon profil and to the connected Mac when the gesture needs them", () => {
      const resume = zone({ data: data({ request: request({ reason: "CHATGPT_NOT_CONNECTED", hasPayer: true, payerIsViewer: true,
        action: "resume" }) }) });
      expect(resume).toMatchObject({ gesture: { kind: "resume", label: "Reprendre avec mon forfait" }, awayFromMac: false });
      expect(resume!.links).toContainEqual({ key: "profile", kind: "href", label: "Mon profil", href: "/dashboard/profile" });
      const away = zone({ data: data({ request: request({ reason: "CHATGPT_NOT_CONNECTED", action: "open_mac" }) }) });
      expect(away).toMatchObject({ gesture: null, awayFromMac: true });
    });

    it("names the pieces of a dossier blocking and leads to them", () => {
      const pieces = [{ id: "44444444-4444-4444-8444-444444444444", name: "Plan R+1.pdf" }];
      const model = zone({ data: data({ request: request({ reason: "PLAN_COPY_MISSING", pieces }) }) });
      expect(model).toMatchObject({ pieces, message: describeTakeoffLaunchReason("PLAN_COPY_MISSING", pieces) });
      expect(model!.links).toContainEqual(expect.objectContaining({ kind: "documents", label: "Voir le dossier" }));
    });

    it("tells a reservation from an analysis its Mac took, and follows both", () => {
      const evaluating = zone({ data: data({ request: request({ state: "evaluating", reason: null, hasPayer: true }) }) });
      expect(evaluating).toMatchObject({ status: "En préparation", live: true, options: { mode: "save_only" } });
      expect(evaluating!.facts).toContain(`Demande enregistrée le ${formatTakeoffCompletionDate("2026-11-21T08:00:00.000Z")}`);
      const admitted = (status: AffaireTakeoffZoneJob["status"]) => zone({ data: data({ request: request({ state: "admitted",
        reason: null, hasPayer: true, admittedAt: "2026-11-21T08:05:00.000Z", units: { expected: 1, succeeded: 0, failed: 0, canceled: 0 },
        jobs: [job({ status, reviewHref: null, finishedAt: null })] }) }) });
      expect(admitted("queued")).toMatchObject({ status: "En attente du Mac", live: true });
      expect(admitted("processing")).toMatchObject({ status: "En cours", live: true, reviews: [] });
      expect(admitted("processing")!.options).toMatchObject({ mode: "save_only" });
    });

    it("opens the review of a plan read while another one is still read (lot 3)", () => {
      const read = job();
      const reading = job({ id: "55555555-5555-4555-8555-555555555555", name: "Plans R+1.pdf", status: "processing", reviewHref: null });
      const model = zone({ data: data({ request: request({ state: "admitted", reason: null, hasPayer: true,
        units: { expected: 2, succeeded: 1, failed: 0, canceled: 0 }, jobs: [read, reading] }) }) });
      expect(model).toMatchObject({ status: "En cours", live: true,
        reviews: [{ key: read.id, label: "Revoir Plans RDC.pdf", href: read.reviewHref }] });
      expect(model!.facts).toContain("1 plan lu sur 2");
    });

    it("ends with the review, the notice the members received and a relaunch naming that analysis", () => {
      const done = job();
      const model = zone({ data: data({
        request: request({ state: "closed", reason: null, outcome: "success", closedAt: "2026-11-21T08:20:00.000Z",
          units: { expected: 1, succeeded: 1, failed: 0, canceled: 0 }, jobs: [done], completionEventId: "event-1" }),
        latestReview: done,
        latestEnd: { eventId: "event-1", outcome: "success", finishedAt: "2026-11-21T08:20:00.000Z", reason: null },
      }) });
      expect(model).toMatchObject({ status: "Terminé", tone: "success", live: false,
        reviews: [{ key: done.id, label: "Revoir l’analyse", href: done.reviewHref }],
        notice: { eventId: "event-1", title: "Analyse terminée", at: formatTakeoffCompletionDate("2026-11-21T08:20:00.000Z") },
        options: { mode: "request", predecessorJobId: done.id } });
      expect(model!.links).toContainEqual({ key: "activity", kind: "href", label: "Ouvrir le métré", href: `/dashboard/affaires/${projectId}/takeoff` });
    });

    it("never hides an earlier review behind a later failure", () => {
      const earlier = job();
      const failed = job({ id: "66666666-6666-4666-8666-666666666666", status: "action_required", statusLabel: "Échec à corriger",
        failure: "Délai dépassé.", reviewHref: null });
      const model = zone({ data: data({
        request: request({ origin: "manual", state: "closed", reason: null, outcome: "failure", closedAt: "2026-11-21T09:00:00.000Z",
          units: { expected: 1, succeeded: 0, failed: 1, canceled: 0 }, jobs: [failed] }),
        latestJob: failed, latestReview: earlier,
      }) });
      expect(model).toMatchObject({ status: "Échoué", tone: "danger", message: "L’analyse s’est arrêtée : Délai dépassé.",
        reviews: [{ key: earlier.id, label: "Revoir l’analyse précédente", href: earlier.reviewHref }],
        options: { mode: "request", predecessorJobId: failed.id } });
    });

    it("shows what changed in the dossier since the analysis, with the options", () => {
      const change = { added: [{ id: "a", name: "Plan R+2.pdf" }], replaced: [], removed: [] };
      const model = zone({ data: data({ dossierChangedSinceAnalysis: change,
        request: request({ state: "closed", reason: null, outcome: "success", jobs: [job()] }) }) });
      expect(model).toMatchObject({ dossierChange: change, options: { mode: "request" } });
    });

    it("shows a start set aside by a relaunch, and a request stopped by its budget", () => {
      expect(zone({ data: data({ request: request({ state: "superseded", reason: null }) }) })).toMatchObject({
        status: "Remplacé", message: describeTakeoffLaunchReason("SUPERSEDED") });
      expect(zone({ data: data({ request: request({ state: "closed", reason: "BUDGET_EXHAUSTED", outcome: "failure", jobs: [] }) }) }))
        .toMatchObject({ status: "Échoué", message: describeTakeoffLaunchReason("BUDGET_EXHAUSTED") });
    });
  });

  describe("without any request", () => {
    it("shows the affaire's latest analysis, whatever its version", () => {
      expect(zone({ data: data({ active: false, latestJob: job({ status: "processing", reviewHref: null, finishedAt: null }) }) }))
        .toMatchObject({ status: "En cours", live: true });
      const failed = job({ status: "action_required", failure: "Le PDF est invalide ou protégé.", reviewHref: null });
      expect(zone({ data: data({ active: false, latestJob: failed }) })).toMatchObject({
        status: "Échoué", message: "L’analyse s’est arrêtée : Le PDF est invalide ou protégé.", options: { mode: "version" } });
      expect(zone({ data: data({ latestJob: failed }) })).toMatchObject({ options: { mode: "request", predecessorJobId: failed.id } });
    });

    it("asks for plans when the affaire has none", () => {
      const model = zone({ data: data({ active: false }), dossier: "brief_to_confirm", planFileCount: 0 });
      expect(model).toMatchObject({ message: "Aucun plan à analyser pour le moment.", options: null });
      expect(model!.links).toContainEqual({ key: "plans", kind: "href", label: "Ajouter des plans", href: `/dashboard/affaires/${projectId}/plans` });
    });
  });
});

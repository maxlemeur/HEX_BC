import { describe, expect, it } from "vitest";

import {
  describeTakeoffResume,
  resolveTakeoffOperatorState,
  type ResolveTakeoffOperatorStateInput,
  type TakeoffResumeAction,
  type TakeoffResumeReason,
  type TakeoffResumeViewer,
  resolveTakeoffLaunchDecision,
} from "@/lib/takeoff/operator-state";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const LAUNCHER = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE = "22222222-2222-4222-8222-222222222222";
const THIS_MAC = "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_MAC = "urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const launcher: TakeoffResumeViewer = {
  userId: LAUNCHER, tenantRole: "engineer", canWriteAffaire: true, executionHostId: THIS_MAC, planStatus: "ready",
};

/** A local analysis that failed a minute ago without a recorded end, as every job did before the notices were activated. */
function stopped(overrides: Partial<ResolveTakeoffOperatorStateInput> = {}): ResolveTakeoffOperatorStateInput {
  return {
    status: "failed",
    processingStrategy: "sync",
    executionProvider: "chatgpt_local",
    executionHostId: THIS_MAC,
    analysisOutcome: null,
    nextRetryAt: null,
    completedAt: "2026-11-21T09:59:00.000Z",
    retryCount: 0,
    errorCode: "AI_PROVIDER",
    createdBy: LAUNCHER,
    viewer: launcher,
    now: NOW,
    ...overrides,
  };
}

function decide(overrides: Partial<ResolveTakeoffOperatorStateInput> = {}) {
  const state = resolveTakeoffOperatorState(stopped(overrides));
  return { ...state.resume, canResubmit: state.canResubmit };
}

describe("resolveTakeoffOperatorState: one resume policy", () => {
  // One line per case of the truth table; the first matching rule decides.
  it.each<[string, Partial<ResolveTakeoffOperatorStateInput>, string, string, string | null]>([
    ["a queued analysis is not stopped", { status: "pending", completedAt: null, errorCode: null }, "none", "not_stopped", null],
    ["a running analysis is not stopped", { status: "processing", completedAt: null, errorCode: null }, "none", "not_stopped", null],
    ["a successful analysis is not stopped", { status: "completed", analysisOutcome: "success", errorCode: null }, "none", "not_stopped", null],
    ["an applied analysis is not stopped", { status: "applied", errorCode: null }, "none", "not_stopped", null],
    ["an unknown status is not stopped", { status: "archived" }, "none", "not_stopped", null],
    ["a job of the former provider is never resumed", { executionProvider: "gemini" }, "new_analysis", "legacy_provider", null],
    ["a row without a provider is treated as the former provider", { executionProvider: null }, "new_analysis", "legacy_provider", null],
    ["a former batch job is never resumed", { processingStrategy: "batch", providerBatchId: "batches/old", providerBatchState: "running" },
      "new_analysis", "legacy_provider", null],
    ["the retry budget is spent", { retryCount: 3 }, "new_analysis", "retry_limit", null],
    ["the retry budget is spent even after a recorded end", { retryCount: 3, analysisOutcome: "failure" }, "new_analysis", "retry_limit", null],
    ["a recorded failure is final", { analysisOutcome: "failure" }, "new_analysis", "analysis_closed", null],
    ["a recorded cancellation is final", { status: "canceled", analysisOutcome: "canceled", errorCode: null }, "new_analysis", "analysis_closed", null],
    ["a recorded unknown outcome is final", { analysisOutcome: "failure", errorCode: "TAKEOFF_WORKER_OUTCOME_UNKNOWN" },
      "new_analysis", "outcome_unknown", null],
    ["a scheduled automatic retry is awaited", { nextRetryAt: "2026-11-21T10:00:15.000Z", errorCode: "AI_TIMEOUT" },
      "wait_retry", "retry_scheduled", "2026-11-21T10:00:15.000Z"],
    ["an overdue automatic retry is still awaited", { nextRetryAt: "2026-11-21T09:00:00.000Z", errorCode: "AI_TIMEOUT" },
      "wait_retry", "retry_scheduled", "2026-11-21T09:00:00.000Z"],
    ["an exhausted detailed budget is not retried", { errorCode: "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED" }, "new_analysis", "budget_exhausted", null],
    ["a reader of the affaire cannot act", { viewer: { ...launcher, tenantRole: "viewer" } }, "none", "read_only", null],
    ["a director cannot act", { viewer: { ...launcher, tenantRole: "director" } }, "none", "read_only", null],
    ["an engineer without write access to the affaire cannot act", { viewer: { ...launcher, canWriteAffaire: false } }, "none", "read_only", null],
    ["a member without a role cannot act", { viewer: { ...launcher, tenantRole: null } }, "none", "read_only", null],
    ["another operator starts a new analysis on their own plan", { viewer: { ...launcher, userId: COLLEAGUE, tenantRole: "admin" } },
      "new_analysis", "launched_by_other", null],
    ["a job whose launcher is gone is resumed by nobody", { createdBy: null }, "new_analysis", "launched_by_other", null],
    ["a server that runs no local analysis cannot resume it", { viewer: { ...launcher, executionHostId: null } }, "none", "execution_unavailable", null],
    ["a job of another Mac is resumed there only", { executionHostId: OTHER_MAC }, "none", "other_mac", null],
    ["a job without its Mac is resumed nowhere", { executionHostId: null }, "none", "other_mac", null],
    // Fix round 1, point 2: the launcher's own ChatGPT connection and model on this Mac, read before the click.
    ["a launcher whose ChatGPT plan is disconnected reconnects it first", { viewer: { ...launcher, planStatus: "disconnected" } },
      "none", "plan_disconnected", null],
    ["a launcher without a ChatGPT model chooses one first", { viewer: { ...launcher, planStatus: "no_model" } },
      "none", "plan_model_missing", null],
    ["another member's plan does not matter", { viewer: { ...launcher, userId: COLLEAGUE, planStatus: "disconnected" } },
      "new_analysis", "launched_by_other", null],
    ["a job of another Mac is resumed there, whatever this Mac's plan", { executionHostId: OTHER_MAC, viewer: { ...launcher, planStatus: "no_model" } },
      "none", "other_mac", null],
    ["the delay after a failure is awaited", { completedAt: "2026-11-21T09:59:58.000Z" }, "wait_retry", "retry_delay", "2026-11-21T10:00:03.000Z"],
    ["the delay grows with the retries", { retryCount: 2, completedAt: "2026-11-21T09:59:30.000Z" }, "wait_retry", "retry_delay", "2026-11-21T10:00:15.000Z"],
    ["a failure without a recorded end keeps its relaunch", {}, "retry_now", "retry_available", null],
    ["a cancellation without a recorded end keeps its relaunch", { status: "canceled", errorCode: null, completedAt: "2026-11-21T09:59:59.000Z" },
      "retry_now", "retry_available", null],
    ["an unknown outcome without a recorded end keeps its relaunch", { errorCode: "TAKEOFF_WORKER_OUTCOME_UNKNOWN" }, "retry_now", "outcome_unknown", null],
    ["an old row without a diagnostic or an end date keeps its relaunch", { errorCode: null, completedAt: null, retryCount: null },
      "retry_now", "retry_available", null],
    ["an unknown error code keeps its relaunch", { errorCode: "SOME_FUTURE_CODE" }, "retry_now", "retry_available", null],
    ["an administrator who launched the job resumes it", { viewer: { ...launcher, tenantRole: "admin" } }, "retry_now", "retry_available", null],
  ])("%s", (_case, overrides, action, reason, availableAt) => {
    expect(decide(overrides)).toEqual({ action, reason, availableAt, canResubmit: action === "retry_now" });
  });

  it("puts the job's own facts before the member's rights", () => {
    const reader = { ...launcher, tenantRole: "viewer" };
    expect(decide({ viewer: reader, analysisOutcome: "failure" })).toMatchObject({ action: "none", reason: "analysis_closed" });
    expect(decide({ viewer: reader, executionProvider: "gemini" })).toMatchObject({ action: "none", reason: "legacy_provider" });
    expect(decide({ viewer: reader, retryCount: 3 })).toMatchObject({ action: "none", reason: "retry_limit" });
    expect(decide({ viewer: reader, errorCode: "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED" })).toMatchObject({ action: "none", reason: "budget_exhausted" });
    // A scheduled retry needs nobody: every reader waits for it.
    expect(decide({ viewer: reader, nextRetryAt: "2026-11-21T10:00:15.000Z" })).toMatchObject({ action: "wait_retry", reason: "retry_scheduled" });
  });

  it("lets an operator with write access to the affaire cancel a running analysis", () => {
    expect(resolveTakeoffOperatorState(stopped({ status: "processing" })).canCancel).toBe(true);
    expect(resolveTakeoffOperatorState(stopped({ status: "pending", viewer: { ...launcher, canWriteAffaire: false } })).canCancel).toBe(false);
    expect(resolveTakeoffOperatorState(stopped({ status: "pending", viewer: { ...launcher, tenantRole: "director" } })).canCancel).toBe(false);
    expect(resolveTakeoffOperatorState(stopped({ status: "failed" })).canCancel).toBe(false);
  });

  it("labels a batch whose provider already succeeded while the job is still processing as a resumption to check", () => {
    const state = resolveTakeoffOperatorState(stopped({
      status: "processing", processingStrategy: "batch", providerBatchId: "batch-succeeded", providerBatchState: "succeeded",
      executionProvider: "gemini", viewer: { ...launcher, tenantRole: "admin" },
    }));

    expect(state.state).toBe("orphan_to_reconcile");
    expect(state.label).toBe("Reprise à vérifier");
  });

  it("hides resubmit when the provider already succeeded upstream", () => {
    const state = resolveTakeoffOperatorState(stopped({
      retryCount: 1, processingStrategy: "batch", providerBatchId: "batch-succeeded", providerBatchState: "succeeded",
      executionProvider: "gemini", viewer: { ...launcher, tenantRole: "admin" },
    }));

    expect(state.state).toBe("orphan_to_reconcile");
    expect(state.canResubmit).toBe(false);
    expect(state.resume).toEqual({ action: "new_analysis", reason: "legacy_provider", availableAt: null });
  });
});

describe("describeTakeoffResume", () => {
  it("says every decision in French, without a code", () => {
    const finalReasons: TakeoffResumeReason[] = ["legacy_provider", "retry_limit", "analysis_closed", "outcome_unknown", "budget_exhausted"];
    const decisions: Array<[TakeoffResumeAction, TakeoffResumeReason]> = [
      ["retry_now", "retry_available"], ["retry_now", "outcome_unknown"], ["wait_retry", "retry_scheduled"], ["wait_retry", "retry_delay"],
      ...finalReasons.flatMap((reason): Array<[TakeoffResumeAction, TakeoffResumeReason]> => [["new_analysis", reason], ["none", reason]]),
      ["new_analysis", "launched_by_other"], ["none", "read_only"], ["none", "execution_unavailable"], ["none", "other_mac"],
      ["none", "plan_disconnected"], ["none", "plan_model_missing"],
    ];
    for (const [action, reason] of decisions) {
      const text = describeTakeoffResume({ action, reason, availableAt: action === "wait_retry" ? "2026-11-21T10:00:15.000Z" : null });
      expect(text, `${action}/${reason}`).toMatch(/^[A-ZÀ-Ý].+\.$/);
      expect(text, `${action}/${reason}`).not.toMatch(/[a-z]+_[a-z_]+|\b[A-Z]{2,}_[A-Z_]+\b/);
    }
    expect(describeTakeoffResume({ action: "none", reason: "not_stopped", availableAt: null })).toBeNull();
  });

  it("keeps the wording the journeys and the end of analysis already show", () => {
    expect(describeTakeoffResume({ action: "new_analysis", reason: "analysis_closed", availableAt: null })).toMatch(/^Cette analyse est close\./);
    expect(describeTakeoffResume({ action: "new_analysis", reason: "retry_limit", availableAt: null }))
      .toMatch(/^Le nombre maximal de relances est atteint\./);
    expect(describeTakeoffResume({ action: "new_analysis", reason: "legacy_provider", availableAt: null }))
      .toMatch(/^Ce fournisseur IA ne permet plus de relancer cette analyse\./);
    expect(describeTakeoffResume({ action: "none", reason: "read_only", availableAt: null }))
      .toBe("Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur.");
    expect(describeTakeoffResume({ action: "new_analysis", reason: "launched_by_other", availableAt: null }))
      .toBe("Seule la personne qui a lancé cette analyse peut la démarrer avec son forfait. Préparez une nouvelle analyse avec votre forfait.");
  });

  it("gives the time of a wait in Paris", () => {
    expect(describeTakeoffResume({ action: "wait_retry", reason: "retry_scheduled", availableAt: "2026-11-21T10:00:15.000Z" }))
      .toContain("11:00:15");
  });
});

describe("resolveTakeoffLaunchDecision", () => {
  const operator = { userId: "payer", tenantRole: "engineer", canWriteAffaire: true, executionHostId: "urn:uuid:mac", planStatus: "ready" as const };
  it.each([
    ["an admitted request answers through its job", "admitted", null, "payer", operator, "none"],
    ["a closed request answers through its job", "closed", null, "payer", operator, "none"],
    ["a dossier not confirmed is lifted in the dossier", "not_eligible", "DOSSIER_PROCESSING", null, operator, "none"],
    ["a request waiting for its Mac is awaited", "evaluating", null, "payer", operator, "wait"],
    ["a passing cause is awaited", "blocked", "ADMISSION_LIMIT", "payer", operator, "wait"],
    ["a missing working copy is lifted in the dossier", "blocked", "PLAN_COPY_MISSING", "payer", operator, "none"],
    ["the payer resumes with their subscription", "blocked", "CHATGPT_NOT_CONNECTED", "payer", operator, "resume"],
    ["another operator takes it on", "blocked", "CHATGPT_NOT_CONNECTED", "payer", { ...operator, userId: "other" }, "take_on"],
    ["a reader's confirmation waits for an operator", "blocked", "OPERATOR_REQUIRED", null, operator, "take_on"],
    ["a reader cannot take it on", "blocked", "OPERATOR_REQUIRED", null, { ...operator, tenantRole: "director", canWriteAffaire: false }, "none"],
    ["the hosted application sends to the Mac", "blocked", "LOCAL_RUNTIME_REQUIRED", "payer", { ...operator, executionHostId: null }, "open_mac"],
    ["repeated failures wait for a gesture", "blocked", "EVALUATION_FAILED", "payer", operator, "resume"],
    ["an automatic start set aside by a relaunch is restarted only by a gesture", "blocked", "SUPERSEDED", "payer", { ...operator, userId: "other" }, "take_on"],
  ] as const)("%s", (_case, state, reasonCode, payerId, viewer, action) => {
    expect(resolveTakeoffLaunchDecision({ state, reasonCode, payerId, viewer, updatedAt: new Date().toISOString() })).toEqual({ action });
  });
  it("offers a request that waited too long for the Mac of its mandate to a gesture", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const waited = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    expect(resolveTakeoffLaunchDecision({ state: "evaluating", reasonCode: null, payerId: "payer", viewer: operator, updatedAt: waited(5), now }))
      .toEqual({ action: "wait" });
    expect(resolveTakeoffLaunchDecision({ state: "evaluating", reasonCode: null, payerId: "payer", viewer: operator, updatedAt: waited(20), now }))
      .toEqual({ action: "resume" });
    expect(resolveTakeoffLaunchDecision({ state: "evaluating", reasonCode: null, payerId: "payer", viewer: { ...operator, userId: "other" },
      updatedAt: waited(20), now })).toEqual({ action: "take_on" });
  });
});

import {
  TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS,
  TAKEOFF_RETRY_BACKOFF_SECONDS,
  TAKEOFF_RETRY_MAX as TAKEOFF_RETRY_MAX_CONSTANT,
} from "@/lib/takeoff/constants";
import type {
  TakeoffJobOperatorState,
  TakeoffJobStatus,
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
} from "@/lib/takeoff/types";

const TAKEOFF_OPERATOR_MUTATION_ROLES = new Set(["admin", "engineer"]);

const PROVIDER_PENDING_STATES = new Set<TakeoffProviderBatchState>([
  "submitted",
  "pending",
  "running",
  "unknown",
]);

const PROVIDER_FAILED_STATES = new Set<TakeoffProviderBatchState>([
  "failed",
  "cancelled",
  "expired",
]);
const PROVIDER_TERMINAL_STATES = new Set<TakeoffProviderBatchState>([
  "succeeded",
  ...PROVIDER_FAILED_STATES,
]);
export const TAKEOFF_RETRY_MAX = TAKEOFF_RETRY_MAX_CONSTANT;

const TAKEOFF_OPERATOR_STATE_LABELS: Record<TakeoffJobOperatorState, string> = {
  none: "Aucune action requise",
  submitted_to_provider: "Envoyée au fournisseur IA",
  awaiting_provider_result: "En attente du résultat du fournisseur IA",
  provider_failed: "Échec du fournisseur IA",
  orphan_to_reconcile: "Reprise à vérifier",
};

/** What a member may do with an analysis that stopped. */
export const TAKEOFF_RESUME_ACTIONS = ["retry_now", "wait_retry", "new_analysis", "none"] as const;
export type TakeoffResumeAction = (typeof TAKEOFF_RESUME_ACTIONS)[number];

/** Why: the first rule of the policy that decided. Each one is worded in French by describeTakeoffResume. */
export const TAKEOFF_RESUME_REASONS = [
  "not_stopped",
  "legacy_provider",
  "retry_limit",
  "analysis_closed",
  "outcome_unknown",
  "retry_scheduled",
  "budget_exhausted",
  "read_only",
  "launched_by_other",
  "execution_unavailable",
  "other_mac",
  "plan_disconnected",
  "plan_model_missing",
  "retry_delay",
  "retry_available",
] as const;
export type TakeoffResumeReason = (typeof TAKEOFF_RESUME_REASONS)[number];

export type TakeoffResumeDecision = {
  action: TakeoffResumeAction;
  reason: TakeoffResumeReason;
  /** For a wait: when the scheduled retry is due, or when a retry of the same job is admitted again. */
  availableAt: string | null;
};

/** The member who reads or acts, as the server saw them for this request. */
export type TakeoffResumeViewer = {
  userId: string | null;
  tenantRole: string | null;
  /** The member may write the job's affaire (its owner, or an administrator of the tenant), read from the affaire itself. */
  canWriteAffaire: boolean;
  /** The Mac this server runs local analyses on for this request; null when it runs none (hosted runtime, another address). */
  executionHostId: string | null;
  /**
   * The member's own ChatGPT connection on this Mac, which a retry of their job runs on: connected with a model, connection
   * missing or expired, or no model chosen. Null when this request runs no local analysis (nothing to read).
   */
  planStatus: TakeoffResumePlanStatus | null;
};

export type TakeoffResumePlanStatus = "ready" | "disconnected" | "no_model";

export type ResolveTakeoffOperatorStateInput = {
  status: TakeoffJobStatus | string;
  processingStrategy?: TakeoffProcessingStrategy | null;
  providerBatchId?: string | null;
  providerBatchState?: TakeoffProviderBatchState | null;
  providerReconcileDueAt?: string | null;
  providerReconcileLeaseExpiresAt?: string | null;
  errorCode?: string | null;
  retryCount?: number | null;
  /** NULL on no row of the database (default « gemini »): a missing value is read as the former provider. */
  executionProvider?: string | null;
  executionHostId?: string | null;
  /** The recorded end of the analysis; NULL for every job that ended before the end-of-analysis notices were activated. */
  analysisOutcome?: string | null;
  nextRetryAt?: string | null;
  completedAt?: string | null;
  createdBy?: string | null;
  viewer: TakeoffResumeViewer;
  now?: Date;
};

export type TakeoffOperatorStateDescriptor = {
  state: TakeoffJobOperatorState;
  label: string;
  canCancel: boolean;
  canResubmit: boolean;
  resume: TakeoffResumeDecision;
};

/** A DB row of takeoff_jobs, as the list, the detail and the command read it. */
export type TakeoffOperatorStateRow = {
  status: string;
  processing_strategy?: string | null;
  provider_batch_id?: string | null;
  provider_batch_state?: string | null;
  provider_reconcile_due_at?: string | null;
  provider_reconcile_lease_expires_at?: string | null;
  error_code?: string | null;
  retry_count?: number | null;
  execution_provider?: string | null;
  execution_host_id?: string | null;
  analysis_outcome?: string | null;
  next_retry_at?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
};

export function isTakeoffOperatorMutationRole(
  tenantRole: string | null | undefined
): boolean {
  return tenantRole != null && TAKEOFF_OPERATOR_MUTATION_ROLES.has(tenantRole);
}

export function getTakeoffOperatorStateLabel(
  state: TakeoffJobOperatorState
): string {
  return TAKEOFF_OPERATOR_STATE_LABELS[state];
}

function parseIsoTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toProcessingStrategy(value: string | null | undefined): TakeoffProcessingStrategy | null {
  return value === "sync" || value === "batch" ? value : null;
}

function toProviderBatchState(value: string | null | undefined): TakeoffProviderBatchState | null {
  return value === "submitted" || value === "pending" || value === "running" || value === "succeeded" ||
    value === "failed" || value === "cancelled" || value === "expired" || value === "unknown" ? value : null;
}

/** The same input for the three surfaces, from the columns each of them reads. */
export function toTakeoffOperatorStateInput(
  row: TakeoffOperatorStateRow,
  viewer: TakeoffResumeViewer,
  now?: Date,
): ResolveTakeoffOperatorStateInput {
  return {
    status: row.status,
    processingStrategy: toProcessingStrategy(row.processing_strategy),
    providerBatchId: row.provider_batch_id ?? null,
    providerBatchState: toProviderBatchState(row.provider_batch_state),
    providerReconcileDueAt: row.provider_reconcile_due_at ?? null,
    providerReconcileLeaseExpiresAt: row.provider_reconcile_lease_expires_at ?? null,
    errorCode: row.error_code ?? null,
    retryCount: row.retry_count ?? null,
    executionProvider: row.execution_provider ?? null,
    executionHostId: row.execution_host_id ?? null,
    analysisOutcome: row.analysis_outcome ?? null,
    nextRetryAt: row.next_retry_at ?? null,
    completedAt: row.completed_at ?? null,
    createdBy: row.created_by ?? null,
    viewer,
    now,
  };
}

function resolveTakeoffOperatorStateValue(
  input: ResolveTakeoffOperatorStateInput
): TakeoffJobOperatorState {
  if (input.processingStrategy !== "batch" || !input.providerBatchId) {
    return "none";
  }

  if (
    input.status === "processing" &&
    input.providerBatchState &&
    PROVIDER_TERMINAL_STATES.has(input.providerBatchState)
  ) {
    return "orphan_to_reconcile";
  }

  if (
    input.status === "failed" &&
    input.providerBatchState === "succeeded"
  ) {
    return "orphan_to_reconcile";
  }

  if (
    input.status === "failed" &&
    input.providerBatchState &&
    PROVIDER_FAILED_STATES.has(input.providerBatchState)
  ) {
    return "provider_failed";
  }

  const providerState = input.providerBatchState;
  if (!providerState || !PROVIDER_PENDING_STATES.has(providerState)) {
    return "none";
  }

  if (input.status === "failed") {
    return "orphan_to_reconcile";
  }

  if (input.status !== "processing") {
    return "none";
  }

  if (providerState === "submitted") {
    return "submitted_to_provider";
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const leaseExpiresAtMs = parseIsoTime(input.providerReconcileLeaseExpiresAt);
  if (leaseExpiresAtMs !== null && leaseExpiresAtMs <= nowMs) {
    return "orphan_to_reconcile";
  }

  const reconcileDueAtMs = parseIsoTime(input.providerReconcileDueAt);
  if (
    reconcileDueAtMs !== null &&
    reconcileDueAtMs + TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS * 1000 <= nowMs
  ) {
    return "orphan_to_reconcile";
  }

  if (input.errorCode === "AI_TIMEOUT") {
    return "orphan_to_reconcile";
  }

  return "awaiting_provider_result";
}

/** The delay a manual retry of the same job waits after its failure: 5, 15 then 45 s. */
export function getTakeoffRetryBackoffMs(retryCount: number) {
  const clamped = Math.max(0, Math.min(retryCount, TAKEOFF_RETRY_BACKOFF_SECONDS.length - 1));
  return TAKEOFF_RETRY_BACKOFF_SECONDS[clamped] * 1000;
}

/** An engineer or an administrator who may write the job's affaire. */
export function canTakeoffResumeViewerAct(viewer: TakeoffResumeViewer) {
  return isTakeoffOperatorMutationRole(viewer.tenantRole) && viewer.canWriteAffaire;
}

/**
 * The resume policy. The first rule that matches decides; the job's own facts come before the member's rights, so that a
 * reader learns why nobody can resume the job, and a scheduled retry is awaited by everyone.
 */
function resolveTakeoffResumeDecision(input: ResolveTakeoffOperatorStateInput): TakeoffResumeDecision {
  const decide = (action: TakeoffResumeAction, reason: TakeoffResumeReason, availableAt: string | null = null) =>
    ({ action, reason, availableAt });
  const finalForThisJob = (reason: TakeoffResumeReason) =>
    decide(canTakeoffResumeViewerAct(input.viewer) ? "new_analysis" : "none", reason);

  if (input.status !== "failed" && input.status !== "canceled") return decide("none", "not_stopped");
  // The former provider and its batches have no reader left to run them again.
  if (input.executionProvider !== "chatgpt_local" || input.processingStrategy === "batch" || input.providerBatchId) {
    return finalForThisJob("legacy_provider");
  }
  const retryCount = input.retryCount ?? 0;
  if (retryCount >= TAKEOFF_RETRY_MAX) return finalForThisJob("retry_limit");
  // A recorded end (failure, cancellation) is final for its job: a relaunch after it is a new analysis.
  if (input.analysisOutcome) {
    return finalForThisJob(input.errorCode === "TAKEOFF_WORKER_OUTCOME_UNKNOWN" ? "outcome_unknown" : "analysis_closed");
  }
  if (input.nextRetryAt) return decide("wait_retry", "retry_scheduled", input.nextRetryAt);
  // The same sources would spend the same budget again.
  if (input.errorCode === "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED") return finalForThisJob("budget_exhausted");
  if (!canTakeoffResumeViewerAct(input.viewer)) return decide("none", "read_only");
  // A retry of the same job runs on the plan of the member who launched it: nobody else may spend it.
  if (!input.createdBy || input.createdBy !== input.viewer.userId) return decide("new_analysis", "launched_by_other");
  if (!input.viewer.executionHostId) return decide("none", "execution_unavailable");
  if (input.executionHostId !== input.viewer.executionHostId) return decide("none", "other_mac");
  // The launcher's connection and model, read before the click; the click reads them again.
  if (input.viewer.planStatus === "disconnected") return decide("none", "plan_disconnected");
  if (input.viewer.planStatus === "no_model") return decide("none", "plan_model_missing");
  const completedAtMs = input.status === "failed" ? parseIsoTime(input.completedAt) : null;
  if (completedAtMs !== null) {
    const availableAtMs = completedAtMs + getTakeoffRetryBackoffMs(retryCount);
    if ((input.now ?? new Date()).getTime() < availableAtMs) {
      return decide("wait_retry", "retry_delay", new Date(availableAtMs).toISOString());
    }
  }
  // An analysis that ended before the notices were activated has no recorded end and keeps the relaunch it had.
  return decide("retry_now", input.errorCode === "TAKEOFF_WORKER_OUTCOME_UNKNOWN" ? "outcome_unknown" : "retry_available");
}

export function resolveTakeoffOperatorState(
  input: ResolveTakeoffOperatorStateInput
): TakeoffOperatorStateDescriptor {
  const state = resolveTakeoffOperatorStateValue(input);
  const resume = resolveTakeoffResumeDecision(input);

  return {
    state,
    label: getTakeoffOperatorStateLabel(state),
    canCancel:
      canTakeoffResumeViewerAct(input.viewer) &&
      (input.status === "pending" || input.status === "processing"),
    canResubmit: resume.action === "retry_now",
    resume,
  };
}

const resumeTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });

function formatResumeTime(value: string | null) {
  const timestamp = parseIsoTime(value);
  return timestamp === null ? null : resumeTime.format(new Date(timestamp));
}

/** A row of an answer that carries no decision (an older server): nothing is offered until the page is reloaded. */
export const TAKEOFF_RESUME_RELOAD_TEXT = "Rechargez la page pour voir les actions possibles sur cette analyse.";

const NEW_ANALYSIS = "Préparez une nouvelle analyse depuis l’affaire.";
const ASK_AN_OPERATOR = "Un ingénieur ou un administrateur peut préparer une nouvelle analyse.";

/** The decision in French, as the list, the detail and the refusal of the command say it. Null when nothing is to resume. */
export function describeTakeoffResume(decision: TakeoffResumeDecision): string | null {
  const next = decision.action === "new_analysis" ? NEW_ANALYSIS : ASK_AN_OPERATOR;
  const at = formatResumeTime(decision.availableAt);
  switch (decision.reason) {
    case "not_stopped":
      return null;
    case "legacy_provider":
      return `Ce fournisseur IA ne permet plus de relancer cette analyse. ${next}`;
    case "retry_limit":
      return `Le nombre maximal de relances est atteint. ${next}`;
    case "analysis_closed":
      return `Cette analyse est close. ${next}`;
    case "outcome_unknown":
      return decision.action === "retry_now"
        ? "Le résultat de la tentative interrompue est inconnu. Vous pouvez soumettre cette analyse à nouveau ; votre forfait ChatGPT est vérifié au lancement."
        : `Cette analyse est close et le résultat de sa dernière tentative est inconnu. ${next}`;
    case "retry_scheduled":
      return at ? `Une reprise automatique est programmée à partir du ${at}.` : "Une reprise automatique est programmée.";
    case "budget_exhausted":
      return decision.action === "new_analysis"
        ? "Le budget de l’analyse détaillée est épuisé. Préparez une nouvelle analyse en restreignant les sources."
        : `Le budget de l’analyse détaillée est épuisé. ${ASK_AN_OPERATOR}`;
    case "read_only":
      return "Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur.";
    case "launched_by_other":
      return "Seule la personne qui a lancé cette analyse peut la démarrer avec son forfait. Préparez une nouvelle analyse avec votre forfait.";
    case "execution_unavailable":
      return "Pour soumettre cette analyse à nouveau, ouvrez MergeOne sur le Mac connecté.";
    case "other_mac":
      return "Cette analyse a été lancée depuis un autre Mac. Soumettez-la à nouveau depuis le Mac qui l’a lancée.";
    case "plan_disconnected":
      return "Reconnectez votre forfait ChatGPT dans Mon profil pour soumettre cette analyse à nouveau.";
    case "plan_model_missing":
      return "Choisissez un modèle ChatGPT dans Mon profil pour soumettre cette analyse à nouveau.";
    case "retry_delay":
      return at ? `Vous pourrez soumettre cette analyse à nouveau à partir du ${at}.` : "Vous pourrez bientôt soumettre cette analyse à nouveau.";
    case "retry_available":
      return "Vous pouvez soumettre cette analyse à nouveau ; votre forfait ChatGPT est vérifié au lancement.";
  }
}

/** What a member may do with a launch request that has not started (migration 20261121083011_takeoff_launch_requests.sql). */
export const TAKEOFF_LAUNCH_ACTIONS = ["take_on", "resume", "open_mac", "wait", "none"] as const;
export type TakeoffLaunchAction = (typeof TAKEOFF_LAUNCH_ACTIONS)[number];

const LAUNCH_MANDATE_REASONS = new Set(["OPERATOR_REQUIRED", "MANDATE_REQUIRED", "LOCAL_RUNTIME_REQUIRED", "HOST_NOT_AUTHORISED",
  "CHATGPT_NOT_CONNECTED", "CHATGPT_ACCESS_REVOKED", "CHATGPT_MODEL_MISSING", "CHATGPT_SELECTION_CHANGED", "PAYER_NOT_ELIGIBLE"]);
const LAUNCH_TRANSIENT_REASONS = new Set(["ADMISSION_LIMIT", "SOURCE_UNREADABLE", "ANOTHER_ANALYSIS_RUNNING"]);

/**
 * The launch policy, beside the resume policy of a job. A request waiting for its evaluation, or blocked by a passing
 * cause, is awaited by everyone; a blocking of the dossier is lifted in the dossier or the options; a blocking of the
 * mandate is lifted only by a gesture: « Reprendre avec mon forfait » by its payer, « Prendre en charge » by another
 * operator who may launch on the affaire, on the Mac where their subscription is connected. An admitted or closed request
 * answers through its job.
 */
export function resolveTakeoffLaunchDecision(input: {
  state: string;
  reasonCode: string | null;
  payerId: string | null;
  viewer: TakeoffResumeViewer;
}): { action: TakeoffLaunchAction } {
  if (input.state === "admitted" || input.state === "closed" || input.state === "not_eligible") return { action: "none" };
  if (input.state === "evaluating" || LAUNCH_TRANSIENT_REASONS.has(input.reasonCode ?? "")) return { action: "wait" };
  if (!LAUNCH_MANDATE_REASONS.has(input.reasonCode ?? "") || !canTakeoffResumeViewerAct(input.viewer)) return { action: "none" };
  if (!input.viewer.executionHostId) return { action: "open_mac" };
  return { action: input.payerId && input.payerId === input.viewer.userId ? "resume" : "take_on" };
}

/** The gesture's name, as the affaire's options will show it. */
export function describeTakeoffLaunchAction(action: TakeoffLaunchAction): string | null {
  switch (action) {
    case "take_on": return "Prendre en charge avec mon forfait";
    case "resume": return "Reprendre avec mon forfait";
    case "open_mac": return "Ouvrir sur le Mac connecté";
    case "wait":
    case "none": return null;
  }
}

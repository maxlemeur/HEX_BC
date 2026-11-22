import { TAKEOFF_RETRY_BACKOFF_SECONDS, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";

export type TakeoffAnalysisOutcome = "success" | "failure" | "canceled";

/**
 * The codes of an end that the database publishes to the inbox and to the affaire's readers
 * (private.takeoff_public_failure_codes): each has a public French reason. Any other code is shown as the generic reason.
 * Add a code to both lists, never to one.
 */
export const TAKEOFF_PUBLIC_FAILURE_CODES = [
  "AI_PROVIDER", "AI_RATE_LIMIT", "AI_SAFETY", "AI_SCHEMA", "AI_TIMEOUT", "FORBIDDEN", "INTERNAL_ERROR", "TAKEOFF_FILE_TOO_LARGE",
  "TAKEOFF_FILE_TYPE_INVALID", "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED", "TAKEOFF_LEVEL_C_INVALID_SCHEMA",
  "TAKEOFF_LEVEL_C_TIMEOUT", "TAKEOFF_PDF_CORRUPTED", "TAKEOFF_PDF_NOT_INTERPRETABLE", "TAKEOFF_WORKER_HOST_SILENT",
  "TAKEOFF_WORKER_NOT_STARTED", "TAKEOFF_WORKER_OUTCOME_UNKNOWN", "TAKEOFF_WORKER_QUEUE_EXPIRED",
] as const;

/**
 * The codes a plan of one analysis per plan publishes to the affaire's readers, on that plan (private.
 * takeoff_plan_public_failure_codes, migration 20261121231238_takeoff_plan_dispatcher.sql): the list above, a plan's source
 * changed after its admission, its request's budget spent, a call whose consumption stayed unknown or was not recorded.
 */
export const TAKEOFF_PLAN_PUBLIC_FAILURE_CODES = [
  ...TAKEOFF_PUBLIC_FAILURE_CODES, "TAKEOFF_PREPARATION_SOURCE_CHANGED", "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", "TAKEOFF_USAGE_UNRECORDED",
] as const;

/** The end a notice tells: an analysis's, or a launch request's, which may have read some of its plans only. */
export type TakeoffNoticeOutcome = TakeoffAnalysisOutcome | "partial";

export const TAKEOFF_COMPLETION_LABELS: Readonly<Record<TakeoffNoticeOutcome, string>> = {
  success: "Analyse terminée",
  failure: "Analyse échouée",
  canceled: "Analyse annulée",
  partial: "Analyse terminée en partie",
};

const completionDate = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris",
});

export function formatTakeoffCompletionDate(timestamp: string) {
  return completionDate.format(new Date(timestamp));
}

export function toTakeoffAnalysisOutcome(value: unknown): TakeoffAnalysisOutcome | null {
  return value === "success" || value === "failure" || value === "canceled" ? value : null;
}

/** A notice's end, a launch request's partial end included. */
export function toTakeoffNoticeOutcome(value: unknown): TakeoffNoticeOutcome | null {
  return value === "partial" ? value : toTakeoffAnalysisOutcome(value);
}

/** Commit the retry decision together with the failure under the processing lease. */
export function takeoffAnalysisFailureFields(input: {
  retryable: boolean;
  retryCount: number;
  completedAtIso: string;
}) {
  const delay = input.retryable && input.retryCount < TAKEOFF_RETRY_MAX
    ? TAKEOFF_RETRY_BACKOFF_SECONDS[input.retryCount]
    : undefined;
  return {
    analysis_outcome: delay === undefined ? "failure" : null,
    last_error_at: input.completedAtIso,
    next_retry_at: delay === undefined
      ? null
      : new Date(Date.parse(input.completedAtIso) + delay * 1_000).toISOString(),
  };
}

export function hasScheduledLocalTakeoffRetry(row: {
  execution_provider?: unknown;
  next_retry_at?: unknown;
}) {
  return row.execution_provider === "chatgpt_local" && typeof row.next_retry_at === "string";
}

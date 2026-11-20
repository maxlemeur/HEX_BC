import { TAKEOFF_RETRY_BACKOFF_SECONDS, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";

export type TakeoffAnalysisOutcome = "success" | "failure" | "canceled";

export function toTakeoffAnalysisOutcome(value: unknown): TakeoffAnalysisOutcome | null {
  return value === "success" || value === "failure" || value === "canceled" ? value : null;
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

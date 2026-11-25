import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { TAKEOFF_LEVEL_C, type Supabase } from "@/lib/takeoff/processing-context";
import { rejectedTakeoffAnswerMetrics } from "@/lib/takeoff/rejected-provider-answer";

export type LevelCChunkMetric = {
  provider: "chatgpt";
  index: number;
  start: number;
  end: number;
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  token_count: number;
  cost_cents: number;
  duration_ms: number;
  model: string;
  timed_out: boolean;
  budget_exceeded: boolean;
  status: "success" | "failed";
  error_code?: string;
  error_message?: string;
};

type LevelCChunkMetricPersistenceHint = {
  errorDetails?: unknown;
  sourceFileName: string;
};

type LevelCChunkMetricWriteInput = {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  metrics: LevelCChunkMetric[];
  resultId?: string | null;
  hint: LevelCChunkMetricPersistenceHint;
};

export type LevelCProcessingError = TakeoffError & {
  levelCChunkMetrics?: LevelCChunkMetric[];
};

export function cloneLevelCChunkMetrics(metrics: LevelCChunkMetric[]) {
  return metrics.map((metric) => ({ ...metric }));
}

function isLevelCChunkMetric(value: unknown): value is LevelCChunkMetric {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.index === "number" &&
    typeof record.start === "number" &&
    typeof record.end === "number" &&
    typeof record.input_tokens === "number" &&
    typeof record.reasoning_tokens === "number" &&
    typeof record.output_tokens === "number" &&
    typeof record.token_count === "number" &&
    typeof record.cost_cents === "number" &&
    typeof record.duration_ms === "number" &&
    typeof record.model === "string" &&
    typeof record.timed_out === "boolean" &&
    typeof record.budget_exceeded === "boolean" &&
    (record.status === "success" || record.status === "failed")
  );
}

export function extractLevelCChunkMetricsFromError(error: unknown): LevelCChunkMetric[] {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return [];
  }

  const record = error as { levelCChunkMetrics?: unknown };
  if (!Array.isArray(record.levelCChunkMetrics)) {
    return [];
  }

  const metrics = record.levelCChunkMetrics.filter(isLevelCChunkMetric);
  return cloneLevelCChunkMetrics(metrics);
}

export function mapToLevelCNormalizedError(input: {
  error: unknown;
  jobId: string;
  chunkMetrics: LevelCChunkMetric[];
}): TakeoffError {
  const mapped = toTakeoffError(input.error, {
    fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
    jobId: input.jobId,
    level: TAKEOFF_LEVEL_C,
  });

  let normalized = mapped;
  if (mapped.code === TakeoffErrorCode.AI_TIMEOUT) {
    normalized = new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT,
      status: 500,
      message: mapped.message,
      details: mapped.details,
      retryable: mapped.retryable,
      jobId: input.jobId,
      level: TAKEOFF_LEVEL_C,
    });
  } else if (
    mapped.code === TakeoffErrorCode.AI_SCHEMA ||
    mapped.code === TakeoffErrorCode.VALIDATION_ERROR
  ) {
    normalized = new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
      status: 422,
      message: mapped.message,
      details: mapped.details,
      retryable: false,
      jobId: input.jobId,
      level: TAKEOFF_LEVEL_C,
    });
  }

  const enriched = normalized as LevelCProcessingError;
  enriched.levelCChunkMetrics = cloneLevelCChunkMetrics(input.chunkMetrics);
  return enriched;
}

export function logLevelCChunkMetric(input: {
  job: TakeoffJobProcessingRow;
  metric: LevelCChunkMetric;
}) {
  const payload = {
    job_id: input.job.id,
    tenant_id: input.job.tenant_id,
    level: TAKEOFF_LEVEL_C,
    chunk_index: input.metric.index,
    chunk_start_page: input.metric.start,
    chunk_end_page: input.metric.end,
    model: input.metric.model,
    input_tokens: input.metric.input_tokens,
    reasoning_tokens: input.metric.reasoning_tokens,
    output_tokens: input.metric.output_tokens,
    total_tokens: input.metric.token_count,
    cost_cents: input.metric.cost_cents,
    duration_ms: input.metric.duration_ms,
    timed_out: input.metric.timed_out,
    budget_exceeded: input.metric.budget_exceeded,
    status: input.metric.status,
    error_code: input.metric.error_code ?? null,
  };

  if (input.metric.status === "failed") {
    console.error("takeoff.level_c.chunk", payload);
    return;
  }

  console.info("takeoff.level_c.chunk", payload);
}

export function buildLevelCRunMetricRows(input: LevelCChunkMetricWriteInput) {
  const answerRejected = rejectedTakeoffAnswerMetrics(input.hint.errorDetails) !== undefined;
  return input.metrics.map((metric) => ({
    tenant_id: input.job.tenant_id,
    job_id: input.job.id,
    result_id: input.resultId ?? null,
    level: TAKEOFF_LEVEL_C,
    provider: metric.provider,
    model: metric.model,
    chunk_index: metric.index,
    chunk_start_page: metric.start,
    chunk_end_page: metric.end,
    input_tokens: metric.input_tokens,
    reasoning_tokens: metric.reasoning_tokens,
    output_tokens: metric.output_tokens,
    total_tokens: metric.token_count,
    cost_cents: metric.cost_cents,
    duration_ms: metric.duration_ms,
    timed_out: metric.timed_out,
    budget_exceeded: metric.budget_exceeded,
    metadata: {
      status: metric.status,
      source_file_name: input.hint.sourceFileName,
      error_code: metric.error_code ?? null,
      error_message: metric.error_message ?? null,
      error_details: answerRejected && metric.status === "success" ? null : input.hint.errorDetails ?? null,
    },
  }));

}

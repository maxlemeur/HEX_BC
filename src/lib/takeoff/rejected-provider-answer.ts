import { chatGptAnswerFailure } from "@/lib/ai/chatgpt-answer-diagnostic";
import { REJECTED_PROVIDER_ANSWER_MESSAGE } from "@/lib/takeoff/visible-status";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { isRecord } from "@/lib/value-guards";

function metric(value: unknown) {
  // Failure metrics go into nonnegative PostgreSQL integer columns.
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : undefined;
}

export function rejectedTakeoffProviderAnswer(error: unknown, jobId: string, durationMs: number, tileDetails?: {
  paidUsage: number | undefined; truncated: boolean;
}) {
  const failure = chatGptAnswerFailure(error);
  if (!failure) return undefined;

  const usage = failure.usage;
  return new TakeoffError({ code: TakeoffErrorCode.AI_SCHEMA, retryable: false, jobId,
    message: REJECTED_PROVIDER_ANSWER_MESSAGE,
    details: { provider: "chatgpt", diagnosis: failure.diagnosis, duration_ms: metric(durationMs),
      ...(usage && { usage: { input: metric(usage.inputTokens), reasoning: metric(usage.reasoningTokens),
        output: metric(usage.outputTokens), total: metric(usage.totalTokens) } }), ...tileDetails } });
}

export function rejectedTakeoffAnswerMetrics(details: unknown) {
  if (!isRecord(details) || details.provider !== "chatgpt" || !isRecord(details.diagnosis)) return undefined;
  const usage = isRecord(details.usage) ? details.usage : {};
  return { input_tokens: metric(usage.input) ?? 0, reasoning_tokens: metric(usage.reasoning) ?? 0,
    output_tokens: metric(usage.output) ?? 0, token_count: metric(usage.total) ?? 0, duration_ms: metric(details.duration_ms) ?? 0 };
}

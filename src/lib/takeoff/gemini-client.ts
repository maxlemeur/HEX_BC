import { z } from "zod";

import { mapGeminiErrorToTakeoffError, TakeoffError } from "@/lib/takeoff/errors";
import type { TakeoffMetadata } from "@/lib/takeoff/types";
import { zodToGeminiJsonSchema } from "@/lib/takeoff/schemas";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 250;
const MIN_BATCH_POLL_INTERVAL_MS = 2_000;
const MAX_BATCH_POLL_INTERVAL_MS = 30_000;
const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_API_BASE_URL =
  `${GEMINI_API_ROOT}/models`;

type GeminiTokenUsage = {
  promptTokenCount?: number;
  thoughtsTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiProviderResponse = {
  text: string;
  usage: GeminiTokenUsage;
  finishReason?: string | null;
  safetyBlocked?: boolean;
};

type GeminiBatchProviderResponse = GeminiProviderResponse & {
  batchJobName: string;
  batchState: string;
};

type GeminiBatchSubmissionProviderResponse = {
  batchJobName: string;
  batchState: string;
};

type GeminiBatchPollPendingProviderResponse = {
  status: "pending";
  batchJobName: string;
  batchState: string;
};

type GeminiBatchPollSucceededProviderResponse = GeminiProviderResponse & {
  status: "succeeded";
  batchJobName: string;
  batchState: string;
};

type GeminiBatchPollTerminalFailureProviderResponse = {
  status: "failed" | "cancelled" | "expired";
  batchJobName: string;
  batchState: string;
  details?: unknown;
};

type GeminiBatchPollProviderResponse =
  | GeminiBatchPollPendingProviderResponse
  | GeminiBatchPollSucceededProviderResponse
  | GeminiBatchPollTerminalFailureProviderResponse;

type GeminiProviderThinkingLevel = "LOW" | "MEDIUM" | "HIGH";

type GeminiCallLoggerPayload = {
  job_id: string | null;
  tenant_id: string | null;
  level: TakeoffMetadata["level"] | null;
  delivery_mode: "sync" | "batch";
  duration_ms: number;
  input_token_count: number;
  reasoning_token_count: number;
  output_token_count: number;
  token_count: number;
  cost_cents: number;
  status: "success" | "retry" | "failed";
  attempt: number;
  model: string;
  prompt_version: string;
  error_code?: string;
};

type GeminiCallDependencies = {
  invoke?: (input: {
    apiKey: string;
    model: string;
    prompt: string;
    files: GeminiStructuredFile[];
    schema: Record<string, unknown>;
    timeoutMs: number;
    thinkingLevel?: GeminiThinkingLevel;
  }) => Promise<GeminiProviderResponse>;
  invokeBatch?: (input: {
    apiKey: string;
    model: string;
    prompt: string;
    files: GeminiStructuredFile[];
    schema: Record<string, unknown>;
    timeoutMs: number;
    thinkingLevel?: GeminiThinkingLevel;
    onBatchLifecycleEvent?: (
      event: GeminiBatchLifecycleEvent
    ) => Promise<void> | void;
  }) => Promise<GeminiBatchProviderResponse>;
  submitBatch?: (input: {
    apiKey: string;
    model: string;
    prompt: string;
    files: GeminiStructuredFile[];
    schema: Record<string, unknown>;
    timeoutMs: number;
    thinkingLevel?: GeminiThinkingLevel;
    onBatchLifecycleEvent?: (
      event: GeminiBatchLifecycleEvent
    ) => Promise<void> | void;
  }) => Promise<GeminiBatchSubmissionProviderResponse>;
  pollBatchOnce?: (input: {
    apiKey: string;
    batchJobName: string;
    timeoutMs: number;
    onBatchLifecycleEvent?: (
      event: GeminiBatchLifecycleEvent
    ) => Promise<void> | void;
  }) => Promise<GeminiBatchPollProviderResponse>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  apiKey?: string;
  logger?: (payload: GeminiCallLoggerPayload) => void;
};

export type GeminiThinkingLevel = "low" | "medium" | "high";

export type GeminiStructuredFile = {
  data: string;
  mimeType: string;
};

export type GeminiBatchLifecycleEvent = {
  provider: "gemini";
  providerBatchId: string;
  providerBatchStateRaw: string;
  observedAt: string;
  isTerminal: boolean;
  message?: string;
};

export type CallGeminiStructuredContext = {
  jobId?: string;
  tenantId?: string;
  level?: TakeoffMetadata["level"];
  promptVersion?: string;
  model?: string;
};

export type CallGeminiStructuredOptions<T> = {
  prompt: string;
  schema: z.ZodType<T>;
  files?: GeminiStructuredFile[];
  thinkingLevel?: GeminiThinkingLevel;
  timeoutMs?: number;
  maxRetries?: number;
  deliveryMode?: "sync" | "batch";
  context?: CallGeminiStructuredContext;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void> | void;
};

export type CallGeminiStructuredResult<T> = {
  data: T;
  tokenCount: number;
  tokenUsage: GeminiTokenUsageBreakdown;
  costCents: number;
  durationMs: number;
  model: string;
  promptVersion: string;
  providerBatchId: string | null;
  providerBatchStateRaw: string | null;
};

export type SubmitGeminiBatchStructuredResult = {
  durationMs: number;
  model: string;
  promptVersion: string;
  providerBatchId: string;
  providerBatchStateRaw: string;
};

export type PollGeminiBatchStructuredPendingResult = {
  status: "pending";
  durationMs: number;
  model: string;
  promptVersion: string;
  providerBatchId: string;
  providerBatchStateRaw: string;
};

export type PollGeminiBatchStructuredSucceededResult<T> =
  CallGeminiStructuredResult<T> & {
    status: "succeeded";
    providerBatchId: string;
    providerBatchStateRaw: string;
  };

export type PollGeminiBatchStructuredTerminalFailureResult = {
  status: "failed" | "cancelled" | "expired";
  durationMs: number;
  model: string;
  promptVersion: string;
  providerBatchId: string;
  providerBatchStateRaw: string;
  details?: unknown;
};

export type PollGeminiBatchStructuredOnceResult<T> =
  | PollGeminiBatchStructuredPendingResult
  | PollGeminiBatchStructuredSucceededResult<T>
  | PollGeminiBatchStructuredTerminalFailureResult;

export type GeminiTokenUsageBreakdown = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function resolveTimeoutMs(timeoutMs?: number) {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.trunc(timeoutMs);
}

function resolveMaxRetries(maxRetries?: number) {
  if (!Number.isFinite(maxRetries) || maxRetries === undefined) {
    return MAX_RETRIES;
  }

  return Math.max(0, Math.min(MAX_RETRIES, Math.trunc(maxRetries)));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffMs(attemptIndex: number) {
  return BACKOFF_BASE_MS * 2 ** attemptIndex;
}

function timeoutError(timeoutMs: number) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const error = new Error(`Gemini timeout apres ${seconds}s.`);
  (error as Error & { code?: string }).code = "ETIMEDOUT";
  return error;
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function remainingTimeoutMs(startedAt: number, timeoutMs: number) {
  return Math.max(1, timeoutMs - (Date.now() - startedAt));
}

async function fetchWithTimeout(input: {
  url: string;
  init: RequestInit;
  timeoutMs: number;
  timeoutErrorMs?: number;
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    return await fetch(input.url, {
      ...input.init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw timeoutError(input.timeoutErrorMs ?? input.timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractCandidateText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const firstCandidate = candidates[0];
  const candidate = firstCandidate && typeof firstCandidate === "object"
    ? (firstCandidate as Record<string, unknown>)
    : null;
  const content =
    candidate && typeof candidate.content === "object"
      ? (candidate.content as Record<string, unknown>)
      : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];

  const texts = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = (part as Record<string, unknown>).text;
      return typeof value === "string" ? value : "";
    })
    .filter((partText) => partText.length > 0);

  return {
    text: texts.join("\n").trim(),
    finishReason:
      candidate && typeof candidate.finishReason === "string"
        ? candidate.finishReason
        : null,
  };
}

function extractUsage(payload: Record<string, unknown>): GeminiTokenUsage {
  const usageMetadata =
    payload.usageMetadata && typeof payload.usageMetadata === "object"
      ? (payload.usageMetadata as Record<string, unknown>)
      : {};

  return {
    promptTokenCount:
      typeof usageMetadata.promptTokenCount === "number"
        ? usageMetadata.promptTokenCount
        : undefined,
    thoughtsTokenCount:
      typeof usageMetadata.thoughtsTokenCount === "number"
        ? usageMetadata.thoughtsTokenCount
        : undefined,
    candidatesTokenCount:
      typeof usageMetadata.candidatesTokenCount === "number"
        ? usageMetadata.candidatesTokenCount
        : undefined,
    totalTokenCount:
      typeof usageMetadata.totalTokenCount === "number"
        ? usageMetadata.totalTokenCount
        : undefined,
  };
}

function extractBatchInlineResponse(payload: Record<string, unknown>) {
  const response =
    payload.response && typeof payload.response === "object"
      ? (payload.response as Record<string, unknown>)
      : payload;
  const responseDest =
    response.dest && typeof response.dest === "object"
      ? (response.dest as Record<string, unknown>)
      : null;
  const payloadDest =
    payload.dest && typeof payload.dest === "object"
      ? (payload.dest as Record<string, unknown>)
      : null;

  const candidateContainers = [responseDest, payloadDest, response, payload];
  let inlinedResponses: unknown[] = [];

  for (const container of candidateContainers) {
    if (!container) {
      continue;
    }

    if (Array.isArray(container.inlinedResponses)) {
      inlinedResponses = container.inlinedResponses;
      break;
    }

    if (Array.isArray(container.inlined_responses)) {
      inlinedResponses = container.inlined_responses;
      break;
    }
  }

  const firstInlineResponse = inlinedResponses[0];
  if (!firstInlineResponse || typeof firstInlineResponse !== "object") {
    return {
      response: null,
      error: null,
    };
  }

  const inlineRecord = firstInlineResponse as Record<string, unknown>;
  const inlineResponse =
    inlineRecord.response && typeof inlineRecord.response === "object"
      ? (inlineRecord.response as Record<string, unknown>)
      : null;
  const inlineError =
    inlineRecord.error && typeof inlineRecord.error === "object"
      ? (inlineRecord.error as Record<string, unknown>)
      : null;

  return {
    response: inlineResponse,
    error: inlineError,
  };
}

function parseStructuredProviderResponse<T>(input: {
  schema: z.ZodType<T>;
  providerResult: GeminiProviderResponse;
  model: string;
  promptVersion: string;
  startedAt: number;
  now: () => number;
}): CallGeminiStructuredResult<T> {
  if (input.providerResult.safetyBlocked) {
    throw new TakeoffError({
      code: "AI_SAFETY",
      retryable: false,
    });
  }

  if (!input.providerResult.text || input.providerResult.text.trim().length === 0) {
    throw new TakeoffError({
      code: "AI_SCHEMA",
      retryable: false,
      message: "La reponse Gemini est vide.",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.providerResult.text);
  } catch {
    throw new TakeoffError({
      code: "AI_SCHEMA",
      retryable: false,
      message: "La reponse Gemini n'est pas un JSON valide.",
    });
  }

  const data = input.schema.parse(parsed);
  const tokenUsage = toTokenUsageBreakdown(input.providerResult.usage);
  const tokenCount = tokenUsage.totalTokens;
  const costCents = estimateCostCents(input.model, input.providerResult.usage);

  return {
    data,
    tokenCount,
    tokenUsage,
    costCents,
    durationMs: input.now() - input.startedAt,
    model: input.model,
    promptVersion: input.promptVersion,
    providerBatchId: null,
    providerBatchStateRaw: null,
  };
}

async function emitBatchLifecycleEvent(
  input: {
    onBatchLifecycleEvent?: (
      event: GeminiBatchLifecycleEvent
    ) => Promise<void> | void;
  },
  providerBatchId: string,
  providerBatchStateRaw: string,
  isTerminal: boolean,
  message?: string
) {
  if (!input.onBatchLifecycleEvent) {
    return;
  }

  await input.onBatchLifecycleEvent({
    provider: "gemini",
    providerBatchId,
    providerBatchStateRaw,
    observedAt: new Date().toISOString(),
    isTerminal,
    message,
  });
}

function buildGeminiGenerateContentRequest(input: {
  prompt: string;
  files: GeminiStructuredFile[];
  schema: Record<string, unknown>;
  thinkingLevel?: GeminiThinkingLevel;
  model: string;
}) {
  const contents = [
    {
      parts: [
        { text: input.prompt },
        ...input.files.map((file) => ({
          inlineData: {
            data: file.data,
            mimeType: file.mimeType,
          },
        })),
      ],
    },
  ];

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: input.schema,
  };

  if (input.thinkingLevel && supportsGemini3ThinkingLevel(input.model)) {
    generationConfig.thinkingConfig = {
      thinkingLevel: toGeminiProviderThinkingLevel(input.thinkingLevel),
    };
  }

  return {
    contents,
    generationConfig,
  };
}

async function invokeGeminiApi(input: {
  apiKey: string;
  model: string;
  prompt: string;
  files: GeminiStructuredFile[];
  schema: Record<string, unknown>;
  timeoutMs: number;
  thinkingLevel?: GeminiThinkingLevel;
}): Promise<GeminiProviderResponse> {
  const payload = buildGeminiGenerateContentRequest(input);

  try {
    const response = await fetchWithTimeout({
      url: `${GEMINI_API_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs: input.timeoutMs,
    });

    const responseText = await response.text();
    let jsonPayload: Record<string, unknown> = {};

    if (responseText.trim().length > 0) {
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && typeof parsed === "object") {
          jsonPayload = parsed as Record<string, unknown>;
        }
      } catch {
        if (response.ok) {
          throw new Error("Gemini a retourne une reponse JSON invalide.");
        }
      }
    }

    if (!response.ok) {
      const providerError = new Error(
        `Gemini provider error (${response.status}).`
      );
      (providerError as Error & { status?: number; details?: unknown }).status =
        response.status;
      (providerError as Error & { status?: number; details?: unknown }).details =
        jsonPayload;
      throw providerError;
    }

    const candidateInfo = extractCandidateText(jsonPayload);
    const promptFeedback =
      jsonPayload.promptFeedback && typeof jsonPayload.promptFeedback === "object"
        ? (jsonPayload.promptFeedback as Record<string, unknown>)
        : null;
    const blockReason =
      promptFeedback && typeof promptFeedback.blockReason === "string"
        ? promptFeedback.blockReason
        : null;

    return {
      text: candidateInfo.text,
      finishReason: candidateInfo.finishReason,
      safetyBlocked:
        candidateInfo.finishReason?.toUpperCase() === "SAFETY" ||
        blockReason?.toUpperCase() === "SAFETY",
      usage: extractUsage(jsonPayload),
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw timeoutError(input.timeoutMs);
    }

    throw error;
  }
}

async function submitGeminiBatchApi(input: {
  apiKey: string;
  model: string;
  prompt: string;
  files: GeminiStructuredFile[];
  schema: Record<string, unknown>;
  timeoutMs: number;
  thinkingLevel?: GeminiThinkingLevel;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void> | void;
}): Promise<GeminiBatchSubmissionProviderResponse> {
  const createResponse = await fetchWithTimeout({
    url: `${GEMINI_API_BASE_URL}/${encodeURIComponent(input.model)}:batchGenerateContent`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        batch: {
          display_name: `takeoff-${Date.now()}`,
          input_config: {
            requests: {
              requests: [
                {
                  request: buildGeminiGenerateContentRequest(input),
                  metadata: {
                    key: "takeoff-request-0",
                  },
                },
              ],
            },
          },
        },
      }),
    },
    timeoutMs: input.timeoutMs,
    timeoutErrorMs: input.timeoutMs,
  });

  const createPayloadText = await createResponse.text();
  let createPayload: Record<string, unknown> = {};
  if (createPayloadText.trim().length > 0) {
    try {
      const parsed = JSON.parse(createPayloadText);
      if (parsed && typeof parsed === "object") {
        createPayload = parsed as Record<string, unknown>;
      }
    } catch {
      if (createResponse.ok) {
        throw new Error("Gemini Batch API a retourne une reponse JSON invalide.");
      }
    }
  }

  if (!createResponse.ok) {
    const providerError = new Error(
      `Gemini Batch provider error (${createResponse.status}).`
    );
    (providerError as Error & { status?: number; details?: unknown }).status =
      createResponse.status;
    (providerError as Error & { status?: number; details?: unknown }).details =
      createPayload;
    throw providerError;
  }

  const batchJobName = typeof createPayload.name === "string" ? createPayload.name : null;
  if (!batchJobName) {
    throw new Error("Gemini Batch API n'a pas retourne de nom de job.");
  }

  const createMetadata =
    createPayload.metadata && typeof createPayload.metadata === "object"
      ? (createPayload.metadata as Record<string, unknown>)
      : {};
  const initialBatchState =
    typeof createMetadata.state === "string"
      ? createMetadata.state
      : "JOB_STATE_SUBMITTED";
  await emitBatchLifecycleEvent(
    input,
    batchJobName,
    initialBatchState,
    false,
    "Batch Gemini soumis au provider."
  );

  return {
    batchJobName,
    batchState: initialBatchState,
  };
}

async function pollGeminiBatchApiOnce(input: {
  apiKey: string;
  batchJobName: string;
  timeoutMs: number;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void> | void;
}): Promise<GeminiBatchPollProviderResponse> {
  const pollResponse = await fetchWithTimeout({
    url: `${GEMINI_API_ROOT}/${input.batchJobName}`,
    init: {
      method: "GET",
      headers: {
        "x-goog-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
    },
    timeoutMs: input.timeoutMs,
    timeoutErrorMs: input.timeoutMs,
  });

  const pollPayloadText = await pollResponse.text();
  let pollPayload: Record<string, unknown> = {};
  if (pollPayloadText.trim().length > 0) {
    try {
      const parsed = JSON.parse(pollPayloadText);
      if (parsed && typeof parsed === "object") {
        pollPayload = parsed as Record<string, unknown>;
      }
    } catch {
      if (pollResponse.ok) {
        throw new Error("Gemini Batch API a retourne un statut JSON invalide.");
      }
    }
  }

  if (!pollResponse.ok) {
    const providerError = new Error(
      `Gemini Batch provider status error (${pollResponse.status}).`
    );
    (providerError as Error & { status?: number; details?: unknown }).status =
      pollResponse.status;
    (providerError as Error & { status?: number; details?: unknown }).details =
      pollPayload;
    throw providerError;
  }

  const metadata =
    pollPayload.metadata && typeof pollPayload.metadata === "object"
      ? (pollPayload.metadata as Record<string, unknown>)
      : {};
  const batchState =
    typeof metadata.state === "string" ? metadata.state : "JOB_STATE_PENDING";
  const done = pollPayload.done === true;
  const isTerminalState =
    done ||
    batchState === "JOB_STATE_SUCCEEDED" ||
    batchState === "JOB_STATE_FAILED" ||
    batchState === "JOB_STATE_CANCELLED" ||
    batchState === "JOB_STATE_CANCELED" ||
    batchState === "JOB_STATE_EXPIRED";

  await emitBatchLifecycleEvent(
    input,
    input.batchJobName,
    batchState,
    isTerminalState,
    isTerminalState
      ? `Batch Gemini termine avec l'etat ${batchState}.`
      : `Batch Gemini en transition vers ${batchState}.`
  );

  if (batchState === "JOB_STATE_FAILED") {
    return {
      status: "failed",
      batchJobName: input.batchJobName,
      batchState,
      details: pollPayload,
    };
  }

  if (batchState === "JOB_STATE_CANCELLED" || batchState === "JOB_STATE_CANCELED") {
    return {
      status: "cancelled",
      batchJobName: input.batchJobName,
      batchState,
      details: pollPayload,
    };
  }

  if (batchState === "JOB_STATE_EXPIRED") {
    return {
      status: "expired",
      batchJobName: input.batchJobName,
      batchState,
      details: pollPayload,
    };
  }

  if (!done && batchState !== "JOB_STATE_SUCCEEDED") {
    return {
      status: "pending",
      batchJobName: input.batchJobName,
      batchState,
    };
  }

  const { response: inlineResponse, error: inlineError } =
    extractBatchInlineResponse(pollPayload);

  if (inlineError) {
    const providerError = new Error("Gemini Batch API request failed.");
    (providerError as Error & { details?: unknown }).details = inlineError;
    throw providerError;
  }

  if (!inlineResponse) {
    throw new Error("Gemini Batch API n'a retourne aucune reponse inline exploitable.");
  }

  const candidateInfo = extractCandidateText(inlineResponse);
  const promptFeedback =
    inlineResponse.promptFeedback && typeof inlineResponse.promptFeedback === "object"
      ? (inlineResponse.promptFeedback as Record<string, unknown>)
      : null;
  const blockReason =
    promptFeedback && typeof promptFeedback.blockReason === "string"
      ? promptFeedback.blockReason
      : null;

  return {
    status: "succeeded",
    text: candidateInfo.text,
    finishReason: candidateInfo.finishReason,
    safetyBlocked:
      candidateInfo.finishReason?.toUpperCase() === "SAFETY" ||
      blockReason?.toUpperCase() === "SAFETY",
    usage: extractUsage(inlineResponse),
    batchJobName: input.batchJobName,
    batchState,
  };
}

async function invokeGeminiBatchApi(input: {
  apiKey: string;
  model: string;
  prompt: string;
  files: GeminiStructuredFile[];
  schema: Record<string, unknown>;
  timeoutMs: number;
  thinkingLevel?: GeminiThinkingLevel;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void> | void;
}): Promise<GeminiBatchProviderResponse> {
  const startedAt = Date.now();
  const submission = await submitGeminiBatchApi(input);
  const pollIntervalMs = Math.max(
    MIN_BATCH_POLL_INTERVAL_MS,
    Math.min(MAX_BATCH_POLL_INTERVAL_MS, Math.trunc(input.timeoutMs / 6))
  );

  while (Date.now() - startedAt < input.timeoutMs) {
    const pollResult = await pollGeminiBatchApiOnce({
      apiKey: input.apiKey,
      batchJobName: submission.batchJobName,
      timeoutMs: remainingTimeoutMs(startedAt, input.timeoutMs),
      onBatchLifecycleEvent: input.onBatchLifecycleEvent,
    });

    if (pollResult.status === "pending") {
      await delay(
        Math.min(pollIntervalMs, remainingTimeoutMs(startedAt, input.timeoutMs))
      );
      continue;
    }

    if (
      pollResult.status === "failed" ||
      pollResult.status === "cancelled" ||
      pollResult.status === "expired"
    ) {
      const providerError = new Error(
        `Gemini Batch job ended in state ${pollResult.batchState}.`
      );
      (providerError as Error & { details?: unknown }).details = pollResult.details;
      throw providerError;
    }

    if (pollResult.status !== "succeeded") {
      continue;
    }

    return {
      text: pollResult.text,
      finishReason: pollResult.finishReason,
      safetyBlocked: pollResult.safetyBlocked,
      usage: pollResult.usage,
      batchJobName: pollResult.batchJobName,
      batchState: pollResult.batchState,
    };
  }

  throw timeoutError(input.timeoutMs);
}

function toTokenUsageBreakdown(usage: GeminiTokenUsage): GeminiTokenUsageBreakdown {
  const inputTokens = Math.max(0, usage.promptTokenCount ?? 0);
  const reasoningTokens = Math.max(0, usage.thoughtsTokenCount ?? 0);
  const outputTokens = Math.max(0, usage.candidatesTokenCount ?? 0);
  const totalTokens = Math.max(
    0,
    typeof usage.totalTokenCount === "number"
      ? usage.totalTokenCount
      : inputTokens + reasoningTokens + outputTokens
  );

  return {
    inputTokens,
    reasoningTokens,
    outputTokens,
    totalTokens,
  };
}

function estimateCostCents(model: string, usage: GeminiTokenUsage) {
  const promptTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;

  const normalizedModel = model.trim().toLowerCase();
  let pricing: { input: number; output: number } | null = null;

  if (normalizedModel === "gemini-3.1-pro-preview") {
    pricing =
      promptTokens > 200_000
        ? { input: 4, output: 18 }
        : { input: 2, output: 12 };
  } else if (normalizedModel === "gemini-3-flash-preview") {
    pricing = { input: 0.5, output: 3 };
  } else if (normalizedModel === "gemini-3.1-flash-lite-preview") {
    pricing = { input: 0.25, output: 1.5 };
  } else if (normalizedModel === "gemini-3-pro-preview") {
    pricing = { input: 2, output: 12 };
  }

  if (!pricing) return 0;

  const usd =
    (promptTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return Math.max(0, Math.round(usd * 100));
}

function supportsGemini3ThinkingLevel(model: string) {
  return model.trim().toLowerCase().startsWith("gemini-3");
}

function toGeminiProviderThinkingLevel(
  thinkingLevel: GeminiThinkingLevel
): GeminiProviderThinkingLevel {
  switch (thinkingLevel) {
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}

export async function submitGeminiBatchStructured<T>(
  options: Omit<CallGeminiStructuredOptions<T>, "deliveryMode">,
  deps: GeminiCallDependencies = {}
): Promise<SubmitGeminiBatchStructuredResult> {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new TakeoffError({
      code: "AI_PROVIDER",
      retryable: false,
      message: "La variable serveur GEMINI_API_KEY est manquante.",
    });
  }

  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const maxRetries = resolveMaxRetries(options.maxRetries);
  const submitBatch = deps.submitBatch ?? submitGeminiBatchApi;
  const sleep = deps.sleep ?? delay;
  const now = deps.now ?? (() => Date.now());
  const model = options.context?.model ?? DEFAULT_MODEL;
  const promptVersion = options.context?.promptVersion ?? "unknown";
  const startedAt = now();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const providerResult = await submitBatch({
        apiKey,
        model,
        prompt: options.prompt,
        files: options.files ?? [],
        schema: zodToGeminiJsonSchema(options.schema),
        timeoutMs,
        thinkingLevel: options.thinkingLevel,
        onBatchLifecycleEvent: options.onBatchLifecycleEvent,
      });

      return {
        durationMs: now() - startedAt,
        model,
        promptVersion,
        providerBatchId: providerResult.batchJobName,
        providerBatchStateRaw: providerResult.batchState,
      };
    } catch (error) {
      const mapped = mapGeminiErrorToTakeoffError(error);
      const shouldRetry = mapped.retryable && attempt < maxRetries;

      if (!shouldRetry) {
        throw mapped;
      }

      await sleep(backoffMs(attempt));
    }
  }

  throw new TakeoffError({
    code: "AI_PROVIDER",
    retryable: false,
    message: "La soumission Gemini Batch a echoue apres epuisement des retries.",
  });
}

export async function pollGeminiBatchStructuredOnce<T>(
  options: Omit<CallGeminiStructuredOptions<T>, "deliveryMode" | "files"> & {
    providerBatchId: string;
  },
  deps: GeminiCallDependencies = {}
): Promise<PollGeminiBatchStructuredOnceResult<T>> {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new TakeoffError({
      code: "AI_PROVIDER",
      retryable: false,
      message: "La variable serveur GEMINI_API_KEY est manquante.",
    });
  }

  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const pollBatchOnce = deps.pollBatchOnce ?? pollGeminiBatchApiOnce;
  const now = deps.now ?? (() => Date.now());
  const model = options.context?.model ?? DEFAULT_MODEL;
  const promptVersion = options.context?.promptVersion ?? "unknown";
  const startedAt = now();
  const pollResult = await pollBatchOnce({
    apiKey,
    batchJobName: options.providerBatchId,
    timeoutMs,
    onBatchLifecycleEvent: options.onBatchLifecycleEvent,
  });

  if (pollResult.status === "pending") {
    return {
      status: "pending",
      durationMs: now() - startedAt,
      model,
      promptVersion,
      providerBatchId: pollResult.batchJobName,
      providerBatchStateRaw: pollResult.batchState,
    };
  }

  if (
    pollResult.status === "failed" ||
    pollResult.status === "cancelled" ||
    pollResult.status === "expired"
  ) {
    return {
      status: pollResult.status,
      durationMs: now() - startedAt,
      model,
      promptVersion,
      providerBatchId: pollResult.batchJobName,
      providerBatchStateRaw: pollResult.batchState,
      details: pollResult.details,
    };
  }

  if (pollResult.status !== "succeeded") {
    throw new TakeoffError({
      code: "AI_PROVIDER",
      retryable: false,
      message: "Etat batch Gemini inattendu lors de la reconciliation.",
    });
  }

  const parsed = parseStructuredProviderResponse({
    schema: options.schema,
    providerResult: pollResult,
    model,
    promptVersion,
    startedAt,
    now,
  });

  return {
    ...parsed,
    status: "succeeded",
    providerBatchId: pollResult.batchJobName,
    providerBatchStateRaw: pollResult.batchState,
  };
}

export async function callGeminiStructured<T>(
  options: CallGeminiStructuredOptions<T>,
  deps: GeminiCallDependencies = {}
): Promise<CallGeminiStructuredResult<T>> {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new TakeoffError({
      code: "AI_PROVIDER",
      retryable: false,
      message: "La variable serveur GEMINI_API_KEY est manquante.",
    });
  }

  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const maxRetries = resolveMaxRetries(options.maxRetries);
  const invoke = deps.invoke ?? invokeGeminiApi;
  const invokeBatch = deps.invokeBatch ?? invokeGeminiBatchApi;
  const sleep = deps.sleep ?? delay;
  const now = deps.now ?? (() => Date.now());
  const model = options.context?.model ?? DEFAULT_MODEL;
  const promptVersion = options.context?.promptVersion ?? "unknown";
  const deliveryMode = options.deliveryMode ?? "sync";
  let batchSubmissionObserved = false;

  const logger =
    deps.logger ??
    ((payload: GeminiCallLoggerPayload) => {
      if (payload.status === "failed") {
        console.error("takeoff.gemini.call", payload);
        return;
      }

      console.info("takeoff.gemini.call", payload);
    });

  const startedAt = now();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const providerResult =
        deliveryMode === "batch"
          ? await invokeBatch({
              apiKey,
              model,
              prompt: options.prompt,
              files: options.files ?? [],
              schema: zodToGeminiJsonSchema(options.schema),
              timeoutMs,
              thinkingLevel: options.thinkingLevel,
              onBatchLifecycleEvent: async (event) => {
                batchSubmissionObserved = true;
                await options.onBatchLifecycleEvent?.(event);
              },
            })
          : await invoke({
              apiKey,
              model,
              prompt: options.prompt,
              files: options.files ?? [],
              schema: zodToGeminiJsonSchema(options.schema),
              timeoutMs,
              thinkingLevel: options.thinkingLevel,
            });
      const parsed = parseStructuredProviderResponse({
        schema: options.schema,
        providerResult,
        model,
        promptVersion,
        startedAt,
        now,
      });
      const tokenUsage = parsed.tokenUsage;
      const tokenCount = parsed.tokenCount;
      const costCents = parsed.costCents;
      const durationMs = parsed.durationMs;

      logger({
        job_id: options.context?.jobId ?? null,
        tenant_id: options.context?.tenantId ?? null,
        level: options.context?.level ?? null,
        delivery_mode: deliveryMode,
        duration_ms: durationMs,
        input_token_count: tokenUsage.inputTokens,
        reasoning_token_count: tokenUsage.reasoningTokens,
        output_token_count: tokenUsage.outputTokens,
        token_count: tokenCount,
        cost_cents: costCents,
        status: "success",
        attempt: attempt + 1,
        model,
        prompt_version: promptVersion,
      });

      return {
        ...parsed,
        providerBatchId:
          "batchJobName" in providerResult &&
          typeof providerResult.batchJobName === "string"
            ? providerResult.batchJobName
            : null,
        providerBatchStateRaw:
          "batchState" in providerResult &&
          typeof providerResult.batchState === "string"
            ? providerResult.batchState
            : null,
      };
    } catch (error) {
      const mapped = mapGeminiErrorToTakeoffError(error);
      const shouldRetry =
        mapped.retryable &&
        attempt < maxRetries &&
        !(deliveryMode === "batch" && batchSubmissionObserved);
      const durationMs = now() - startedAt;

      logger({
        job_id: options.context?.jobId ?? null,
        tenant_id: options.context?.tenantId ?? null,
        level: options.context?.level ?? null,
        delivery_mode: deliveryMode,
        duration_ms: durationMs,
        input_token_count: 0,
        reasoning_token_count: 0,
        output_token_count: 0,
        token_count: 0,
        cost_cents: 0,
        status: shouldRetry ? "retry" : "failed",
        attempt: attempt + 1,
        model,
        prompt_version: promptVersion,
        error_code: mapped.code,
      });

      if (!shouldRetry) {
        throw mapped;
      }

      await sleep(backoffMs(attempt));
    }
  }

  throw new TakeoffError({
    code: "AI_PROVIDER",
    retryable: false,
    message: "L'appel Gemini a echoue apres epuisement des retries.",
  });
}

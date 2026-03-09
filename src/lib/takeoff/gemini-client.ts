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

  const inlinedResponses = Array.isArray(response.inlinedResponses)
    ? response.inlinedResponses
    : Array.isArray(response.inlined_responses)
      ? response.inlined_responses
      : [];
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);
  const payload = buildGeminiGenerateContentRequest(input);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );

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
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw timeoutError(input.timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
  async function emitBatchLifecycleEvent(
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

  const startedAt = Date.now();
  const createResponse = await fetch(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(input.model)}:batchGenerateContent`,
    {
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
    }
  );

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
  let lastEmittedState: string | null = null;

  await emitBatchLifecycleEvent(
    batchJobName,
    initialBatchState,
    false,
    "Batch Gemini soumis au provider."
  );
  lastEmittedState = initialBatchState;

  const pollIntervalMs = Math.max(
    MIN_BATCH_POLL_INTERVAL_MS,
    Math.min(MAX_BATCH_POLL_INTERVAL_MS, Math.trunc(input.timeoutMs / 6))
  );

  while (Date.now() - startedAt < input.timeoutMs) {
    const pollResponse = await fetch(`${GEMINI_API_ROOT}/${batchJobName}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
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

    if (batchState !== lastEmittedState) {
      const isTerminalState =
        done ||
        batchState === "JOB_STATE_SUCCEEDED" ||
        batchState === "JOB_STATE_FAILED" ||
        batchState === "JOB_STATE_CANCELLED" ||
        batchState === "JOB_STATE_EXPIRED";

      await emitBatchLifecycleEvent(
        batchJobName,
        batchState,
        isTerminalState,
        isTerminalState
          ? `Batch Gemini termine avec l'etat ${batchState}.`
          : `Batch Gemini en transition vers ${batchState}.`
      );
      lastEmittedState = batchState;
    }

    if (done || batchState === "JOB_STATE_SUCCEEDED") {
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
        text: candidateInfo.text,
        finishReason: candidateInfo.finishReason,
        safetyBlocked:
          candidateInfo.finishReason?.toUpperCase() === "SAFETY" ||
          blockReason?.toUpperCase() === "SAFETY",
        usage: extractUsage(inlineResponse),
        batchJobName,
        batchState,
      };
    }

    if (
      batchState === "JOB_STATE_FAILED" ||
      batchState === "JOB_STATE_CANCELLED" ||
      batchState === "JOB_STATE_EXPIRED"
    ) {
      const providerError = new Error(`Gemini Batch job ended in state ${batchState}.`);
      (providerError as Error & { details?: unknown }).details = pollPayload;
      throw providerError;
    }

    await delay(pollIntervalMs);
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

      if (providerResult.safetyBlocked) {
        throw new TakeoffError({
          code: "AI_SAFETY",
          retryable: false,
        });
      }

      if (!providerResult.text || providerResult.text.trim().length === 0) {
        throw new TakeoffError({
          code: "AI_SCHEMA",
          retryable: false,
          message: "La reponse Gemini est vide.",
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(providerResult.text);
      } catch {
        throw new TakeoffError({
          code: "AI_SCHEMA",
          retryable: false,
          message: "La reponse Gemini n'est pas un JSON valide.",
        });
      }

      const data = options.schema.parse(parsed);
      const tokenUsage = toTokenUsageBreakdown(providerResult.usage);
      const tokenCount = tokenUsage.totalTokens;
      const costCents = estimateCostCents(model, providerResult.usage);
      const durationMs = now() - startedAt;

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
        data,
        tokenCount,
        tokenUsage,
        costCents,
        durationMs,
        model,
        promptVersion,
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

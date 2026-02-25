import { z } from "zod";

import { mapGeminiErrorToTakeoffError, TakeoffError } from "@/lib/takeoff/errors";
import type { TakeoffMetadata } from "@/lib/takeoff/types";
import { zodToGeminiJsonSchema } from "@/lib/takeoff/schemas";

const DEFAULT_MODEL = "gemini-2.5-pro";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 250;
const GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

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

type GeminiCallLoggerPayload = {
  job_id: string | null;
  tenant_id: string | null;
  level: TakeoffMetadata["level"] | null;
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
  context?: CallGeminiStructuredContext;
};

export type CallGeminiStructuredResult<T> = {
  data: T;
  tokenCount: number;
  tokenUsage: GeminiTokenUsageBreakdown;
  costCents: number;
  durationMs: number;
  model: string;
  promptVersion: string;
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

  const payload = {
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: input.schema,
    },
    ...(input.thinkingLevel
      ? {
          thinkingConfig: {
            thinkingLevel: input.thinkingLevel,
          },
        }
      : {}),
  };

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

  const pricingUsdPerMillion: Record<string, { input: number; output: number }> = {
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  };

  const pricing = pricingUsdPerMillion[model];
  if (!pricing) {
    return 0;
  }

  const usd =
    (promptTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return Math.max(0, Math.round(usd * 100));
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
  const sleep = deps.sleep ?? delay;
  const now = deps.now ?? (() => Date.now());
  const model = options.context?.model ?? DEFAULT_MODEL;
  const promptVersion = options.context?.promptVersion ?? "unknown";

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
      const providerResult = await invoke({
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
      };
    } catch (error) {
      const mapped = mapGeminiErrorToTakeoffError(error);
      const shouldRetry = mapped.retryable && attempt < maxRetries;
      const durationMs = now() - startedAt;

      logger({
        job_id: options.context?.jobId ?? null,
        tenant_id: options.context?.tenantId ?? null,
        level: options.context?.level ?? null,
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

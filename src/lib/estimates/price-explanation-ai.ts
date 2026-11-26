import "server-only";

import type { z } from "zod";

import { ApiKeyError, isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import type { PriceExplanationGeneration, PriceExplanationSettings } from "@/lib/estimates/explanation-schemas";
import { conflict, unprocessableEntity } from "@/lib/http/api-response";

const POLICY = { allowedSources: ["chatgpt_plan", "personal_api_key"] } as const;
const TIMEOUT_MS = 60_000;
type Owner = { userId: string; tenantId: string };

export async function readPriceExplanationSettings(owner: Owner, catalogue: "live" | "cached"): Promise<PriceExplanationSettings> {
  const { defaultSource, options } = await readAiRequestOptions(owner, POLICY, catalogue);
  function view(option: typeof options.chatgpt_plan): PriceExplanationSettings["sources"]["chatgpt_plan"] {
    return option?.ok
      ? { available: true, message: option.message, models: option.models, preferences: option.preferences }
      : { available: false, message: option?.message ?? "Source indisponible." };
  }
  return {
    defaultSource,
    sources: { chatgpt_plan: view(options.chatgpt_plan), personal_api_key: view(options.personal_api_key) },
    connectionId: options.personal_api_key?.ok ? options.personal_api_key.connection?.id ?? null : null,
    canRefreshPlanModels: options.chatgpt_plan?.ok === true || options.chatgpt_plan?.reason === "no_model",
  };
}

export async function generatePriceExplanationNarrative<T>(input: {
  owner: Owner;
  settings: PriceExplanationGeneration;
  prompt: string;
  promptVersion: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}) {
  const { owner, settings, prompt, promptVersion, schema, signal } = input;
  const selection = await resolveAiRequest(owner, POLICY, {
    source: settings.source,
    model: settings.model,
    effort: settings.reasoningEffort,
    ...(settings.source === "personal_api_key" && { expectedConnectionId: settings.connectionId }),
  });
  if (!selection.ok) {
    throw conflict(selection.message, undefined, "PRICE_EXPLANATION_SETTINGS_UNAVAILABLE");
  }

  const reasoningEffort = selection.preferences.reasoningEffort;
  try {
    signal?.throwIfAborted();
    if (selection.connection) {
      const ceiling = AI_REQUEST_CEILINGS_NANO_USD.shortQuestion;
      const api = openAiApiKeyAccess();
      const prepared = await api.prepare(owner, {
        ...selection.preferences, expectedVersion: selection.connection.version, prompt, schema,
        files: [], allotmentNanoUsd: ceiling, outputCap: 8_192, minOutputTokens: 1_024, signal,
      });
      const result = await api.execute<T>(owner, prepared, { timeoutMs: TIMEOUT_MS, signal });
      if (result.costNanoUsd === null) throw new ApiKeyError("AI_KEY_COST_UNKNOWN");
      if (result.costNanoUsd > ceiling) {
        throw new ApiKeyError("AI_KEY_CEILING_EXCEEDED", {
          detail: { ceiling: formatUsdCeiling(ceiling), cost: formatUsdCeiling(result.costNanoUsd) },
        });
      }
      if (result.data === null) throw unprocessableEntity("La clé API OpenAI n’a pas renvoyé d’explication exploitable.");
      return {
        narrative: result.data, provider: "openai", model: result.model,
        aiRequest: { source: selection.source, model: result.model, reasoningEffort: prepared.reasoningEffort },
      };
    }

    const result = await callStructuredAi({
      prompt, schema, timeoutMs: TIMEOUT_MS, signal, context: { tenantId: owner.tenantId, promptVersion },
    }, owner, selection.preferences);
    return {
      narrative: result.data, provider: result.provider, model: result.model,
      aiRequest: { source: selection.source, model: result.model, reasoningEffort },
    };
  } catch (error) {
    if (isApiKeyError(error)) throw conflict(error.message, undefined, error.code);
    if (error instanceof StructuredAiError) throw conflict(error.message, undefined, error.code);
    throw unprocessableEntity("Impossible d’obtenir une explication exploitable avec les réglages choisis.");
  }
}

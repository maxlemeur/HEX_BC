import "server-only";

import { headers } from "next/headers";
import type { z } from "zod";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import type { ApiKeyOfferedModel } from "@/lib/ai/access/contracts";
import { openAiApiKeyAccess, type ApiKeyStructuredFile } from "@/lib/ai/access/openai-api";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { RETIRED_OPENAI_MODEL, type ChatGptAvailableModel, type ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import { AI_REQUEST_PROFILE_UNREADABLE } from "@/lib/ai/request-settings";
import { AI_REQUEST_KEY_MISSING, aiRequestApiKeyOptions, readAiRequestOptions, resolveAiRequestModel, resolveAiRequestSource } from "@/lib/ai/request-settings-server";
import { callStructuredAi, getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { conflict, unprocessableEntity } from "@/lib/http/api-response";

import {
  MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE,
  type MaterialRequestPhotoAnalysisAvailability,
  type MaterialRequestPhotoAnalysisInput,
} from "./photo-analysis";
import type { MaterialRequestContext } from "./server-shared";

/** Shared AI setup for request originals and supplier quote attachments. */
export const MATERIAL_REQUEST_ANALYSIS_DISABLED: MaterialRequestPhotoAnalysisAvailability = {
  status: "disabled",
  message: "L’analyse IA des photos est indisponible sur cette instance : elle est proposée dans MergeOne en local.",
};
const UNREADABLE_AVAILABILITY_MESSAGE =
  "La connexion ChatGPT ne peut pas être lue. Reconnectez votre forfait dans Mon profil.";

const REQUEST_POLICY = {
  usage: "photos", allowedSources: ["chatgpt_plan", "personal_api_key"], sourcePolicy: "profile",
} as const;

type AnalysisModelOptions = { preferences: ChatGptPreferences | null } & (
  | { billingSource: "chatgpt_plan"; models: ChatGptAvailableModel[]; connectionId: null }
  | { billingSource: "personal_api_key"; models: ApiKeyOfferedModel[]; connectionId: string | null }
);

export async function readPhotoAnalysisModelOptions(
  owner: Pick<MaterialRequestContext, "userId" | "tenantId">,
): Promise<AnalysisModelOptions> {
  const { defaultSource: billingSource, options } = await readAiRequestOptions(owner, REQUEST_POLICY);
  if (!billingSource) throw new Error(AI_REQUEST_PROFILE_UNREADABLE);
  const option = options[billingSource];
  if (option?.ok === false && option.reason === "no_model") {
    return { billingSource, models: [], connectionId: null, preferences: null };
  }
  if (!option?.ok) throw new Error(option?.message);
  if (billingSource === "personal_api_key") {
    if (!option.connection) throw new Error(AI_REQUEST_KEY_MISSING);
    return { billingSource, models: option.models, connectionId: option.connection.id, preferences: option.preferences };
  }
  return { billingSource, models: option.models, connectionId: null, preferences: option.preferences };
}

/** A cheap readiness check for the editor, without fetching the plan's catalogue. */
export async function getMaterialRequestPhotoAnalysisAvailability(
  context: Pick<MaterialRequestContext, "userId" | "tenantId">,
): Promise<MaterialRequestPhotoAnalysisAvailability> {
  if (!isLocalChatGptEnabled()) return MATERIAL_REQUEST_ANALYSIS_DISABLED;
  try {
    const state = await openAiApiKeyAccess().state(context);
    if ("notice" in state && state.notice) return { status: "unavailable", message: AI_REQUEST_PROFILE_UNREADABLE };
    if (state.analysisPreferences?.billingSource === "personal_api_key") {
      return aiRequestApiKeyOptions(state, REQUEST_POLICY.usage).ok
        ? { status: "available", message: "Clé API OpenAI sélectionnée pour les analyses photo." }
        : { status: "unavailable", message: AI_REQUEST_KEY_MISSING };
    }
    const availability = await getStructuredAiAvailability(context, { allowUnselectedModel: true });
    return { status: availability.available ? "available" : "unavailable", message: availability.message };
  } catch {
    return { status: "unavailable", message: UNREADABLE_AVAILABILITY_MESSAGE };
  }
}

export function materialRequestAnalysisUnavailable(message: string, status: MaterialRequestPhotoAnalysisAvailability["status"]) {
  return conflict(message, { status }, MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE);
}

function materialRequestAnalysisSettingsUnavailable(message: string) {
  return conflict(message, undefined, "MATERIAL_REQUEST_PHOTO_SETTINGS_UNAVAILABLE");
}

export function materialRequestAnalysisModelUnavailable(message: string) {
  return unprocessableEntity(message, undefined, "MATERIAL_REQUEST_ANALYSIS_MODEL_UNAVAILABLE");
}

/** Resolve billing once before reading an attachment and run it on the same verified connection. */
export async function prepareMaterialRequestDocumentAnalysis(
  context: MaterialRequestContext,
  settings: MaterialRequestPhotoAnalysisInput,
) {
  const { preferences, billingSource, connectionId } = settings;
  if (preferences?.model === RETIRED_OPENAI_MODEL) {
    throw materialRequestAnalysisModelUnavailable("Ce modèle n’est plus proposé. Rechargez la demande pour reprendre.");
  }
  if (!isLocalChatGptEnabled()) throw materialRequestAnalysisUnavailable(MATERIAL_REQUEST_ANALYSIS_DISABLED.message, "disabled");

  const api = openAiApiKeyAccess();
  let keyCall: { preferences: NonNullable<typeof preferences>; expectedVersion: number } | null = null;
  if (billingSource === "personal_api_key") {
    const state = await api.state(context).catch(() => {
      throw materialRequestAnalysisUnavailable(UNREADABLE_AVAILABILITY_MESSAGE, "unavailable");
    });
    const options = aiRequestApiKeyOptions(state, REQUEST_POLICY.usage);
    if (!options.ok || !options.connection) throw materialRequestAnalysisUnavailable(AI_REQUEST_KEY_MISSING, "unavailable");
    const source = resolveAiRequestSource(state.analysisPreferences?.billingSource ?? null, REQUEST_POLICY, billingSource);
    if (typeof source !== "string") throw materialRequestAnalysisSettingsUnavailable(source.message);
    const requestHeaders = await headers();
    assertLocalChatGptHost(requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
    if (options.connection.id !== connectionId || !preferences) {
      throw materialRequestAnalysisSettingsUnavailable("La clé ou les modèles disponibles ont changé. Rechargez la demande pour reprendre.");
    }
    const choice = resolveAiRequestModel(options, { model: preferences.model, effort: preferences.reasoningEffort });
    if (!choice.ok) {
      throw materialRequestAnalysisModelUnavailable("Ce modèle ou ce niveau d’effort n’est pas disponible pour cette clé API OpenAI.");
    }
    keyCall = { preferences: choice.preferences, expectedVersion: options.connection.version };
  } else {
    const availability = await getStructuredAiAvailability(context, { allowUnselectedModel: preferences !== undefined }).catch(() => ({
      available: false, message: UNREADABLE_AVAILABILITY_MESSAGE,
    }));
    if (!availability.available) throw materialRequestAnalysisUnavailable(availability.message, "unavailable");
    const profile = await api.analysisPreferences(context).catch(() => {
      throw materialRequestAnalysisSettingsUnavailable(AI_REQUEST_PROFILE_UNREADABLE);
    });
    // The original's legacy body can omit the payer. It can never authorize a key charge.
    const source = resolveAiRequestSource(profile.billingSource, REQUEST_POLICY, "chatgpt_plan");
    if (typeof source !== "string") throw materialRequestAnalysisSettingsUnavailable(source.message);
  }

  return async <T>({
    prompt, schema, file, promptVersion, ceiling, signal,
  }: {
    prompt: string;
    schema: z.ZodType<T>;
    file: ApiKeyStructuredFile;
    promptVersion: string;
    ceiling: number;
    signal?: AbortSignal;
  }): Promise<{ data: T; model: string }> => {
    signal?.throwIfAborted();
    if (keyCall) {
      const prepared = await api.prepare(context, {
        ...keyCall.preferences, expectedVersion: keyCall.expectedVersion, prompt, schema,
        files: [file], allotmentNanoUsd: ceiling, outputCap: 32_000, minOutputTokens: 4_096, signal,
      });
      const answer = await api.execute<T>(context, prepared, { timeoutMs: MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS, signal });
      if (answer.costNanoUsd === null) throw new ApiKeyError("AI_KEY_COST_UNKNOWN");
      if (answer.costNanoUsd > ceiling) {
        throw new ApiKeyError("AI_KEY_CEILING_EXCEEDED", { detail: { ceiling: formatUsdCeiling(ceiling), cost: formatUsdCeiling(answer.costNanoUsd) } });
      }
      if (answer.data === null) throw new StructuredAiError("INVALID_ANSWER", "La réponse de l’IA est inexploitable.");
      return { data: answer.data, model: answer.model };
    }

    return callStructuredAi({
      prompt,
      schema,
      files: [{ ...file, ...(file.mimeType === "application/pdf" ? {} : { detail: "high" as const }) }],
      timeoutMs: MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
      context: { tenantId: context.tenantId, promptVersion },
    }, undefined, preferences);
  };
}

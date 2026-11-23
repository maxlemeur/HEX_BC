import "server-only";

import { headers } from "next/headers";
import type { z } from "zod";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { resolveApiAnalysisPreferences, type AiBillingSource } from "@/lib/ai/access/contracts";
import { openAiApiKeyAccess, type ApiKeyStructuredFile } from "@/lib/ai/access/openai-api";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { readLocalChatGptModelOptions } from "@/lib/ai/chatgpt-local-inference";
import { callStructuredAi, getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { conflict } from "@/lib/http/api-response";

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

const MISSING_API_KEY = "Configurez votre clé API OpenAI et son modèle dans Mon profil.";

export async function readPhotoAnalysisModelOptions(owner: Pick<MaterialRequestContext, "userId" | "tenantId">) {
  const access = openAiApiKeyAccess();
  const settings = await access.analysisPreferences(owner);
  const { billingSource } = settings;
  if (billingSource === "chatgpt_plan") {
    const options = await readLocalChatGptModelOptions(owner);
    const override = settings.overrides?.photos?.chatgpt_plan;
    const model = options.models.find((entry) => entry.id === override?.model);
    const preferences = override && model && (override.reasoningEffort === null || model.reasoningEfforts.includes(override.reasoningEffort))
      ? override : options.preferences;
    return { ...options, preferences, billingSource, connectionId: null };
  }
  const state = await access.state(owner);
  if (state.status !== "saved") throw new Error(MISSING_API_KEY);
  const models = state.connection.offeredModels;
  return { models, billingSource, connectionId: state.connection.connectionId,
    preferences: resolveApiAnalysisPreferences(settings, models, "photos") };
}

/** Whether this member can ask for a reading here: no inference, no provider request. */
export async function getMaterialRequestPhotoAnalysisAvailability(
  context: Pick<MaterialRequestContext, "userId" | "tenantId">,
  allowUnselectedModel = true,
  billingSource?: AiBillingSource,
): Promise<MaterialRequestPhotoAnalysisAvailability> {
  if (!isLocalChatGptEnabled()) return MATERIAL_REQUEST_ANALYSIS_DISABLED;
  try {
    const access = openAiApiKeyAccess();
    const source = billingSource ?? (await access.analysisPreferences(context)).billingSource;
    if (source === "personal_api_key") {
      const state = await access.state(context);
      const settings = state.analysisPreferences;
      return state.status === "saved" && settings && resolveApiAnalysisPreferences(settings, state.connection.offeredModels, "photos")
        ? { status: "available", message: "Clé API OpenAI sélectionnée pour les analyses photo." }
        : { status: "unavailable", message: MISSING_API_KEY };
    }
    const availability = await getStructuredAiAvailability(context, { allowUnselectedModel });
    return { status: availability.available ? "available" : "unavailable", message: availability.message };
  } catch {
    return { status: "unavailable", message: UNREADABLE_AVAILABILITY_MESSAGE };
  }
}

export function materialRequestAnalysisUnavailable(message: string, status: MaterialRequestPhotoAnalysisAvailability["status"]) {
  return conflict(message, { status }, MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE);
}

export function materialRequestAnalysisSettingsUnavailable(message: string) {
  return conflict(message, undefined, "MATERIAL_REQUEST_PHOTO_SETTINGS_UNAVAILABLE");
}

/** Resolve billing once before reading an attachment and run it on the same verified connection. */
export async function prepareMaterialRequestDocumentAnalysis(
  context: MaterialRequestContext,
  settings: MaterialRequestPhotoAnalysisInput,
) {
  const { preferences, billingSource, connectionId } = settings;
  const source = billingSource ?? "chatgpt_plan";
  const availability = await getMaterialRequestPhotoAnalysisAvailability(context, preferences !== undefined, source);
  if (availability.status !== "available") throw materialRequestAnalysisUnavailable(availability.message, availability.status);

  const api = openAiApiKeyAccess();
  if (billingSource && (await api.analysisPreferences(context)).billingSource !== billingSource) {
    throw materialRequestAnalysisSettingsUnavailable("La source IA a changé dans Mon profil. Rechargez la demande pour reprendre.");
  }
  const apiState = source === "personal_api_key" ? await api.state(context) : null;
  if (apiState) {
    const requestHeaders = await headers();
    assertLocalChatGptHost(requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
    if (apiState.status !== "saved" || apiState.connection.connectionId !== connectionId || !preferences ||
        !apiState.connection.offeredModels.some((model) => model.id === preferences.model)) {
      throw materialRequestAnalysisSettingsUnavailable("La clé ou les modèles disponibles ont changé. Rechargez la demande pour reprendre.");
    }
  }

  return async <T>({
    prompt, schema, file, promptVersion, ceiling,
  }: {
    prompt: string;
    schema: z.ZodType<T>;
    file: ApiKeyStructuredFile;
    promptVersion: string;
    ceiling: number;
  }): Promise<{ data: T; model: string }> => {
    if (apiState?.status === "saved" && preferences) {
      const prepared = await api.prepare(context, {
        ...preferences, expectedVersion: apiState.connection.version, prompt, schema,
        files: [file], allotmentNanoUsd: ceiling, outputCap: 32_000, minOutputTokens: 4_096,
      });
      const answer = await api.execute<T>(context, prepared, { timeoutMs: MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS });
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
      context: { tenantId: context.tenantId, promptVersion },
    }, undefined, preferences);
  };
}

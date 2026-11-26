import "server-only";

import { headers } from "next/headers";

import { apiKeyErrorMessage, isApiKeyError } from "@/lib/ai/access/api-key-errors";
import {
  DEFAULT_AI_ANALYSIS_PREFERENCES, resolveApiAnalysisPreferences,
  type AiAnalysisUsage, type AiBillingSource, type ApiKeyAccessState, type ApiKeyOfferedModel,
} from "@/lib/ai/access/contracts";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { readLocalChatGptModelOptions } from "@/lib/ai/chatgpt-local-inference";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { supportsReasoningEffort, type ChatGptAvailableModel, type ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import { AI_REQUEST_PROFILE_UNREADABLE } from "@/lib/ai/request-settings";
import { getStructuredAiAvailability } from "@/lib/ai/structured-ai";

type Owner = ChatGptOwner;
type RequestPolicy = {
  /** Omit the usage on screens without a profile override. */
  usage?: AiAnalysisUsage;
  allowedSources: readonly AiBillingSource[];
  sourcePolicy?: "profile";
};
type RequestedSettings = {
  source?: AiBillingSource;
  model?: string;
  effort?: string | null;
  /** Match the key shown before consent. Null means the caller has no valid connection to confirm. */
  expectedConnectionId?: string | null;
};
type Refusal = {
  ok: false;
  reason: "profile_unreadable" | "source_not_allowed" | "source_changed" | "source_unavailable"
    | "connection_changed" | "no_model" | "model_unavailable" | "effort_unavailable";
  message: string;
};
type ModelOptions = { models: readonly ChatGptAvailableModel[]; preferences: ChatGptPreferences };
type SourceOptions = {
  ok: true;
  message: string;
  preferences: ChatGptPreferences;
} & (
  | { models: ChatGptAvailableModel[]; connection: null }
  | { models: ApiKeyOfferedModel[]; connection: { id: string; version: number } }
) | Refusal;
type Profile = { defaultSource: AiBillingSource | null; key: ApiKeyAccessState };
type LocalAccess = "allowed" | "disabled" | "other_host";

export const AI_REQUEST_KEY_MISSING = "Configurez votre clé API OpenAI et son modèle dans Mon profil.";
const SOURCE_CHANGED = "La source IA a changé dans Mon profil. Rechargez la demande pour reprendre.";

const refusal = (reason: Refusal["reason"], message: string): Refusal => ({ ok: false, reason, message });

async function localAccess(): Promise<LocalAccess> {
  if (!isLocalChatGptEnabled()) return "disabled";
  try {
    const requestHeaders = await headers();
    assertLocalChatGptHost(requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
    return "allowed";
  } catch {
    return "other_host";
  }
}

async function readProfile(owner: Owner, access: LocalAccess): Promise<Profile> {
  const initialSource = DEFAULT_AI_ANALYSIS_PREFERENCES.billingSource;
  if (access !== "allowed") {
    return {
      defaultSource: initialSource,
      key: { status: "unavailable", message: apiKeyErrorMessage(access === "disabled" ? "AI_KEY_KEYCHAIN_UNAVAILABLE" : "AI_KEY_LOCAL_ONLY") },
    };
  }
  try {
    const key = await openAiApiKeyAccess().state(owner);
    return { key, defaultSource: "notice" in key && key.notice ? null : key.analysisPreferences?.billingSource ?? initialSource };
  } catch (error) {
    return {
      defaultSource: null,
      key: { status: "unavailable", message: isApiKeyError(error) ? error.message : apiKeyErrorMessage("AI_KEY_UNEXPECTED") },
    };
  }
}

/** The configured payer is a starting choice. Only a profile-locked screen requires it on every call. */
function resolveAiRequestSource(
  defaultSource: AiBillingSource | null, policy: RequestPolicy, requested?: AiBillingSource,
): AiBillingSource | Refusal {
  const source = requested ?? defaultSource;
  if (!source || (policy.sourcePolicy === "profile" && !defaultSource)) {
    return refusal("profile_unreadable", AI_REQUEST_PROFILE_UNREADABLE);
  }
  if (!policy.allowedSources.includes(source)) {
    return refusal("source_not_allowed", "Cette source d’IA n’est pas proposée pour cette demande.");
  }
  if (policy.sourcePolicy === "profile" && source !== defaultSource) return refusal("source_changed", SOURCE_CHANGED);
  return source;
}

export function aiRequestApiKeyOptions(state: ApiKeyAccessState, usage?: AiAnalysisUsage): SourceOptions {
  if (state.status === "unavailable") return refusal("source_unavailable", state.message);
  if (state.status !== "saved" || !state.analysisPreferences) return refusal("source_unavailable", AI_REQUEST_KEY_MISSING);
  const models = state.connection.offeredModels;
  const preferences = resolveApiAnalysisPreferences(state.analysisPreferences, models, usage);
  if (!preferences) return refusal("no_model", AI_REQUEST_KEY_MISSING);
  return {
    ok: true, message: "Clé API OpenAI enregistrée.", models, preferences,
    connection: { id: state.connection.connectionId, version: state.connection.version },
  };
}

async function sourceOptions(
  owner: Owner, access: LocalAccess, source: AiBillingSource, usage: AiAnalysisUsage | undefined, profile?: Profile,
): Promise<SourceOptions> {
  if (source === "personal_api_key") return aiRequestApiKeyOptions((profile ?? await readProfile(owner, access)).key, usage);
  if (access === "disabled") return refusal("source_unavailable", "Le forfait ChatGPT est utilisable dans MergeOne local, sur le Mac connecté.");
  if (access === "other_host") return refusal("source_unavailable", "Le forfait ChatGPT n’est utilisable que depuis MergeOne local, sur ce Mac.");
  const availability = await getStructuredAiAvailability(owner, { allowUnselectedModel: true });
  if (!availability.available) return refusal("source_unavailable", availability.message);
  try {
    const { models, preferences } = await readLocalChatGptModelOptions(owner);
    const override = usage && profile?.key.analysisPreferences?.overrides?.[usage]?.chatgpt_plan;
    const model = override && models.find((entry) => entry.id === override.model);
    const selected = model && override && supportsReasoningEffort(model, override.reasoningEffort) ? override : preferences;
    if (!selected) return refusal("no_model", "Votre forfait ChatGPT ne propose aucun modèle ici.");
    return { ok: true, models, preferences: selected, message: availability.message, connection: null };
  } catch {
    return refusal("source_unavailable", "Les modèles de votre forfait ChatGPT sont indisponibles. Vérifiez la connexion dans Mon profil.");
  }
}

/** Read the options for a screen using the same defaults and availability rules as dispatch. */
export async function readAiRequestOptions(owner: Owner, policy: RequestPolicy) {
  const access = await localAccess();
  const profile = await readProfile(owner, access);
  const options: Partial<Record<AiBillingSource, SourceOptions>> = {};
  await Promise.all(policy.allowedSources.map(async (source) => {
    const choice = resolveAiRequestSource(profile.defaultSource, policy, source);
    options[source] = typeof choice === "string" ? await sourceOptions(owner, access, choice, policy.usage, profile) : choice;
  }));
  return { defaultSource: profile.defaultSource, options };
}

/** Validate an explicit choice against the current options for this payer. */
function resolveAiRequestModel(options: ModelOptions, requested: Pick<RequestedSettings, "model" | "effort">) {
  const id = requested.model ?? options.preferences.model;
  const model = options.models.find((entry) => entry.id === id);
  if (!model) return refusal("model_unavailable", "Ce modèle n’est pas proposé par la source d’IA choisie.");
  const effort = requested.effort;
  if (effort === undefined) {
    const preferences = id === options.preferences.model ? options.preferences : { model: id, reasoningEffort: model.defaultReasoningEffort };
    return { ok: true as const, preferences };
  }
  const reasoningEffort = effort === null ? null : model.reasoningEfforts.find((entry) => entry === effort);
  if (reasoningEffort === undefined) return refusal("effort_unavailable", "Ce niveau de raisonnement n’est pas proposé pour le modèle choisi.");
  return { ok: true as const, preferences: { model: id, reasoningEffort } };
}

/** Resolve one authenticated member's request without opening a key, running inference or switching payers. */
export async function resolveAiRequest(owner: Owner, policy: RequestPolicy, requested: RequestedSettings = {}) {
  const access = await localAccess();
  // A manual plan selection with no usage override can be resolved independently of key metadata.
  const profile = requested.source === "chatgpt_plan" && !policy.usage && !policy.sourcePolicy
    ? undefined : await readProfile(owner, access);
  const source = resolveAiRequestSource(profile?.defaultSource ?? null, policy, requested.source);
  if (typeof source !== "string") return source;
  const options = await sourceOptions(owner, access, source, policy.usage, profile);
  if (!options.ok) return options;
  if (requested.expectedConnectionId !== undefined && options.connection?.id !== requested.expectedConnectionId) {
    return refusal("connection_changed", "La clé ou les modèles disponibles ont changé. Rechargez la demande pour reprendre.");
  }
  const selection = resolveAiRequestModel(options, requested);
  return selection.ok ? { ...selection, source, connection: options.connection } : selection;
}

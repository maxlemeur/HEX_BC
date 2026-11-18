import { z } from "zod";

import { CHATGPT_REASONING_EFFORTS, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";

// « Accès IA » (lot 1): three separate questions, never one field.
// - Who pays: the billing source. The ChatGPT subscription, or a member's own API key.
// - Who answers: the provider of the API key. OpenAI in this lot; Anthropic joins the same list later.
// - Where it runs: the execution place. The local Mac in this lot; a hosted worker later.
// The subscription stays the default: a saved key is used only where a person picks it (the takeoff lab here).

export const AI_BILLING_SOURCES = ["chatgpt_plan", "personal_api_key"] as const;
export type AiBillingSource = (typeof AI_BILLING_SOURCES)[number];

export const AI_API_PROVIDERS = ["openai"] as const;
export type AiApiProvider = (typeof AI_API_PROVIDERS)[number];
export const aiApiProviderSchema = z.enum(AI_API_PROVIDERS);

export const AI_EXECUTION_PLACES = ["local"] as const;
export type AiExecutionPlace = (typeof AI_EXECUTION_PLACES)[number];

/** The efforts a request may carry; each model accepts a subset (openai-pricing.ts). */
export const AI_REASONING_EFFORTS = CHATGPT_REASONING_EFFORTS;
export type AiReasoningEffort = ChatGptReasoningEffort;

export const AI_API_PROVIDER_LABELS: Record<AiApiProvider, string> = { openai: "OpenAI" };

/** How the saved key was checked: its model list, or (when the key may not list models) one billable model test. */
export type ApiKeyVerification = "models_listed" | "model_tested";

/**
 * What a screen may know about a saved key: never the key. The suffix is its
 * last four characters, as the provider itself shows them.
 */
export type ApiKeyConnectionView = {
  provider: AiApiProvider;
  place: AiExecutionPlace;
  /** « Sur ce Mac », or the name of the test store a journey injects. */
  placeLabel: string;
  suffix: string;
  verification: ApiKeyVerification;
  /** Opaque and unique across owners and replacements: a page sends it back with a launch. */
  connectionId: string;
  version: number;
  savedAt: string;
  lastTest: { at: string; model: string } | null;
  lastUsedAt: string | null;
  /** Qualified models the key listed when saved (all qualified, unverified, when it may not list): no Keychain read, no call. */
  offeredModels: ApiKeyOfferedModel[];
};

export type ApiKeyAccessState =
  | { status: "unavailable"; reason: "not_local" | "no_keychain"; message: string }
  | { status: "empty"; placeLabel: string }
  | { status: "saved"; connection: ApiKeyConnectionView };

/** A model this code qualified, priced, and offered by the key's model list (or not checked: `verified` false). */
export type ApiKeyOfferedModel = {
  id: string;
  name: string;
  reasoningEfforts: AiReasoningEffort[];
  defaultReasoningEffort: AiReasoningEffort | null;
  verified: boolean;
};

/** The answer to « Vérifier et enregistrer »: saved, or a key that may not list models and needs one explicit model test. */
export type ApiKeySaveResult =
  | { outcome: "saved"; state: ApiKeyAccessState; models: ApiKeyOfferedModel[]; testCostNanoUsd: number | null }
  | { outcome: "needs_model_test"; models: ApiKeyOfferedModel[] };

export type ApiKeyTestResult = { model: string; at: string; costNanoUsd: number | null; state: ApiKeyAccessState };

export const ApiKeySaveRequestSchema = z.object({
  provider: aiApiProviderSchema,
  // Checked by ApiKeySecret.parseOpenAi, which reports its own fixed message.
  key: z.string().max(1000),
  testModel: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();

export const ApiKeyTestRequestSchema = z.object({
  provider: aiApiProviderSchema,
  model: z.string().trim().min(1).max(200),
}).strict();

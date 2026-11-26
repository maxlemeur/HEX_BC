import type { AiBillingSource } from "@/lib/ai/access/contracts";
import type { ChatGptAvailableModel, ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";

export type AiRequestSource = AiBillingSource | "decisions";
export type AiRequestSettingsValue = { source: AiRequestSource | null; preferences: ChatGptPreferences | null };
export type AiRequestSourceOption = {
  available: boolean;
  message: string;
  models?: readonly ChatGptAvailableModel[];
  preferences?: ChatGptPreferences | null;
};
export type AiRequestSourceOptions = Partial<Record<AiRequestSource, AiRequestSourceOption>>;

export const AI_REQUEST_SOURCE_LABELS: Record<AiRequestSource, string> = {
  chatgpt_plan: "Forfait ChatGPT",
  personal_api_key: "Clé API OpenAI",
  decisions: "API Decisions",
};

export const AI_REQUEST_PROFILE_UNREADABLE = "Les préférences de Mon profil n’ont pas pu être lues.";

export function defaultAiRequestSettings(defaultSource: AiBillingSource | null, sources: AiRequestSourceOptions): AiRequestSettingsValue {
  const option = defaultSource ? sources[defaultSource] : undefined;
  return option?.available
    ? { source: defaultSource, preferences: option.preferences ?? null }
    : { source: null, preferences: null };
}

export function aiRequestKeyCeilingMessage(ceiling: string): string {
  return `Clé API OpenAI enregistrée : appels facturés à votre compte OpenAI, ${ceiling} au plus par demande.`;
}

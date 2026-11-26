import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import type { AiRequestSourceOptions } from "@/lib/ai/request-settings";

export const ASSISTANT_AI_SOURCES = ["chatgpt_plan", "personal_api_key"] as const;
export const ASSISTANT_KEY_CEILING = AI_REQUEST_CEILINGS_NANO_USD.assistantMessage;
export const ASSISTANT_CEILING_MESSAGE =
  `Réponse arrêtée au plafond de ${formatUsdCeiling(ASSISTANT_KEY_CEILING)} par message. Vous pouvez réessayer avec une question plus ciblée ou un modèle moins coûteux.`;

export type AssistantAiOptions = {
  defaultSource: (typeof ASSISTANT_AI_SOURCES)[number] | null;
  sources: AiRequestSourceOptions;
  keyConnectionId: string | null;
};

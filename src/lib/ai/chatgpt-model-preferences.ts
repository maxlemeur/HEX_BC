import { z } from "zod";

export const RETIRED_OPENAI_MODEL = "gpt-6.1-sol";

export const DEFAULT_CHATGPT_MODEL = "gpt-6.2-sol";
export const DEFAULT_CHATGPT_MODEL_NAME = "GPT-6.2 Sol";
export const DEFAULT_CHATGPT_REASONING_EFFORT = "high";
export const CHATGPT_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export const chatGptReasoningEffortSchema = z.enum(CHATGPT_REASONING_EFFORTS);
export type ChatGptReasoningEffort = z.infer<typeof chatGptReasoningEffortSchema>;
/** Reasoning efforts as the screens name them; the API values stay internal. */
export const CHATGPT_REASONING_EFFORT_LABELS: Record<ChatGptReasoningEffort, string> = {
  none: "Sans raisonnement", low: "Faible", medium: "Moyen", high: "Élevé", xhigh: "Très élevé", max: "Maximum",
};
export const chatGptPreferencesSchema = z.object({
  model: z.string().trim().min(1).max(200),
  reasoningEffort: chatGptReasoningEffortSchema.nullable(),
}).strict();
export type ChatGptPreferences = z.infer<typeof chatGptPreferencesSchema>;
export type ChatGptAvailableModel = {
  id: string;
  name: string;
  reasoningEfforts: ChatGptReasoningEffort[];
  defaultReasoningEffort: ChatGptReasoningEffort | null;
};

export function supportsReasoningEffort(model: ChatGptAvailableModel, effort: ChatGptReasoningEffort | null): boolean {
  return effort === null || model.reasoningEfforts.includes(effort);
}

export function chatGptDefaultPreferences(models: readonly ChatGptAvailableModel[]): ChatGptPreferences | null {
  const model = models.find((entry) => entry.id === DEFAULT_CHATGPT_MODEL) ?? models.find((entry) => entry.id === "gpt-6.1-terra");
  if (!model) return null;
  return {
    model: model.id,
    reasoningEffort: model.reasoningEfforts.includes(DEFAULT_CHATGPT_REASONING_EFFORT) ? DEFAULT_CHATGPT_REASONING_EFFORT : null,
  };
}

// https://developers.openai.com/api/docs/models lists the supported efforts.
// Unknown models need account metadata.
const documentedEfforts: Record<string, readonly ChatGptReasoningEffort[]> = {
  "gpt-6.1-terra": CHATGPT_REASONING_EFFORTS,
  "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6.2-astra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6.2-sol": ["low", "medium", "high", "xhigh", "max"],
};

export function chatGptModelReasoningCapabilities(model: {
  slug: string;
  supported_reasoning_levels?: unknown;
  default_reasoning_level?: unknown;
}): Pick<ChatGptAvailableModel, "reasoningEfforts" | "defaultReasoningEffort"> {
  const documented = documentedEfforts[model.slug];
  const advertised = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels.flatMap((level: unknown) => {
      const value = typeof level === "object" && level !== null && "effort" in level ? level.effort : level;
      const parsed = chatGptReasoningEffortSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }) : null;
  const reasoningEfforts = [...new Set(advertised ?? documented ?? [])]
    .filter((effort) => !documented || documented.includes(effort));
  const parsedDefault = chatGptReasoningEffortSchema.safeParse(model.default_reasoning_level);
  const defaultReasoningEffort = parsedDefault.success && reasoningEfforts.includes(parsedDefault.data)
    ? parsedDefault.data : documented && reasoningEfforts.includes("medium") ? "medium" : null;
  return { reasoningEfforts, defaultReasoningEffort };
}

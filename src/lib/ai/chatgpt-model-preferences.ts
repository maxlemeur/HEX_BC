import { z } from "zod";

export const DEFAULT_CHATGPT_MODEL = "gpt-6.1-terra";
export const CHATGPT_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export const chatGptReasoningEffortSchema = z.enum(CHATGPT_REASONING_EFFORTS);
export type ChatGptReasoningEffort = z.infer<typeof chatGptReasoningEffortSchema>;
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

// Official model pages verified 2026-10-29. Unknown models need account metadata.
const documentedEfforts: Record<string, readonly ChatGptReasoningEffort[]> = {
  "gpt-6.1-terra": CHATGPT_REASONING_EFFORTS,
  "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
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

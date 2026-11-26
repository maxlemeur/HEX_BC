import { z } from "zod";
import type { AiBillingSource } from "@/lib/ai/access/contracts";
import { chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";
import type { AiRequestSourceOptions } from "@/lib/ai/request-settings";

const modelAndEffort = {
  model: z.string().trim().min(1).max(200),
  effort: chatGptReasoningEffortSchema.nullable(),
};

export const intakeAiChoiceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("rules_only") }).strict(),
  z.object({ source: z.literal("chatgpt_plan"), ...modelAndEffort }).strict(),
  z.object({ source: z.literal("personal_api_key"), ...modelAndEffort, expectedConnectionId: z.string().min(1).max(200) }).strict(),
]);

export type IntakeAiChoice = z.infer<typeof intakeAiChoiceSchema>;
export type IntakeAiOptions = {
  defaultSource: AiBillingSource | null;
  sources: AiRequestSourceOptions;
  keyConnectionId: string | null;
  decisionsSelected: boolean;
};
export type IntakePersonalAiReceipt = { source: AiBillingSource; model: string; reasoningEffort: z.infer<typeof chatGptReasoningEffortSchema> | null };
export type IntakeAiReceipt = IntakePersonalAiReceipt | { source: "decisions"; model: string; reasoningEffort: null };
export const INTAKE_AI_COST_ABOVE_HOLD = "Analyse interrompue : le coût déclaré par OpenAI dépasse la réservation. Les résultats déjà enregistrés sont conservés.";
export const INTAKE_AI_BUDGET_STOP = "Analyse interrompue : la prochaine demande dépasserait le plafond de 2,00 $ US pour ce lot. Les résultats déjà enregistrés sont conservés.";

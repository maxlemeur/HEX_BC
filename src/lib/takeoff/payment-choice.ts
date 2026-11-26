import { z } from "zod";

export const takeoffPaymentChoiceSchema = z.object({
  source: z.enum(["chatgpt_plan", "personal_api_key"]).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  effort: z.string().trim().min(1).max(32).nullish(),
  expectedConnectionId: z.string().min(1).max(200),
}).strict();

export type TakeoffPaymentChoice = z.input<typeof takeoffPaymentChoiceSchema>;

export const TAKEOFF_NANO_USD_PER_CENT = 10_000_000;

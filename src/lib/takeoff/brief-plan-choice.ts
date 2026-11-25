import { z } from "zod";

const digest = z.string().regex(/^[0-9a-f]{64}$/);

export const briefPlanSelectionSchema = z.array(z.object({
  id: z.string().uuid().transform((id) => id.toLowerCase()),
  version: digest,
}).strict()).max(20, "Choisissez au maximum 20 plans.").refine(
  (plans) => new Set(plans.map(({ id }) => id)).size === plans.length, "Un plan ne peut être choisi qu’une fois.",
);
export type BriefPlanSelection = z.infer<typeof briefPlanSelectionSchema>;

export const briefPlanReadingState = z.enum(["analysed", "in_progress", "unverified", "not_analysed"]);
export type BriefPlanOption = BriefPlanSelection[number] & { name: string; state: z.infer<typeof briefPlanReadingState> };

export const sealedBriefPlansSchema = z.record(z.string().uuid(), z.object({ version: digest, sha256: digest }));
export type SealedBriefPlans = z.infer<typeof sealedBriefPlansSchema>;
export const BRIEF_PLAN_CHANGED = "Un plan choisi a changé ou a été retiré. Rouvrez la liste des plans avant de confirmer.";

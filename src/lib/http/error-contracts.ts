import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const apiFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema,
});

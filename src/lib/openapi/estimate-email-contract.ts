import { z } from "zod";

export const estimateStatusSchema = z.enum([
  "draft",
  "sending",
  "sent",
  "accepted",
  "archived",
]);

export const estimateEmailIdempotencyKeyHeaderParameter = {
  name: "Idempotency-Key",
  in: "header" as const,
  description:
    "UUID obligatoire identifiant une tentative logique d'envoi. Reutiliser la meme valeur apres une erreur reseau.",
  schemaName: "EstimateEmailIdempotencyKeyHeaderParameter",
  schema: z.string().uuid("Idempotency-Key invalide."),
  required: true,
};

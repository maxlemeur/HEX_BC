import { z } from "zod";

import { Constants } from "@/types/database.generated";

export const estimateStatusSchema = z.enum(Constants.public.Enums.estimate_status);

export const estimateEmailIdempotencyKeyHeaderParameter = {
  name: "Idempotency-Key",
  in: "header" as const,
  description:
    "UUID obligatoire identifiant une tentative logique d'envoi. Reutiliser la meme valeur apres une erreur reseau.",
  schemaName: "EstimateEmailIdempotencyKeyHeaderParameter",
  schema: z.string().uuid("Idempotency-Key invalide."),
  required: true,
};

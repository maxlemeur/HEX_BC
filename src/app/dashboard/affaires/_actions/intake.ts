"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  affaireIntakeDocumentKindSchema,
} from "@/lib/affaires/intake";
import {
  reclassifyAffaireDocument as reclassifyAffaireDocumentServer,
} from "@/lib/affaires/intake-server";

const reclassifyAffaireDocumentInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  documentId: z.string().uuid("documentId invalide."),
  category: affaireIntakeDocumentKindSchema,
});

export type ReclassifyAffaireDocumentInput = z.infer<
  typeof reclassifyAffaireDocumentInputSchema
>;

export async function reclassifyAffaireDocument(
  input: ReclassifyAffaireDocumentInput
) {
  const parsed = reclassifyAffaireDocumentInputSchema.parse(input);
  const result = await reclassifyAffaireDocumentServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

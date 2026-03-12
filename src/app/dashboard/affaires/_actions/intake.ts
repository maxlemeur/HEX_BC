"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  affaireIntakeDocumentKindSchema,
  normalizeAffaireIntakeTextList,
} from "@/lib/affaires/intake";
import {
  confirmAffaireBrief as confirmAffaireBriefServer,
  reclassifyAffaireDocument as reclassifyAffaireDocumentServer,
  setAffaireDocumentAsPrimary as setAffaireDocumentAsPrimaryServer,
  updateAffaireBrief as updateAffaireBriefServer,
} from "@/lib/affaires/intake-server";

const reclassifyAffaireDocumentInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  documentId: z.string().uuid("documentId invalide."),
  category: affaireIntakeDocumentKindSchema,
});
const setAffaireDocumentAsPrimaryInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  documentId: z.string().uuid("documentId invalide."),
});

export type ReclassifyAffaireDocumentInput = z.infer<
  typeof reclassifyAffaireDocumentInputSchema
>;
export type SetAffaireDocumentAsPrimaryInput = z.infer<
  typeof setAffaireDocumentAsPrimaryInputSchema
>;

const updateAffaireBriefInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  summary: z.string().trim().min(1, "Le resume est requis.").max(900),
  scope: z.array(z.string()).max(12),
  vigilancePoints: z.array(z.string()).max(12),
  assumptions: z.array(z.string()).max(12),
});

export type UpdateAffaireBriefInput = z.infer<
  typeof updateAffaireBriefInputSchema
>;

const confirmAffaireBriefInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
});

export type ConfirmAffaireBriefInput = z.infer<
  typeof confirmAffaireBriefInputSchema
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

export async function setAffaireDocumentAsPrimary(
  input: SetAffaireDocumentAsPrimaryInput
) {
  const parsed = setAffaireDocumentAsPrimaryInputSchema.parse(input);
  const result = await setAffaireDocumentAsPrimaryServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

export async function updateAffaireBrief(input: UpdateAffaireBriefInput) {
  const parsed = updateAffaireBriefInputSchema.parse({
    ...input,
    scope: normalizeAffaireIntakeTextList(input.scope, {
      maxItems: 12,
      maxLength: 280,
    }),
    vigilancePoints: normalizeAffaireIntakeTextList(input.vigilancePoints, {
      maxItems: 12,
      maxLength: 280,
    }),
    assumptions: normalizeAffaireIntakeTextList(input.assumptions, {
      maxItems: 12,
      maxLength: 280,
    }),
  });
  const result = await updateAffaireBriefServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

export async function confirmAffaireBrief(input: ConfirmAffaireBriefInput) {
  const parsed = confirmAffaireBriefInputSchema.parse(input);
  const result = await confirmAffaireBriefServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

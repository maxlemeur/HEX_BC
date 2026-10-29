"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteIntakeDocumentCopy } from "@/lib/affaires/intake-document-store";
import { refreshAffaireIntakeFromActiveDocuments, requireAffaireProjectOwnerOrAdmin, syncAffaireIntakeDocumentPriorities } from "@/lib/affaires/intake-server";

import {
  affaireIntakeDocumentKindSchema,
  normalizeAffaireIntakeTextList,
} from "@/lib/affaires/intake";
import {
  confirmAffaireBrief as confirmAffaireBriefServer,
  reclassifyAffaireDocument as reclassifyAffaireDocumentServer,
  setAffaireDocumentAsPrimary as setAffaireDocumentAsPrimaryServer,
  updateAffaireBrief as updateAffaireBriefServer,
  resolveAffaireBriefPlanGap as resolveAffaireBriefPlanGapServer,
  retryAffaireDocumentAnalysis as retryAffaireDocumentAnalysisServer,
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
  summary: z.string().trim().min(1, "Le résumé est requis.").max(900),
  scope: z.array(z.string()).max(12),
  vigilancePoints: z.array(z.string()).max(12),
  assumptions: z.array(z.string()).max(12),
});

export type UpdateAffaireBriefInput = z.infer<
  typeof updateAffaireBriefInputSchema
>;

const confirmAffaireBriefInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
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

export async function retryAffaireDocumentAnalysis(input: { projectId: string; documentId: string }) {
  const parsed = setAffaireDocumentAsPrimaryInputSchema.parse(input);
  const result = await retryAffaireDocumentAnalysisServer(parsed);
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

export async function deleteAffaireIntakeDocument(input: { projectId: string; documentId: string }) {
  const parsed = setAffaireDocumentAsPrimaryInputSchema.parse(input);
  const access = await requireAffaireProjectOwnerOrAdmin(parsed.projectId);
  const syncPriorities = () => syncAffaireIntakeDocumentPriorities({ supabase: access.context.supabase, projectId: parsed.projectId });
  let result: Awaited<ReturnType<typeof deleteIntakeDocumentCopy>>;
  try {
    // Runs before the tombstone, so a retry completes an interrupted refresh and a replay on an
    // existing tombstone changes nothing, keeping later brief edits and confirmation.
    result = await deleteIntakeDocumentCopy(access, parsed.documentId, async ({ uploadId, wasUploaded }) => {
      await syncPriorities();
      // Only an uploaded piece fed the register, the synced plans and the brief. A deletion
      // retires copies without waiting on Drive for the working copies of other linked plans.
      if (wasUploaded) {
        await refreshAffaireIntakeFromActiveDocuments({ supabase: access.context.supabase, project: access.project,
          uploadId, actorUserId: access.context.userId, readDrive: false });
      }
    });
  } catch (error) {
    // The reservation demoted the piece: a released one must not leave its kind without a principal.
    try {
      await syncPriorities();
    } catch (cause) {
      console.error("Intake priority resync after an interrupted deletion failed", { projectId: parsed.projectId, cause });
    }
    throw error;
  }
  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`, "layout");
  return result;
}

export async function resolveAffaireBriefPlanGap(input: { projectId: string; entryIndex: number; expectedUpdatedAt: string }) {
  const parsed = z.object({
    projectId: z.string().uuid(), entryIndex: z.number().int().min(0).max(11),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }).strict().parse(input);
  const result = await resolveAffaireBriefPlanGapServer(parsed);
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

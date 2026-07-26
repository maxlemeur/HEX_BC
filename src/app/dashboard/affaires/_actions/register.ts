"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  affaireRegisterEntryKindSchema,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterRevalidationCauseSchema,
  affaireRegisterRevalidationImpactedStageSchema,
  affaireRegisterScopeTypeSchema,
  normalizeAffaireRegisterText,
} from "@/lib/affaires/register";
import {
  continueAffaireRegisterWithHypothesis,
  createAffaireRegisterEntry,
  fetchAffaireRegisterReviewExport,
  updateAffaireRegisterEntryFollowUp,
  requestAffaireRegisterRevalidation,
  updateAffaireRegisterEntryStatus,
} from "@/lib/affaires/register-server";

const createAffaireRegisterEntryActionInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide.").nullable().optional(),
  kind: affaireRegisterEntryKindSchema,
  text: z.string().trim().min(1, "Le texte est requis.").max(320),
  severity: affaireRegisterEntrySeveritySchema,
  scopeType: affaireRegisterScopeTypeSchema,
  scopeId: z.string().uuid("scopeId invalide.").nullable().optional(),
  scopeRef: z.string().trim().max(120).nullable().optional(),
  scopeLabel: z.string().trim().max(180).nullable().optional(),
  sourceDocumentId: z.string().uuid("sourceDocumentId invalide.").nullable().optional(),
  sourceFileName: z.string().trim().max(255).nullable().optional(),
});

const updateAffaireRegisterEntryStatusActionInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide.").nullable().optional(),
  entryId: z.string().uuid("entryId invalide."),
  status: affaireRegisterEntryStatusSchema,
  comment: z.string().trim().max(320).nullable().optional(),
});

const updateAffaireRegisterEntryFollowUpActionInputSchema = z
  .object({
    projectId: z.string().uuid("projectId invalide."),
    versionId: z.string().uuid("versionId invalide.").nullable().optional(),
    entryId: z.string().uuid("entryId invalide."),
    severity: affaireRegisterEntrySeveritySchema.nullable().optional(),
    ownerUserId: z.string().uuid("ownerUserId invalide.").nullable().optional(),
    dueDate: z.string().date("dueDate invalide.").nullable().optional(),
    comment: z.string().trim().max(320).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.severity === undefined &&
      value.ownerUserId === undefined &&
      value.dueDate === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Au moins une mise à jour de sévérité, responsable ou échéance est requise.",
      });
    }
  });

const requestAffaireRegisterRevalidationActionInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide.").nullable().optional(),
  entryId: z.string().uuid("entryId invalide."),
  cause: affaireRegisterRevalidationCauseSchema,
  impactedStages: z
    .array(affaireRegisterRevalidationImpactedStageSchema)
    .min(1)
    .max(5),
  triggerDocumentId: z.string().uuid("triggerDocumentId invalide.").nullable().optional(),
  triggerFileName: z.string().trim().max(255).nullable().optional(),
  comment: z.string().trim().max(320).nullable().optional(),
});

const continueAffaireRegisterWithHypothesisActionInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide.").nullable().optional(),
  entryId: z.string().uuid("entryId invalide."),
  comment: z.string().trim().max(320).nullable().optional(),
});

const fetchAffaireRegisterReviewExportActionInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide.").nullable().optional(),
});

export type CreateAffaireRegisterEntryActionInput = z.infer<
  typeof createAffaireRegisterEntryActionInputSchema
>;

export type UpdateAffaireRegisterEntryStatusActionInput = z.infer<
  typeof updateAffaireRegisterEntryStatusActionInputSchema
>;

export type UpdateAffaireRegisterEntryFollowUpActionInput = z.infer<
  typeof updateAffaireRegisterEntryFollowUpActionInputSchema
>;

export type RequestAffaireRegisterRevalidationActionInput = z.infer<
  typeof requestAffaireRegisterRevalidationActionInputSchema
>;

export type ContinueAffaireRegisterWithHypothesisActionInput = z.infer<
  typeof continueAffaireRegisterWithHypothesisActionInputSchema
>;

export type FetchAffaireRegisterReviewExportActionInput = z.infer<
  typeof fetchAffaireRegisterReviewExportActionInputSchema
>;

function revalidateAffaireRegisterPaths(projectId: string, versionId?: string | null) {
  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${projectId}`);

  if (versionId) {
    revalidatePath(`/dashboard/estimates/${versionId}`);
  }
}

export async function createAffaireRegisterEntryAction(
  input: CreateAffaireRegisterEntryActionInput
) {
  const parsed = createAffaireRegisterEntryActionInputSchema.parse({
    ...input,
    text: normalizeAffaireRegisterText(input.text),
    scopeRef: input.scopeRef ? normalizeAffaireRegisterText(input.scopeRef, 120) : null,
    scopeLabel: input.scopeLabel ? normalizeAffaireRegisterText(input.scopeLabel, 180) : null,
    sourceFileName: input.sourceFileName
      ? normalizeAffaireRegisterText(input.sourceFileName, 255)
      : null,
  });
  const result = await createAffaireRegisterEntry(parsed);

  revalidateAffaireRegisterPaths(parsed.projectId, parsed.versionId ?? result.entry.versionId);

  return result;
}

export async function updateAffaireRegisterEntryStatusAction(
  input: UpdateAffaireRegisterEntryStatusActionInput
) {
  const parsed = updateAffaireRegisterEntryStatusActionInputSchema.parse({
    ...input,
    comment: input.comment ? normalizeAffaireRegisterText(input.comment, 320) : null,
  });
  const result = await updateAffaireRegisterEntryStatus({
    projectId: parsed.projectId,
    entryId: parsed.entryId,
    status: parsed.status,
    comment: parsed.comment ?? null,
  });

  revalidateAffaireRegisterPaths(parsed.projectId, parsed.versionId ?? result.entry.versionId);

  return result;
}

export async function updateAffaireRegisterEntryFollowUpAction(
  input: UpdateAffaireRegisterEntryFollowUpActionInput
) {
  const parsed = updateAffaireRegisterEntryFollowUpActionInputSchema.parse({
    ...input,
    comment: input.comment ? normalizeAffaireRegisterText(input.comment, 320) : null,
  });
  const result = await updateAffaireRegisterEntryFollowUp({
    projectId: parsed.projectId,
    entryId: parsed.entryId,
    severity:
      parsed.severity === undefined ? undefined : parsed.severity ?? null,
    ownerUserId:
      parsed.ownerUserId === undefined ? undefined : parsed.ownerUserId ?? null,
    dueDate: parsed.dueDate === undefined ? undefined : parsed.dueDate ?? null,
    comment: parsed.comment ?? null,
  });

  revalidateAffaireRegisterPaths(parsed.projectId, parsed.versionId ?? result.entry.versionId);

  return result;
}

export async function requestAffaireRegisterRevalidationAction(
  input: RequestAffaireRegisterRevalidationActionInput
) {
  const parsed = requestAffaireRegisterRevalidationActionInputSchema.parse({
    ...input,
    triggerFileName: input.triggerFileName
      ? normalizeAffaireRegisterText(input.triggerFileName, 255)
      : null,
    comment: input.comment ? normalizeAffaireRegisterText(input.comment, 320) : null,
  });
  const result = await requestAffaireRegisterRevalidation({
    projectId: parsed.projectId,
    entryId: parsed.entryId,
    cause: parsed.cause,
    impactedStages: parsed.impactedStages,
    triggerDocumentId: parsed.triggerDocumentId ?? null,
    triggerFileName: parsed.triggerFileName ?? null,
    comment: parsed.comment ?? null,
  });

  revalidateAffaireRegisterPaths(parsed.projectId, parsed.versionId ?? result.entry.versionId);

  return result;
}

export async function continueAffaireRegisterWithHypothesisAction(
  input: ContinueAffaireRegisterWithHypothesisActionInput
) {
  const parsed = continueAffaireRegisterWithHypothesisActionInputSchema.parse({
    ...input,
    comment: input.comment ? normalizeAffaireRegisterText(input.comment, 320) : null,
  });
  const result = await continueAffaireRegisterWithHypothesis({
    projectId: parsed.projectId,
    entryId: parsed.entryId,
    comment: parsed.comment ?? null,
  });

  revalidateAffaireRegisterPaths(parsed.projectId, parsed.versionId ?? result.entry.versionId);

  return result;
}

export async function fetchAffaireRegisterReviewExportAction(
  input: FetchAffaireRegisterReviewExportActionInput
) {
  const parsed = fetchAffaireRegisterReviewExportActionInputSchema.parse(input);

  return fetchAffaireRegisterReviewExport({
    projectId: parsed.projectId,
    versionId: parsed.versionId ?? null,
  });
}

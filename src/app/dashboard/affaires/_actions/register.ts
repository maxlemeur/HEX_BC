"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  affaireRegisterEntryKindSchema,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
  normalizeAffaireRegisterText,
} from "@/lib/affaires/register";
import {
  createAffaireRegisterEntry,
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
});

export type CreateAffaireRegisterEntryActionInput = z.infer<
  typeof createAffaireRegisterEntryActionInputSchema
>;

export type UpdateAffaireRegisterEntryStatusActionInput = z.infer<
  typeof updateAffaireRegisterEntryStatusActionInputSchema
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
  const parsed = updateAffaireRegisterEntryStatusActionInputSchema.parse(input);
  const result = await updateAffaireRegisterEntryStatus({
    projectId: parsed.projectId,
    entryId: parsed.entryId,
    status: parsed.status,
  });

  revalidateAffaireRegisterPaths(parsed.projectId, parsed.versionId ?? result.entry.versionId);

  return result;
}

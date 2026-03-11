import {
  createEstimate,
  importLinkedDpgfSource,
  instantiateEstimateFromTemplate,
} from "@/lib/estimates/client";
import {
  DEFAULT_VALIDITE_JOURS,
  buildDpgfImportCreatePayload,
  buildProjectNotes,
  todayISO,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

export type SubmitEstimateCreationResult = {
  versionId: string;
  linkedDpgfImportWarning?: string;
};

type SubmitEstimateCreationArgs = {
  data: WizardData;
  projectId?: string;
};

export async function submitEstimateCreation({
  data,
  projectId,
}: SubmitEstimateCreationArgs): Promise<SubmitEstimateCreationResult> {
  if (data.creationMode === "template" && data.selectedTemplateId) {
    const templateResult = await instantiateEstimateFromTemplate(
      data.selectedTemplateId,
      {
        ...(projectId
          ? { projectId }
          : { projectName: data.projectName.trim() }),
        versionTitle: data.title.trim() || null,
        dateDevis: data.dateDevis,
        validiteJours: Number(data.validiteJours),
        projectNotes: buildProjectNotes(data.projectFamily),
      }
    );

    if (data.dpgfImportMode !== "source") {
      return { versionId: templateResult.versionId };
    }

    try {
      await importLinkedDpgfSource(templateResult.versionId);
      return { versionId: templateResult.versionId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      return {
        versionId: templateResult.versionId,
        linkedDpgfImportWarning: detail
          ? `Le chiffrage a ete cree, mais le DPGF source n'a pas pu etre importe: ${detail}`
          : "Le chiffrage a ete cree, mais le DPGF source n'a pas pu etre importe.",
      };
    }
  }

  const marginBpNum = data.marginBp ? Number(data.marginBp) : 0;
  const dpgfImportPayload = buildDpgfImportCreatePayload(data.dpgfImportMode);
  const versionId = await createEstimate({
    ...(projectId
      ? { projectId }
      : { projectName: data.projectName.trim() }),
    title: data.title.trim() || null,
    dateDevis: data.dateDevis,
    validiteJours: Number(data.validiteJours),
    ...(!projectId && {
      clientName: data.clientName.trim() || null,
      reference: data.reference.trim() || null,
    }),
    marginMode: data.marginMode,
    marginBp: marginBpNum > 0 ? marginBpNum : undefined,
    marginMultiplier: marginBpNum > 0 ? 1 + marginBpNum / 10000 : undefined,
    taxRateBp: Number(data.taxRateBp),
    roundingMode: data.roundingMode,
    roundingStepCents:
      data.roundingMode !== "none"
        ? Number(data.roundingStepCents)
        : undefined,
    currency: data.currency || undefined,
    projectNotes: buildProjectNotes(data.projectFamily),
    ...dpgfImportPayload,
  });

  return { versionId };
}

export async function quickCreateEstimateCreation({
  data,
  projectId,
}: SubmitEstimateCreationArgs): Promise<string> {
  return createEstimate({
    ...(projectId
      ? { projectId }
      : { projectName: data.projectName.trim() }),
    title: null,
    dateDevis: todayISO(),
    validiteJours: DEFAULT_VALIDITE_JOURS,
    projectNotes: buildProjectNotes(data.projectFamily),
  });
}

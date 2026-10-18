import {
  createEstimate,
  importLinkedDpgfSource,
  instantiateEstimateFromTemplate,
  type InstantiateEstimateTemplateConversion,
} from "@/lib/estimates/client";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import {
  DEFAULT_VALIDITE_JOURS,
  HISTORICAL_CREATION_ENGINE,
  buildDpgfImportCreatePayload,
  buildProjectNotes,
  parseWizardSaleCoefficient,
  resolveWizardV3Rounding,
  todayISO,
  type EstimateCreationEngine,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

export type SubmitEstimateCreationResult = {
  versionId: string;
  linkedDpgfImportWarning?: string;
  /** Sous-lot 2.10a : modèle entré dans une v3 (lignes converties, réglages non repris). */
  templateConversion?: InstantiateEstimateTemplateConversion;
};

type SubmitEstimateCreationArgs = {
  data: WizardData;
  projectId?: string;
  creationEngine?: EstimateCreationEngine;
};

/** Sous-lot 2.10a (A4) : réglages de prix envoyés à une v3, aucune clé réservée au moteur 2. */
function buildV3PricingPayload(data: WizardData) {
  const saleCoefficientFo = parseWizardSaleCoefficient(data.saleCoefficientFo);
  const saleCoefficientMo = parseWizardSaleCoefficient(data.saleCoefficientMo);
  if (saleCoefficientFo === null || saleCoefficientMo === null) {
    throw new Error("Coefficient de vente invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus.");
  }
  const rounding = resolveWizardV3Rounding(data);
  return {
    saleCoefficientFo,
    saleCoefficientMo,
    roundingMode: rounding.mode,
    roundingStepCents: rounding.mode === "down" ? rounding.step : undefined,
  };
}

function buildV2PricingPayload(data: WizardData) {
  const marginBpNum = data.marginBp ? Number(data.marginBp) : 0;
  return {
    marginMode: data.marginMode,
    marginBp: marginBpNum > 0 ? marginBpNum : undefined,
    marginMultiplier: marginBpNum > 0 ? 1 + marginBpNum / 10000 : undefined,
    roundingMode: data.roundingMode,
    roundingStepCents:
      data.roundingMode !== "none"
        ? Number(data.roundingStepCents)
        : undefined,
  };
}

export async function submitEstimateCreation({
  data,
  projectId,
  creationEngine = HISTORICAL_CREATION_ENGINE,
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
        expectedCalcEngineVersion: creationEngine.engine,
      }
    );
    const report = templateResult.conversion;
    const conversion = report && (report.convertedLines.length > 0 || report.droppedSettings.length > 0)
      ? { templateConversion: report }
      : {};

    if (data.dpgfImportMode !== "source") {
      return { versionId: templateResult.versionId, ...conversion };
    }

    try {
      await importLinkedDpgfSource(templateResult.versionId);
      return { versionId: templateResult.versionId, ...conversion };
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      return {
        versionId: templateResult.versionId,
        ...conversion,
        linkedDpgfImportWarning: detail
          ? `Le chiffrage a été créé, mais le DPGF source n'a pas pu être importé : ${detail}`
          : "Le chiffrage a été créé, mais le DPGF source n'a pas pu être importé.",
      };
    }
  }

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
    ...(usesSaleCoefficients(creationEngine.engine) ? buildV3PricingPayload(data) : buildV2PricingPayload(data)),
    taxRateBp: Number(data.taxRateBp),
    currency: data.currency || undefined,
    projectNotes: buildProjectNotes(data.projectFamily),
    expectedCalcEngineVersion: creationEngine.engine,
    ...dpgfImportPayload,
  });

  return { versionId };
}

export async function quickCreateEstimateCreation({
  data,
  projectId,
  creationEngine = HISTORICAL_CREATION_ENGINE,
}: SubmitEstimateCreationArgs): Promise<string> {
  return createEstimate({
    ...(projectId
      ? { projectId }
      : { projectName: data.projectName.trim() }),
    title: null,
    dateDevis: todayISO(),
    validiteJours: DEFAULT_VALIDITE_JOURS,
    projectNotes: buildProjectNotes(data.projectFamily),
    // Paramètres par défaut : seule l'attente part (une v3 reçoit les coefficients de la politique).
    expectedCalcEngineVersion: creationEngine.engine,
  });
}

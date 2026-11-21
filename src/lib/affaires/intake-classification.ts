import { buildClassificationFilePayload } from "@/lib/affaires/intake-file-payload";
import type { IntakeAnalysisFailure } from "@/lib/affaires/intake-analysis-feedback";
import { WordReadError, isWordFile } from "@/lib/affaires/intake-word-reader";
import { AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION, buildClassificationPrompt } from "@/lib/affaires/intake-classification-prompt";
import { withAffaireAiCategoryProposal } from "@/lib/affaires/intake-reanalysis";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { StructuredAiError, structuredAiFailureMessage } from "@/lib/ai/structured-ai-diagnostic";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { classifyAutonomousAffaireDocument, isIntakeDecisionsSelected } from "@/lib/affaires/intake-decisions";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { StructuredCallFile } from "@/lib/ai/structured-call";
import {
  isAffaireIntakeCadDocument,
  affaireIntakeClassificationAiResultSchema,
  getHeuristicAffaireDocumentClassification,
  mergeAffaireDocumentClassificationWithHeuristic,
  type AffaireIntakeClassificationResult,
  type AffaireIntakeClassificationSource,
  type AffaireIntakeExtractedMetadata,
} from "@/lib/affaires/intake";
import { addIssue } from "@/lib/affaires/intake-rows";

const AFFAIRE_INTAKE_CLASSIFICATION_MODEL = "gemini-3-flash-preview";

export function getSafeProviderErrorCode(error: unknown) {
  if (error instanceof StructuredAiError) return error.code;
  return error instanceof TakeoffError && Object.values(TakeoffErrorCode).some((code) => code === error.code)
    ? error.code
    : "PROVIDER_ERROR";
}

export async function classifyAffaireIntakeDocument(input: {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  beforeProviderCall?: () => Promise<void>;
  aiOwner?: ChatGptOwner | null;
  decisionsContext?: { owner: ChatGptOwner; projectId: string; documentId: string; sourceVersion: string };
  existingMetadata?: AffaireIntakeExtractedMetadata;
}): Promise<{
  result: AffaireIntakeClassificationResult;
  source: AffaireIntakeClassificationSource;
  analysisSucceeded?: boolean;
  analysisFailure?: IntakeAnalysisFailure;
}> {
  const heuristicResult = getHeuristicAffaireDocumentClassification({
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (input.existingMetadata) heuristicResult.extractedMetadata = input.existingMetadata;

  if (isAffaireIntakeCadDocument(input.fileName)) return { result: heuristicResult, source: "heuristic",
    analysisFailure: { code: "UNSUPPORTED_FORMAT", message: "Ce format CAO/BIM n’est pas lisible par l’IA. Ajoutez un export PDF pour les plans.", scope: "document" } };

  let filePayload: (StructuredCallFile & { issues?: string[] }) | null = null;
  let payloadFailure: IntakeAnalysisFailure | undefined;

  try {
    if (!isIntakeDecisionsSelected() || isWordFile(input.fileName, input.mimeType)) filePayload = await buildClassificationFilePayload(input);
  } catch (error) {
    payloadFailure = { code: error instanceof WordReadError ? error.code : "DOCUMENT_UNREADABLE",
      message: error instanceof WordReadError ? error.message : "Le fichier est illisible, protégé ou dépasse les limites d’analyse. Réenregistrez-le puis relancez.", scope: "document" };
    console.error("Failed to build affaire intake classification payload", {
      error_code: "CLASSIFICATION_PAYLOAD_ERROR",
    });
  }

  if (isIntakeDecisionsSelected() && !payloadFailure) {
    const classified = await classifyAutonomousAffaireDocument({ ...input, heuristicResult,
    readLocalText: async () => {
      const payload = filePayload ?? await buildClassificationFilePayload(input);
      return payload?.mimeType.startsWith("text/") ? Buffer.from(payload.data, "base64").toString("utf8") : undefined;
    },
    });
    classified.result.issues = [...new Set([...(filePayload?.issues ?? []), ...classified.result.issues])].slice(0, 10);
    return classified.source === "ai" ? { ...classified, result: withAffaireAiCategoryProposal(classified.result, new Date().toISOString()), analysisSucceeded: true }
      : { ...classified, analysisFailure: classified.analysisFailure ?? { code: "AI_UNAVAILABLE", message: classified.result.issues.find(issue => issue.startsWith("Analyse IA :")) ?? "Le fournisseur IA n’a pas pu analyser cette pièce.", scope: "provider" } };
  }

  if (!filePayload) {
    return {
      result: {
        ...heuristicResult,
        issues: addIssue(
          heuristicResult.issues,
          payloadFailure?.message ?? "Analyse IA indisponible pour ce format, classement heuristique applique."
        ),
      },
      source: "heuristic",
      analysisFailure: payloadFailure ?? { code: "UNSUPPORTED_FORMAT", message: "Ce format ne peut pas être lu par l’IA. Utilisez un export PDF ou texte.", scope: "document" },
    };
  }

  await input.beforeProviderCall?.();

  try {
    const geminiResult = await callStructuredAi({
      prompt: buildClassificationPrompt({
        fileName: input.fileName,
        mimeType: input.mimeType,
      }),
      schema: affaireIntakeClassificationAiResultSchema,
      files: [filePayload],
      context: {
        model: AFFAIRE_INTAKE_CLASSIFICATION_MODEL,
        promptVersion: AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION,
      },
    }, input.aiOwner);

    const mergedResult = mergeAffaireDocumentClassificationWithHeuristic({
      aiResult: geminiResult.data,
      heuristicResult,
    });
    const source =
      mergedResult.documentKind === geminiResult.data.documentKind ? "ai" : "heuristic";

    return {
      result: withAffaireAiCategoryProposal({ ...mergedResult, issues: [...(filePayload.issues ?? []), ...mergedResult.issues].slice(0, 10) }, new Date().toISOString()),
      source,
      analysisSucceeded: true,
    };
  } catch (error) {
    console.error("Affaire intake AI classification failed", {
      error_code: getSafeProviderErrorCode(error),
      ...(error instanceof StructuredAiError && error.providerStatus ? { provider_status: error.providerStatus } : {}),
    });

    return {
      result: {
        ...heuristicResult,
        issues: addIssue(addIssue(heuristicResult.issues,
          "Classification heuristique retenue car l'analyse IA a echoue."),
          `Analyse IA : ${structuredAiFailureMessage(error)}`),
      },
      source: "heuristic",
      analysisFailure: { code: getSafeProviderErrorCode(error), message: structuredAiFailureMessage(error), scope: "provider" },
    };
  }
}

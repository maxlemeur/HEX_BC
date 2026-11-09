import {
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE,
  type AffaireIntakeClassificationResult,
  type AffaireIntakeClassificationSource,
  type AffaireIntakeDocumentKind,
  type AffaireIntakeExtractedMetadata,
} from "@/lib/affaires/intake";

export function withAffaireAiCategoryProposal(result: AffaireIntakeClassificationResult, now: string) {
  return { ...result, extractedMetadata: { ...result.extractedMetadata, aiCategoryProposal: {
    category: result.documentKind, confidence: result.confidence, analyzedAt: now,
    nature: result.extractedMetadata.documentNature ?? null,
  } } };
}

/** A new extraction must not turn an explicit human category back into an AI proposal. */
export function buildAffaireIntakeReanalysisUpdate(input: {
  document: { document_kind: AffaireIntakeDocumentKind; extracted_metadata: AffaireIntakeExtractedMetadata };
  preserveManualClassification: boolean;
  classification: { result: AffaireIntakeClassificationResult; source: AffaireIntakeClassificationSource; analysisSucceeded?: boolean };
  now: string;
}) {
  const { document, classification, preserveManualClassification } = input;
  const analysisSucceeded = classification.analysisSucceeded ?? classification.source === "ai";
  const resultIssues = classification.result.issues.filter(issue => issue !== AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE);
  const status = preserveManualClassification && document.document_kind !== "a_classer" ? "classified" : "ambiguous";
  const issues = preserveManualClassification
    ? [analysisSucceeded
      ? `Analyse IA relancée : catégorie proposée « ${AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[classification.result.documentKind]} ». Classement manuel « ${AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[document.document_kind]} » conservé.`
      : "L’analyse IA n’a pas abouti. Le classement manuel et les informations précédentes sont conservés.", ...resultIssues].slice(0, 10)
    : resultIssues;
  return {
    analysisSucceeded,
    values: {
      classification_status: status,
      ...(!preserveManualClassification ? {
        document_kind: classification.result.documentKind,
        confidence: classification.result.confidence, classification_source: classification.source,
        classified_at: input.now,
      } : {}),
      issues,
      extracted_metadata: analysisSucceeded ? withAffaireAiCategoryProposal(classification.result, input.now).extractedMetadata : document.extracted_metadata,
    },
  };
}

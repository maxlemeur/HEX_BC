import {
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeDocumentProcessing,
  isAffaireIntakeAnalysisStale,
  isAffaireIntakeReanalysisPending,
  isAffaireIntakeCadDocument,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";

export type DossierDocument = AffaireIntakeWorkspace["documents"][number];
// Eligibility for document tools does not require a human validation.
export function dossierDocumentClassificationState(
  document: DossierDocument,
): "review" | "valid" | "processing" | "unavailable" {
  if (document.isBeingDeleted || document.uploadStatus !== "uploaded")
    return "unavailable";
  if (isAffaireIntakeAnalysisStale(document)) return "review";
  if (isAffaireIntakeDocumentProcessing(document)) return "processing";
  if (
    isAffaireIntakeDocumentNeedingReview(document) ||
    document.detectedCategory === "a_classer"
  )
    return "review";
  return "valid";
}
export function dossierDocumentState(document: DossierDocument) {
  const state = dossierDocumentClassificationState(document);
  return state === "valid" && document.classificationSource !== "manual" && !document.manuallyOverriddenAt
    ? "review"
    : state;
}
export function dossierDocumentAiConfidence(document: DossierDocument): number | null {
  if (
    document.classificationSource !== "ai" ||
    document.manuallyOverriddenAt ||
    document.classificationStatus !== "classified" ||
    dossierDocumentClassificationState(document) !== "valid" ||
    !Number.isFinite(document.confidence) ||
    document.confidence < 0 ||
    document.confidence > 1
  ) return null;
  return Math.round(document.confidence * 100);
}
export function canClassifyDossierDocument(document: DossierDocument) {
  const state = dossierDocumentState(document);
  return state === "review" || state === "valid";
}
export function canRetryDossierDocument(document: DossierDocument) {
  if (isAffaireIntakeReanalysisPending(document) && !isAffaireIntakeAnalysisStale(document)) return false;
  return (
    !document.isBeingDeleted && document.uploadStatus === "uploaded" &&
    (["classified", "ambiguous", "failed"].includes(document.classificationStatus ?? "") ||
      isAffaireIntakeAnalysisStale(document))
  );
}
export function dossierPreviewFormat(
  document: DossierDocument,
): "pdf" | "image" | "text" | null {
  if (isAffaireIntakeCadDocument(document.fileName)) return null;
  const mime = document.mimeType?.split(";")[0].toLowerCase();
  if (
    mime === "application/pdf" ||
    (!mime && /\.pdf$/i.test(document.fileName))
  )
    return "pdf";
  if (["image/png", "image/jpeg", "image/webp"].includes(mime ?? ""))
    return "image";
  if (["text/plain", "text/csv"].includes(mime ?? "")) return "text";
  return null;
}

import {
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeDocumentProcessing,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";

export type DossierDocument = AffaireIntakeWorkspace["documents"][number];
export function dossierDocumentState(
  document: DossierDocument,
): "review" | "valid" | "processing" | "unavailable" {
  if (document.isBeingDeleted || document.uploadStatus !== "uploaded")
    return "unavailable";
  if (isAffaireIntakeDocumentProcessing(document)) return "processing";
  if (
    isAffaireIntakeDocumentNeedingReview(document) ||
    document.detectedCategory === "a_classer"
  )
    return "review";
  return "valid";
}
export function canClassifyDossierDocument(document: DossierDocument) {
  const state = dossierDocumentState(document);
  return state === "review" || state === "valid";
}
export function dossierPreviewFormat(
  document: DossierDocument,
): "pdf" | "image" | "text" | null {
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

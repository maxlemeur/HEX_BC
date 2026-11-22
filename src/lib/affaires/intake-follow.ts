import { isAffaireIntakeDocumentProcessing, type AffaireIntakeReviewableDocument } from "@/lib/affaires/intake";
import { AFFAIRE_INTAKE_LEASE_TTL_MS, AFFAIRE_INTAKE_RETRY_BACKOFF_SECONDS } from "@/lib/workflows/affaire-intake-lifecycle";

/**
 * What the affaire's page waits for while its dossier is analysed, as the server stored it. A batch's analysis ends
 * when its run records the upload's last status (finish_affaire_intake_upload_attempt: ready, partial_failure or
 * failed), after it classified its pieces, read their text and wrote the brief (intake-analysis-server.ts); the
 * workspace names the batches not ended yet (`pendingUploadIds`). A piece analysed again on its own, which rearms no
 * batch, ends with its own classification. The key changes with every batch and every piece that ends, so a new batch
 * starts a new wait whatever the previous one did. Null: the server says nothing more is to come.
 */
export function affaireDossierWaitKey(workspace: {
  pendingUploadIds?: readonly string[];
  documents: ReadonlyArray<AffaireIntakeReviewableDocument & { documentId?: string; isBeingDeleted?: boolean }>;
  // Read for nothing: a brief on screen ends no wait, since a batch still running may write it again.
  briefDraft?: unknown;
} | null | undefined): string | null {
  if (!workspace) return null;
  const batches = [...(workspace.pendingUploadIds ?? [])].sort();
  const pieces = workspace.documents
    .filter((document) => (document.uploadStatus ?? "uploaded") === "uploaded" && !document.isBeingDeleted
      && isAffaireIntakeDocumentProcessing(document))
    .map((document) => document.documentId ?? document.fileName ?? "").sort();
  return batches.length || pieces.length ? `${batches.join(",")}|${pieces.join(",")}` : null;
}

/** One read of the whole dossier every four seconds while it waits: one cadence for the page, whatever asks. */
export const AFFAIRE_DOSSIER_FOLLOW_INTERVAL_MS = 4_000;

/**
 * Past this time without the server's record of the end, the page stops reading, says the brief may be ready and
 * offers « Actualiser »: a run renews its lease while it works, so a batch still not ended one lease and the longest
 * retry backoff after the page began to wait either reads many pages or waits for its recovery.
 */
export const AFFAIRE_DOSSIER_FOLLOW_CEILING_MS = AFFAIRE_INTAKE_LEASE_TTL_MS + Math.max(...AFFAIRE_INTAKE_RETRY_BACKOFF_SECONDS) * 1000;

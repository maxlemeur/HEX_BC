import "server-only";
import type { AffaireAccess } from "@/lib/affaires/access-server";
import { intakeCurrentBriefActive } from "@/lib/affaires/intake-current-brief-server";
import { DOCUMENT_SELECT, normalizeDocumentRow } from "@/lib/affaires/intake-rows";
import { internalError, notFound } from "@/lib/http/api-error";

/** Both manual classification and individual analysis may repair a terminal legacy row.
 * The RPC rechecks the caller and the locked lot. Read the new version before editing. */
export async function readEditableIntakeDocument(context: AffaireAccess["context"], projectId: string, documentId: string) {
  const readDocument = async () => {
    const { data, error } = await context.supabase.from("affaire_intake_documents").select(DOCUMENT_SELECT)
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", documentId)
      .is("deleted_at", null).is("deletion_token", null).maybeSingle();
    if (error) throw internalError("Impossible de lire le document du dossier.", error);
    const document = normalizeDocumentRow(data);
    if (!document) throw notFound("Document introuvable.");
    return document;
  };
  const document = await readDocument();
  if (!document.analysis_launch_id && ["queued", "processing"].includes(document.classification_status) && await intakeCurrentBriefActive(context.supabase)) {
    const { data: prepared, error } = await context.supabase.rpc("prepare_historical_intake_document_retry", {
      p_project_id: projectId, p_document_id: document.id,
    });
    if (error) throw internalError("Impossible de préparer la relance historique.", error);
    if (prepared) return readDocument();
  }
  return document;
}

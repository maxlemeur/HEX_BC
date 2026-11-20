import "server-only";

import { normalizeIntakeTranscription, type IntakeTranscription } from "@/lib/affaires/intake-transcription";
import { inferAffaireIntakeMimeType } from "@/lib/affaires/intake";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { canTranscribeIntakeDocument, isIntakeRetryReadingRunning } from "@/lib/affaires/intake-transcription-server";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { internalError, notFound } from "@/lib/http/api-response";

/**
 * The automatic transcription of an active piece of the dossier, read with the
 * member's rights (the piece's own policies decide); null when the piece has
 * none, as a text PDF or a spreadsheet. `pending`: the piece's analysis still
 * runs on an instance that reads on the ChatGPT plan, and a reading may follow it,
 * or a retry's reading runs, which will replace the reading shown.
 */
export async function readAffaireDocumentTranscription(projectId: string, documentId: string): Promise<{
  transcription: IntakeTranscription | null; pending: boolean;
}> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { data: document, error: documentError } = await context.supabase.from("affaire_intake_documents").select("id,upload_id,file_name,mime_type")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", documentId)
    .eq("upload_status", "uploaded").is("deleted_at", null).is("deletion_token", null).maybeSingle();
  if (documentError) throw internalError("Impossible de charger le document.", documentError);
  if (!document) throw notFound("Ce document n’est plus disponible dans l’affaire.");
  const { data, error } = await context.supabase.from("affaire_intake_document_transcriptions")
    .select("status,pages,pages_needed,pages_skipped,model,reasoning_effort,error_code,updated_at")
    .eq("tenant_id", context.tenantId).eq("document_id", document.id).maybeSingle();
  if (error) throw internalError("Impossible de charger la transcription.", error);
  if (data) return { transcription: normalizeIntakeTranscription(data), pending: isIntakeRetryReadingRunning(document.id) };
  // Only an instance that reads on the ChatGPT plan reads images and PDFs: elsewhere nothing will follow.
  const mimeType = document.mime_type ?? inferAffaireIntakeMimeType(document.file_name) ?? "";
  if (!isLocalChatGptEnabled() || !canTranscribeIntakeDocument(mimeType)) return { transcription: null, pending: false };
  if (isIntakeRetryReadingRunning(document.id)) return { transcription: null, pending: true };
  const { data: upload, error: uploadError } = await context.supabase.from("affaire_intake_uploads").select("status")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", document.upload_id).maybeSingle();
  if (uploadError) throw internalError("Impossible de charger la transcription.", uploadError);
  return { transcription: null, pending: upload?.status === "queued" || upload?.status === "processing" };
}

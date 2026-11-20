import { ApiError, internalError, mapSupabaseError, notFound } from "@/lib/http/api-response";
import { AFFAIRE_INTAKE_BUCKET, AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES } from "@/lib/affaires/intake";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readLinkedDriveDocument, readLinkedDriveFile } from "@/lib/affaires/google-drive/content";
import { DriveError } from "@/lib/affaires/google-drive/errors";

/** Resolve only an active, classified DPGF of the current affair: a stored copy or a Drive link. */
async function getAffaireIntakeDpgf(projectId: string, documentId: string) {
  const { context, project } = await requireAffaireAccess(projectId, "write");
  const { data, error } = await context.supabase
    .from("affaire_intake_documents")
    .select("id, tenant_id, file_name, mime_type, size_bytes, storage_path, drive_connection_id, drive_file_id" as never)
    .eq("id", documentId)
    .eq("tenant_id", context.tenantId)
    .eq("project_id", project.id)
    .eq("upload_status", "uploaded")
    .eq("classification_status", "classified")
    .eq("document_kind", "dpgf")
    .is("deleted_at", null)
    .is("deletion_token", null)
    .maybeSingle();

  if (error) throw mapSupabaseError(error, "Impossible de charger la DPGF du dossier.");
  const document = data as unknown as {
    tenant_id: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number;
    storage_path: string | null;
    drive_connection_id: string | null;
    drive_file_id: string | null;
  } | null;
  if (!document || !(document.storage_path || document.drive_file_id) || document.size_bytes <= 0 ||
      document.size_bytes > AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES) {
    throw notFound("DPGF introuvable dans cette affaire. Actualisez le dossier.");
  }

  return { context, document };
}

async function readDpgfFromDrive<T>(read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof DriveError) throw new ApiError({ status: error.status, code: error.code, message: error.message });
    throw error;
  }
}

/**
 * A Drive piece has no stored copy and no downloadUrl: the server reads it from Drive for the
 * PDF review and the import. Its current Drive metadata is checked here so a lost access shows
 * up when the DPGF is chosen.
 */
export async function getAffaireIntakeDpgfDownload(projectId: string, documentId: string) {
  const { context, document } = await getAffaireIntakeDpgf(projectId, documentId);
  if (!document.storage_path) {
    const file = await readDpgfFromDrive(() => readLinkedDriveFile(document));
    return {
      documentId,
      fileName: document.file_name,
      mimeType: document.mime_type,
      sizeBytes: Number(file.size),
      downloadUrl: null,
    };
  }
  const { data: signed, error: signedError } = await context.supabase.storage
    .from(AFFAIRE_INTAKE_BUCKET)
    .createSignedUrl(document.storage_path, 60);
  if (signedError || !signed?.signedUrl) {
    throw internalError("Impossible de récupérer la DPGF du dossier.");
  }

  return {
    documentId,
    fileName: document.file_name,
    mimeType: document.mime_type,
    sizeBytes: document.size_bytes,
    downloadUrl: signed.signedUrl,
  };
}

export async function readAffaireIntakeDpgfFile(projectId: string, documentId: string) {
  const { context, document } = await getAffaireIntakeDpgf(projectId, documentId);
  if (!document.storage_path) {
    // The current Drive content, read with the account of the member who linked it.
    const { bytes } = await readDpgfFromDrive(() => readLinkedDriveDocument(document));
    return new File([bytes], document.file_name, { type: document.mime_type ?? "application/octet-stream" });
  }
  const { data: blob, error } = await context.supabase.storage.from(AFFAIRE_INTAKE_BUCKET)
    .download(document.storage_path);
  if (error || !blob || blob.size !== document.size_bytes) {
    throw internalError("Impossible de récupérer la copie DPGF complète.");
  }
  return new File([blob], document.file_name, { type: document.mime_type ?? blob.type });
}

import "server-only";

import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import { requireAffaireProjectReadAccess } from "@/lib/affaires/intake-server";
import { readLinkedDriveDocument } from "@/lib/affaires/google-drive/content";
import { DriveError } from "@/lib/affaires/google-drive/errors";
import {
  ApiError,
  badRequest,
  internalError,
  notFound,
} from "@/lib/estimates/errors";

const MAX_BYTES = 50 * 1024 * 1024;
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
]);

/** Reads the active dossier piece with the same tenant/project boundary as its listing. */
export async function readAffaireDocumentPreview(
  projectId: string,
  documentId: string,
  download: boolean,
) {
  const { context, project } = await requireAffaireProjectReadAccess(projectId);
  const { data, error } = await context.supabase
    .from("affaire_intake_documents")
    .select(
      "tenant_id,file_name,mime_type,size_bytes,storage_path,drive_connection_id,drive_file_id",
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", project.id)
    .eq("id", documentId)
    .eq("upload_status", "uploaded")
    .is("deleted_at", null)
    .is("deletion_token", null)
    .maybeSingle();
  if (error) throw internalError("Impossible de charger le document.", error);
  if (!data || (!data.storage_path && !data.drive_file_id))
    throw notFound("Ce document n’est plus disponible dans l’affaire.");
  if (data.size_bytes <= 0 || data.size_bytes > MAX_BYTES)
    throw badRequest("La taille du document ne permet pas son ouverture.");
  const mimeType =
    data.mime_type?.split(";")[0].trim().toLowerCase() ??
    "application/octet-stream";
  if (!download && !INLINE_TYPES.has(mimeType))
    throw badRequest(
      "L’aperçu de ce format n’est pas disponible. Téléchargez le document pour l’ouvrir.",
    );
  let bytes: Uint8Array;
  if (data.storage_path) {
    const stored = await context.supabase.storage
      .from(AFFAIRE_INTAKE_BUCKET)
      .download(data.storage_path);
    if (stored.error || !stored.data)
      throw notFound(
        "Le fichier n’est plus disponible. Actualisez le dossier.",
      );
    if (stored.data.size > MAX_BYTES)
      throw badRequest("Le document dépasse la taille autorisée.");
    bytes = new Uint8Array(await stored.data.arrayBuffer());
  } else {
    try {
      bytes = (await readLinkedDriveDocument(data)).bytes;
    } catch (cause) {
      if (cause instanceof DriveError)
        throw new ApiError({
          status: cause.status,
          code: cause.code,
          message: cause.message,
        });
      throw cause;
    }
  }
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES)
    throw badRequest("Le document est vide ou dépasse la taille autorisée.");
  return {
    bytes,
    fileName: data.file_name,
    mimeType: download
      ? "application/octet-stream"
      : mimeType === "text/csv"
        ? "text/plain; charset=utf-8"
        : mimeType,
  };
}

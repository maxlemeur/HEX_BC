import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createEmptyAffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";
import { readAllRows } from "@/lib/supabase/read-all";
import type { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { driveFileUrl, driveFolderUrl, type DriveFile, type DriveFolderLink, type DriveLinkResult,
  type DriveLinkedFile, type DriveProvenance } from "./contracts";

// Kept free of Next so the owned native campaign loads this exact persistence code.
// server.ts maps it to the API error at the HTTP boundary.
export class DriveStoreError extends Error {
  constructor(readonly status: 409 | 500, message: string) {
    super(message);
    this.name = "DriveStoreError";
  }
}
const internalError = (message: string) => new DriveStoreError(500, message);
const RECORDING = "Liens Drive en cours d'enregistrement.";

type Access = Awaited<ReturnType<typeof requireAffaireProjectOwnerOrAdmin>>;
type Database = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const database = (access: Access) => access.context.supabase as unknown as Database;
const LINK_SELECT = "id,upload_id,file_name,created_at,drive_file_id,drive_folder_id,drive_folder_name,drive_revision,drive_connection_id";
const linkRowSchema = z.object({ id: z.string(), upload_id: z.string(), file_name: z.string(), created_at: z.string(),
  drive_file_id: z.string(), drive_folder_id: z.string().nullable(), drive_folder_name: z.string().nullable(),
  drive_revision: z.string().nullable(), drive_connection_id: z.string().nullable() });
export type DriveLinkRow = z.infer<typeof linkRowSchema>;

export function driveProvenance(row: DriveLinkRow): DriveProvenance {
  return { provider: "google_drive", fileId: row.drive_file_id, sourceName: row.file_name, sourceUrl: driveFileUrl(row.drive_file_id),
    folderId: row.drive_folder_id, folderName: row.drive_folder_name, revision: row.drive_revision, linkedAt: row.created_at,
    connectionAvailable: row.drive_connection_id !== null };
}

/** The Drive pieces currently in the affaire dossier (removed links leave a tombstone). */
export async function readDriveLinks(access: Access): Promise<DriveLinkedFile[]> {
  const { context, project } = access;
  const { data, error } = await readAllRows(() => database(access).from("affaire_intake_documents")
    .select(LINK_SELECT, { count: "exact" }).eq("tenant_id", context.tenantId).eq("project_id", project.id)
    .eq("source_provider", "google_drive").is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false }));
  if (error) throw internalError("Impossible de lire les liens Google Drive de l'affaire.");
  return z.array(linkRowSchema).parse(data ?? []).map((row) => ({ documentId: row.id, uploadId: row.upload_id, source: driveProvenance(row) }));
}

const folderRowSchema = z.object({ folder_id: z.string(), folder_name: z.string(), shared_drive_id: z.string().nullable(),
  connection_id: z.string().nullable(), updated_at: z.string() });
export async function readDriveFolderLink(access: Access): Promise<DriveFolderLink | null> {
  const { data, error } = await database(access).from("affaire_google_drive_folders")
    .select("folder_id,folder_name,shared_drive_id,connection_id,updated_at")
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).maybeSingle();
  if (error) throw internalError("Impossible de lire le dossier Drive de l'affaire.");
  if (!data) return null;
  const row = folderRowSchema.parse(data);
  return { folderId: row.folder_id, folderName: row.folder_name, sharedDriveId: row.shared_drive_id,
    connectionId: row.connection_id, linkedAt: row.updated_at, url: driveFolderUrl(row.folder_id) };
}
export async function saveDriveFolderLink(access: Access, connectionId: string, folder: DriveFile) {
  const { error } = await database(access).from("affaire_google_drive_folders").upsert({
    project_id: access.project.id, tenant_id: access.context.tenantId, linked_by: access.context.userId,
    connection_id: connectionId, folder_id: folder.id, folder_name: folder.name, shared_drive_id: folder.driveId ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "project_id" });
  if (error) throw internalError("Le dossier Drive n'a pas pu être lié à l'affaire.");
  return readDriveFolderLink(access);
}
export async function removeDriveFolderLink(access: Access) {
  const { error } = await database(access).from("affaire_google_drive_folders").delete()
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id);
  if (error) throw internalError("Le dossier Drive n'a pas pu être délié.");
}

/**
 * Arms again the lots of this affaire that an interrupted link request left being recorded,
 * once they are clearly stale. Opening the Drive panel or linking files runs it.
 */
export async function resumeStaleDriveLots(access: Access) {
  const { data } = await database(access).from("affaire_intake_uploads").update({ status: "queued", last_error: null })
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).eq("status", "failed")
    .eq("last_error", RECORDING).lt("created_at", new Date(Date.now() - 120_000).toISOString()).select("id");
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

// A finished lot runs again, with a fresh retry budget: its failed pieces are analysed anew.
// No project filter: the caller's RLS fences the lots it may update.
async function rearmFinishedLot(db: Database, tenantId: string, uploadId: string) {
  const { data, error } = await db.from("affaire_intake_uploads")
    .update({ status: "queued", last_error: null, next_retry_at: null, attempt_count: 0 })
    .eq("tenant_id", tenantId).eq("id", uploadId)
    .in("status", ["ready", "partial_failure", "failed"]).select("id");
  return !error && Boolean((data as unknown[] | null)?.length);
}

/**
 * Once a member reconnects a Google account, the lots holding pieces linked with it whose
 * analysis failed run again: that failure may be the expired access. Read under the member's RLS.
 */
export async function rearmLotsFailedWithConnection(member: { supabase: unknown; tenantId: string }, connectionId: string) {
  const db = member.supabase as Database;
  // Across every affaire of the account: paged past the API's row cap.
  const { data, error } = await readAllRows(() => db.from("affaire_intake_documents").select("id,upload_id", { count: "exact" })
    .eq("tenant_id", member.tenantId).eq("drive_connection_id", connectionId)
    .eq("classification_status", "failed").is("deleted_at", null));
  if (error) return [];
  const rearmed: string[] = [];
  for (const uploadId of new Set(((data ?? []) as Array<{ upload_id: string }>).map((row) => row.upload_id))) {
    if (await rearmFinishedLot(db, member.tenantId, uploadId)) rearmed.push(uploadId);
  }
  return rearmed;
}

/**
 * Records each selected Drive file as a piece of the affaire, without transferring its content.
 * One selection is one intake upload, armed once after its last link so that the classifier
 * reads the files from Drive and regenerates the brief and missing pieces from the whole lot.
 */
export async function linkDriveFiles(access: Access, input: { connectionId: string; files: Array<{ file: DriveFile; folder?: { id: string; name: string } }> }) {
  const { context, project } = access;
  const results: DriveLinkResult[] = [];
  const active = new Map((await readDriveLinks(access)).map((link) => [link.source.fileId, link]));
  const candidates = input.files.filter(({ file }) => !active.has(file.id));
  const rearmed = new Set<string>();
  for (const { file } of input.files) {
    const link = active.get(file.id);
    if (!link) continue;
    if (link.source.connectionAvailable) {
      results.push({ fileId: file.id, name: file.name, status: "already_linked", message: "Ce fichier est déjà lié à l'affaire.", documentId: link.documentId });
      continue;
    }
    // Its Google account was removed: the link is attached to the account chosen now.
    const attached = await database(access).from("affaire_intake_documents").update({ drive_connection_id: input.connectionId })
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", link.documentId)
      .is("drive_connection_id", null).is("deleted_at", null).select("id,classification_status");
    const row = attached.error ? undefined : (attached.data as Array<{ classification_status: string }> | null)?.[0];
    if (!row) {
      results.push({ fileId: file.id, name: file.name, status: "failed", message: "Lien non rattaché à ce compte. Réessayez." });
      continue;
    }
    // Its analysis may have failed for want of that account: it runs again with this one.
    const retried = row.classification_status === "failed" && (rearmed.has(link.uploadId) || await rearmFinishedLot(database(access), context.tenantId, link.uploadId));
    if (retried) rearmed.add(link.uploadId);
    results.push({ fileId: file.id, name: file.name, status: "linked", documentId: link.documentId,
      message: retried ? "Lien rattaché à ce compte Google. Analyse relancée." : "Lien rattaché à ce compte Google." });
  }
  const resumed = [...new Set([...rearmed, ...await resumeStaleDriveLots(access)])];
  if (!candidates.length) return { results, uploadId: null, resumed };
  const uploadId = randomUUID();
  // Not queued yet: a recovery worker must not classify a lot that is still being recorded.
  const upload = await database(access).from("affaire_intake_uploads").insert({ id: uploadId, project_id: project.id,
    created_by: context.userId, status: "failed", last_error: RECORDING });
  if (upload.error) throw internalError("Impossible de préparer les liens Drive.");
  await database(access).from("affaire_intake_events").insert({ upload_id: uploadId, actor_user_id: context.userId,
    event_type: "upload.created", after_payload: { status: "queued", file_count: candidates.length, drive: { provider: "google_drive" } } });
  let linked = 0;
  for (const { file, folder } of candidates) {
    const documentId = randomUUID();
    const inserted = await database(access).from("affaire_intake_documents").insert({
      id: documentId, upload_id: uploadId, created_by: context.userId, storage_path: null, file_name: file.name,
      mime_type: file.mimeType, size_bytes: Number(file.size), upload_status: "uploaded", classification_status: "queued",
      document_kind: "a_classer", issues: [], extracted_metadata: createEmptyAffaireIntakeExtractedMetadata(),
      source_provider: "google_drive", drive_connection_id: input.connectionId, drive_file_id: file.id,
      drive_folder_id: folder?.id ?? null, drive_folder_name: folder?.name ?? null,
      drive_shared_drive_id: file.driveId ?? null, drive_revision: file.version ?? null, drive_modified_time: file.modifiedTime ?? null,
    });
    if (inserted.error) {
      // The active-link index settles a concurrent selection of the same file.
      results.push(inserted.error.code === "23505"
        ? { fileId: file.id, name: file.name, status: "already_linked", message: "Ce fichier est déjà lié à l'affaire." }
        : { fileId: file.id, name: file.name, status: "failed", message: "Lien non enregistré. Réessayez." });
      continue;
    }
    linked += 1;
    await database(access).from("affaire_intake_events").insert({ upload_id: uploadId, document_id: documentId, actor_user_id: context.userId,
      event_type: "document.uploaded", after_payload: { drive: { provider: "google_drive", fileId: file.id, revision: file.version ?? null,
        folderId: folder?.id ?? null } } });
    results.push({ fileId: file.id, name: file.name, status: "linked", message: "Lien enregistré. Analyse en cours.", documentId });
  }
  if (!linked) {
    await database(access).from("affaire_intake_uploads").delete().eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", uploadId);
    return { results, uploadId: null, resumed };
  }
  const queued = await database(access).from("affaire_intake_uploads").update({ status: "queued", last_error: null })
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", uploadId);
  if (queued.error) {
    // The lot stays "being recorded": opening the Drive panel again later arms it.
    const message = "Lien enregistré, analyse non lancée. Rouvrez Google Drive dans quelques minutes pour la relancer.";
    const fresh = new Set(candidates.map(({ file }) => file.id));
    return { results: results.map((result) => result.status === "linked" && fresh.has(result.fileId) ? { ...result, message } : result), uploadId: null, resumed };
  }
  return { results, uploadId, resumed };
}

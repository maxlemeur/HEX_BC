import "server-only";
import { ApiError, badRequest, mapSupabaseError, notFound } from "@/lib/http/api-response";
import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { readLinkedDriveFile } from "./content";
import { driveFilePreviewMime, driveFileReadRejection, driveFileRejection, isDrivePdfExport, type DriveRequest, type DriveState, type DriveVersionStatus } from "./contracts";
import { disconnectDriveConnection, driveAccessToken, forgetDriveAccess, listDriveConnections, requireOwnDriveConnection } from "./connections";
import { DriveError } from "./errors";
import { GoogleDriveReader } from "./provider";
import { driveConfiguration, type DriveConfiguration } from "./secrets";
import { DriveStoreError, linkDriveFiles, readDriveFolderLink, readDriveLinks, removeDriveFolderLink, resumeStaleDriveLots, saveDriveFolderLink } from "./store";

export function toDriveApiError(error: unknown) {
  if (error instanceof DriveError) return new ApiError({ status: error.status, code: error.code, message: error.message });
  if (error instanceof DriveStoreError) return new ApiError({ status: error.status, code: error.status === 409 ? "CONFLICT" : "INTERNAL_ERROR", message: error.message });
  return error;
}
async function guarded<T>(work: () => Promise<T>) {
  try { return await work(); } catch (error) { throw toDriveApiError(error); }
}
const member = (access: AffaireAccess) => access.context;

export async function driveState(projectId: string): Promise<DriveState> {
  const access = await requireAffaireAccess(projectId, "write");
  const enabled = driveConfiguration().enabled;
  // A lot an interrupted link request left unarmed is resumed here: its files show as already linked.
  // This read therefore writes, and must not be cached.
  if (enabled) await resumeStaleDriveLots(access);
  return guarded(async () => ({
    enabled, projectName: access.project.name,
    connections: enabled ? await listDriveConnections(member(access)) : [],
    folder: await readDriveFolderLink(access),
    links: await readDriveLinks(access),
  }));
}

async function checkDriveVersion(
  { context, project }: AffaireAccess,
  documentId: string,
  signal: AbortSignal,
): Promise<{ versionStatus: DriveVersionStatus }> {
  const { data: document, error } = await context.supabase.from("affaire_intake_documents")
    .select("tenant_id,mime_type,drive_connection_id,drive_file_id,drive_revision")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", documentId)
    .eq("source_provider", "google_drive").eq("upload_status", "uploaded")
    .is("deleted_at", null).is("deletion_token", null).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la pièce liée à Google Drive.");
  if (!document?.drive_file_id) throw notFound("Pièce Google Drive introuvable dans cette affaire.");

  const { version } = await readLinkedDriveFile(document, signal);
  if (!version || !document.drive_revision || !/^\d+$/.test(document.drive_revision)) {
    return { versionStatus: "unknown" };
  }

  // Google sends an int64 as a string. Converting to Number can mask a change.
  const current = BigInt(version);
  const recorded = BigInt(document.drive_revision);
  if (current === recorded) return { versionStatus: "unchanged" };
  return { versionStatus: current > recorded ? "newer" : "unknown" };
}

function requireDriveConfiguration() {
  const configuration = driveConfiguration();
  if (!configuration.enabled) throw new ApiError({ status: 503, code: "DRIVE_DISABLED",
    message: "Google Drive attend la validation et la configuration OAuth de ce POC." });
  return configuration;
}

async function ownDriveReader(
  context: AffaireAccess["context"],
  configuration: Extract<DriveConfiguration, { enabled: true }>,
  connectionId: string,
  signal: AbortSignal,
) {
  const connection = await requireOwnDriveConnection(context, connectionId);
  const token = await driveAccessToken(configuration, connection.id,
    { tenantId: context.tenantId, userId: context.userId }, signal);
  return new GoogleDriveReader(token, signal, () => forgetDriveAccess(connection.id));
}

export async function readOwnDriveFile(projectId: string, connectionId: string, fileId: string, signal: AbortSignal) {
  const { context } = await requireAffaireAccess(projectId, "write");
  const configuration = requireDriveConfiguration();
  return guarded(async () => {
    const reader = await ownDriveReader(context, configuration, connectionId, signal);
    const file = await reader.file(fileId);
    const rejection = driveFileReadRejection(file);
    if (rejection) throw new DriveError(422, "DRIVE_UNSUPPORTED", rejection);
    const exportPdf = isDrivePdfExport(file);
    return {
      bytes: exportPdf ? await reader.exportPdf(file) : await reader.download(file),
      fileName: exportPdf && !/\.pdf$/i.test(file.name) ? `${file.name}.pdf` : file.name,
      mimeType: driveFilePreviewMime(file) ?? "application/octet-stream",
    };
  });
}

export async function executeDriveRequest(projectId: string, request: DriveRequest, signal: AbortSignal) {
  // Membership, active tenant and affaire ownership are resolved again on every operation,
  // before any Google token is used. The browser never holds one.
  const access = await requireAffaireAccess(projectId, "write");
  const configuration = requireDriveConfiguration();
  return guarded(async () => {
    if (request.action === "check_version") return checkDriveVersion(access, request.documentId, signal);
    if (request.action === "unlink_folder") {
      await removeDriveFolderLink(access);
      return { folder: null };
    }
    if (request.action === "disconnect") return disconnectDriveConnection(member(access), request.connectionId,request.grantVersion);
    const reader = await ownDriveReader(access.context, configuration, request.connectionId, signal);
    if (request.action === "list") return { listing: await reader.list(request.location, request.pageToken) };
    if (request.action === "link_folder") return { folder: await saveDriveFolderLink(access, request.connectionId, await reader.folder(request.folderId)) };
    if (new Set(request.files.map((file) => file.id)).size !== request.files.length) throw badRequest("Une pièce ne peut être sélectionnée qu'une fois.");
    // A folder that became unavailable fails only its own pieces; the others are still linked.
    const folders = new Map(await Promise.all([...new Set(request.files.flatMap((file) => file.folderId ? [file.folderId] : []))]
      .map(async (id) => [id, await reader.folder(id).catch((error: unknown) => ({ error }))] as const)));
    // Only metadata is read here: the content stays in Drive and the classifier reads it later.
    const lookups = await Promise.all(request.files.map(async (selection) => {
      try {
        const folder = selection.folderId ? folders.get(selection.folderId) : undefined;
        if (folder && "error" in folder) throw folder.error;
        const file = await reader.file(selection.id);
        const rejection = driveFileRejection(file)
          ?? (folder && !file.parents?.includes(folder.id) ? "Ce fichier n'est plus dans le dossier choisi. Actualisez le dossier." : null);
        return rejection ? { ok: false as const, id: selection.id, name: file.name, message: rejection }
          : { ok: true as const, id: selection.id, file, folder: folder ? { id: folder.id, name: folder.name } : undefined };
      } catch (error) {
        const failure = toDriveApiError(error);
        return { ok: false as const, id: selection.id, name: selection.id, message: failure instanceof ApiError ? failure.message : "Fichier Drive illisible." };
      }
    }));
    signal.throwIfAborted();
    const files = lookups.flatMap((lookup) => lookup.ok ? [{ file: lookup.file, folder: lookup.folder }] : []);
    const linked = files.length ? await linkDriveFiles(access, { connectionId: request.connectionId, files }) : { results: [], uploadId: null, resumed: [] };
    const rejected = lookups.flatMap((lookup) => !lookup.ok
      ? [{ fileId: lookup.id, name: lookup.name, status: "failed" as const, message: lookup.message }] : []);
    return { results: [...linked.results, ...rejected], uploads: [...(linked.uploadId ? [linked.uploadId] : []), ...linked.resumed] };
  });
}

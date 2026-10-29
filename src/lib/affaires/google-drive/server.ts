import "server-only";
import { ApiError, badRequest } from "@/lib/estimates/errors";
import { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { driveFileRejection, type DriveRequest, type DriveState } from "./contracts";
import { disconnectDriveConnection, driveAccessToken, forgetDriveAccess, listDriveConnections, requireOwnDriveConnection } from "./connections";
import { DriveError } from "./errors";
import { GoogleDriveReader } from "./provider";
import { driveConfiguration } from "./secrets";
import { DriveStoreError, linkDriveFiles, readDriveFolderLink, readDriveLinks, removeDriveFolderLink, resumeStaleDriveLots, saveDriveFolderLink } from "./store";

export function toDriveApiError(error: unknown) {
  if (error instanceof DriveError) return new ApiError({ status: error.status, code: error.code, message: error.message });
  if (error instanceof DriveStoreError) return new ApiError({ status: error.status, code: error.status === 409 ? "CONFLICT" : "INTERNAL_ERROR", message: error.message });
  return error;
}
async function guarded<T>(work: () => Promise<T>) {
  try { return await work(); } catch (error) { throw toDriveApiError(error); }
}
const member = (access: Awaited<ReturnType<typeof requireAffaireProjectOwnerOrAdmin>>) => access.context;

export async function driveState(projectId: string): Promise<DriveState> {
  const access = await requireAffaireProjectOwnerOrAdmin(projectId);
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

export async function executeDriveRequest(projectId: string, request: DriveRequest, signal: AbortSignal) {
  // Membership, active tenant and affaire ownership are resolved again on every operation,
  // before any Google token is used. The browser never holds one.
  const access = await requireAffaireProjectOwnerOrAdmin(projectId);
  const configuration = driveConfiguration();
  if (!configuration.enabled) throw new ApiError({ status: 503, code: "DRIVE_DISABLED",
    message: "Google Drive attend la validation et la configuration OAuth de ce POC." });
  return guarded(async () => {
    if (request.action === "unlink_folder") {
      await removeDriveFolderLink(access);
      return { folder: null };
    }
    if (request.action === "disconnect") return disconnectDriveConnection(member(access), request.connectionId,request.grantVersion);
    const connection = await requireOwnDriveConnection(member(access), request.connectionId);
    const reader = new GoogleDriveReader(await driveAccessToken(configuration, connection.id,
      { tenantId: access.context.tenantId, userId: access.context.userId }, signal), signal, () => forgetDriveAccess(connection.id));
    if (request.action === "list") return { listing: await reader.list(request.location, request.pageToken) };
    if (request.action === "link_folder") return { folder: await saveDriveFolderLink(access, connection.id, await reader.folder(request.folderId)) };
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
    const linked = files.length ? await linkDriveFiles(access, { connectionId: connection.id, files }) : { results: [], uploadId: null, resumed: [] };
    const rejected = lookups.flatMap((lookup) => !lookup.ok
      ? [{ fileId: lookup.id, name: lookup.name, status: "failed" as const, message: lookup.message }] : []);
    return { results: [...linked.results, ...rejected], uploads: [...(linked.uploadId ? [linked.uploadId] : []), ...linked.resumed] };
  });
}

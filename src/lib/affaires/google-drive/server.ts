import "server-only";
import { ApiError, badRequest, conflict, internalError } from "@/lib/estimates/errors";
import { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { DRIVE_MAX_BATCH_BYTES, driveFileRejection, type DriveImportResult, type DriveRequest } from "./contracts";
import { GoogleDriveReader } from "./provider";
import { DriveStoreError, driveBatchUploadId, persistDriveCopy, readDriveHistory, requeueDriveUpload, resumeDriveCopy } from "./store";

function toApiError(error: unknown) {
  if (!(error instanceof DriveStoreError)) return error;
  return error.status === 409 ? conflict(error.message) : internalError(error.message);
}
function failureMessage(error: unknown) {
  const failure = toApiError(error);
  return failure instanceof ApiError ? failure.message : "Import interrompu. Reprenez cette pièce après reconnexion.";
}
export function driveConfiguration() {
  const clientId = process.env.MERGEONE_GOOGLE_DRIVE_CLIENT_ID?.trim();
  const enabled = process.env.MERGEONE_GOOGLE_DRIVE_ENABLED === "true" && Boolean(clientId);
  return { enabled, clientId: enabled ? clientId : undefined };
}
export async function driveState(projectId: string) {
  const access = await requireAffaireProjectOwnerOrAdmin(projectId);
  return { ...driveConfiguration(), projectName: access.project.name, tenantId: access.context.tenantId,
    history: await readDriveHistory(access).catch((error: unknown) => { throw toApiError(error); }) };
}
export async function executeDriveRequest(projectId: string, request: DriveRequest, signal: AbortSignal) {
  // Re-resolve membership, active tenant and project ownership on EVERY operation,
  // before passing a token to Google. No service-role client is used here.
  let access = await requireAffaireProjectOwnerOrAdmin(projectId);
  if (!driveConfiguration().enabled) throw new ApiError({ status: 503, code: "DRIVE_DISABLED",
    message: "Google Drive attend la validation et la configuration OAuth de ce POC." });
  const reader = new GoogleDriveReader(request.token, signal);
  if (request.action === "list") return { listing: await reader.list(request.folderId, request.pageToken), results: [], uploads: [] };
  if (new Set(request.files.map((file) => file.id)).size !== request.files.length) throw badRequest("Une pièce ne peut être sélectionnée qu'une fois.");
  // An unavailable folder fails only its own pieces; the other folders of the lot still copy.
  type FolderLookup = { folder: Awaited<ReturnType<GoogleDriveReader["folder"]>> } | { error: unknown };
  const folders = new Map<string, FolderLookup>(await Promise.all([...new Set(request.files.map((file) => file.folderId ?? request.folderId))]
    .map(async (id) => {
      try { return [id, { folder: await reader.folder(id) }] as const; }
      catch (error) { return [id, { error }] as const; }
    })));
  // Validate the cumulative size BEFORE downloading any selected content.
  const metadata = await Promise.all(request.files.map(async (selection) => {
    try { return { selection, file: await reader.file(selection.id) }; }
    catch (error) { return { selection, error }; }
  }));
  // Lookups no longer reject the lot, so cancellation keeps the provider's interrupted-connection error.
  if (signal.aborted) throw badRequest("Connexion Drive interrompue. Reconnectez-vous puis reprenez les échecs.", undefined, "DRIVE_NETWORK");
  if (metadata.reduce((sum, item) => sum + (item.file ? Number(item.file.size ?? 0) : 0), 0) > DRIVE_MAX_BATCH_BYTES) {
    throw badRequest("Le lot sélectionné dépasse 100 Mo. Réduisez la sélection.");
  }
  // One confirmed selection is one intake upload, armed once after its last copy so the
  // classifier regenerates the brief and missing pieces from the whole lot.
  const batchUploadId = driveBatchUploadId(access.context.tenantId, projectId, request.files);
  const results: DriveImportResult[] = [];
  const pending = new Set<string>();
  for (const item of metadata) {
    const name = item.file ? item.file.name : item.selection.id;
    try {
      signal.throwIfAborted();
      if ("error" in item) throw item.error;
      const { file, selection } = item;
      const lookup = folders.get(selection.folderId ?? request.folderId)!;
      if ("error" in lookup) throw lookup.error;
      const { folder } = lookup;
      const rejection = driveFileRejection(file);
      if (rejection) throw badRequest(rejection);
      if (file.version !== selection.version) throw badRequest("Pièce modifiée depuis la sélection. Actualisez le dossier.");
      if (!file.parents?.includes(folder.id)) throw badRequest("Pièce extérieure au dossier choisi.");
      // Reauthorize before each copy; a changed active tenant cannot reuse the connection.
      const currentAccess = await requireAffaireProjectOwnerOrAdmin(projectId);
      if (currentAccess.context.tenantId !== access.context.tenantId || currentAccess.context.userId !== access.context.userId) {
        throw badRequest("Le contexte de l'affaire a changé. Reconnectez Drive.");
      }
      access = currentAccess;
      const history = await readDriveHistory(access);
      const prior = history.filter((entry) => entry.source.fileId === file.id);
      const same = prior.find((entry) => entry.source.revision === file.version);
      if (same) {
        // Report the replay only once the copy is verified; a failure stays the piece's sole result.
        if (await resumeDriveCopy(access, same)) pending.add(same.uploadId);
        results.push({ fileId: file.id, name, status: "already_imported", message: "Cette révision est déjà importée.",
          documentId: same.documentId, uploadId: same.uploadId });
        continue;
      }
      if (prior.length && !selection.newVersion) throw badRequest("Cette pièce existe déjà. Confirmez l'import d'une nouvelle version.");
      const content = await reader.download(file, folder.id);
      signal.throwIfAborted();
      const copy = await persistDriveCopy(access, content.file, {
        provider: "google_drive", folderId: folder.id, folderName: folder.name, fileId: file.id, revision: file.version!,
        sourceName: file.name, sourceMimeType: file.mimeType, sourceModifiedTime: file.modifiedTime ?? null,
        sourceUrl: `https://drive.google.com/file/d/${file.id}/view`, sha256: content.sha256,
        importedAt: new Date().toISOString(), importedBy: access.context.userId,
        tenantId: access.context.tenantId, projectId,
      }, batchUploadId);
      results.push({ fileId: file.id, name, status: copy.status,
        message: copy.status === "imported" ? "Copie importée. Classement en cours." : "Cette révision est déjà importée.",
        documentId: copy.documentId, uploadId: copy.uploadId });
      if (copy.shouldProcess) pending.add(copy.uploadId);
    } catch (error) {
      results.push({ fileId: item.selection.id, name, status: "failed", message: failureMessage(error) });
    }
  }
  const uploads: string[] = [];
  for (const uploadId of pending) {
    try {
      await requeueDriveUpload(access, uploadId);
      uploads.push(uploadId);
    } catch (error) {
      // Copies stay stored; every piece of this upload reports the interrupted classification once.
      const message = failureMessage(error);
      results.forEach((result, index) => {
        if (result.uploadId === uploadId && result.status !== "failed") {
          results[index] = { fileId: result.fileId, name: result.name, status: "failed", message };
        }
      });
    }
  }
  return { results, uploads };
}

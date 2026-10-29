import "server-only";
import { driveAccessToken, forgetDriveAccess } from "./connections";
import { driveFileRejection } from "./contracts";
import { DriveError } from "./errors";
import { GoogleDriveReader } from "./provider";
import { driveConfiguration } from "./secrets";

type LinkedDriveDocument = { tenant_id: string; drive_connection_id: string | null; drive_file_id: string | null };

async function linkedDriveReader(document: LinkedDriveDocument) {
  const configuration = driveConfiguration();
  if (!configuration.enabled) throw new DriveError(503, "DRIVE_DISABLED", "Google Drive est désactivé : le fichier lié n'a pas pu être lu.");
  if (!document.drive_file_id) throw new DriveError(422, "DRIVE_NOT_LINKED", "Ce document n'est pas lié à Google Drive.");
  const connectionId = document.drive_connection_id;
  if (!connectionId) {
    throw new DriveError(422, "DRIVE_CONNECTION_REMOVED", "Le compte Google qui a lié ce fichier a été retiré. Sélectionnez de nouveau le fichier dans Google Drive.");
  }
  const signal = AbortSignal.timeout(120_000);
  const reader = new GoogleDriveReader(await driveAccessToken(configuration, connectionId,
    { tenantId: document.tenant_id }, signal), signal, () => forgetDriveAccess(connectionId));
  return { reader, fileId: document.drive_file_id };
}

/** Current Drive metadata of a linked piece, refused when it can no longer be read as a dossier file. */
export async function readLinkedDriveFile(document: LinkedDriveDocument) {
  const { reader, fileId } = await linkedDriveReader(document);
  const file = await reader.file(fileId);
  const rejection = driveFileRejection(file);
  if (rejection) throw new DriveError(422, "DRIVE_UNSUPPORTED", rejection);
  return file;
}

/**
 * Reads a linked Drive piece with the Google account of the member who linked it.
 * Nothing is stored: the bytes only live for the duration of the analysis or the import.
 */
export async function readLinkedDriveDocument(document: LinkedDriveDocument) {
  const { reader, fileId } = await linkedDriveReader(document);
  const file = await reader.file(fileId);
  const bytes = await reader.download(file);
  return { bytes, file };
}

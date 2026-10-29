import "server-only";
import { driveAccessToken, forgetDriveAccess } from "./connections";
import { DriveError } from "./errors";
import { GoogleDriveReader } from "./provider";
import { driveConfiguration } from "./secrets";

/**
 * Reads a linked Drive piece for the intake worker, with the Google account of the member
 * who linked it. Nothing is stored: the bytes only live for the duration of the analysis.
 */
export async function readLinkedDriveDocument(document: { tenant_id: string; drive_connection_id: string | null; drive_file_id: string | null }) {
  const configuration = driveConfiguration();
  if (!configuration.enabled) throw new DriveError(503, "DRIVE_DISABLED", "Google Drive est désactivé : le fichier lié n'a pas pu être lu.");
  if (!document.drive_file_id) throw new DriveError(422, "DRIVE_NOT_LINKED", "Ce document n'est pas lié à Google Drive.");
  if (!document.drive_connection_id) {
    throw new DriveError(422, "DRIVE_CONNECTION_REMOVED", "Le compte Google qui a lié ce fichier a été retiré. Sélectionnez de nouveau le fichier dans Google Drive.");
  }
  const signal = AbortSignal.timeout(120_000);
  const reader = new GoogleDriveReader(await driveAccessToken(configuration, document.drive_connection_id,
    { tenantId: document.tenant_id }, signal), signal, () => forgetDriveAccess(document.drive_connection_id!));
  const file = await reader.file(document.drive_file_id);
  const bytes = await reader.download(file);
  return { bytes, file };
}

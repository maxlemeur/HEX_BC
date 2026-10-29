import "server-only";
import { driveAccessToken, forgetDriveAccess } from "./connections";
import { driveFileRejection } from "./contracts";
import { DriveError } from "./errors";
import { GoogleDriveReader } from "./provider";
import { driveConfiguration } from "./secrets";

type LinkedDriveDocument = { tenant_id: string; mime_type: string | null; drive_connection_id: string | null; drive_file_id: string | null };

const CONNECTION_REMOVED = "Le compte Google qui a lié ce fichier a été retiré. Sélectionnez de nouveau le fichier dans Google Drive.";

/**
 * The reader of a linked piece is often not the member who linked it: account errors
 * name that member's account instead of asking the reader to reconnect their own.
 */
async function readWithLinkerAccount<T>(document: LinkedDriveDocument, read: (reader: GoogleDriveReader, fileId: string) => Promise<T>) {
  const configuration = driveConfiguration();
  if (!configuration.enabled) throw new DriveError(503, "DRIVE_DISABLED", "Google Drive est désactivé : le fichier lié n'a pas pu être lu.");
  if (!document.drive_file_id) throw new DriveError(422, "DRIVE_NOT_LINKED", "Ce document n'est pas lié à Google Drive.");
  const connectionId = document.drive_connection_id;
  if (!connectionId) throw new DriveError(422, "DRIVE_CONNECTION_REMOVED", CONNECTION_REMOVED);
  try {
    const signal = AbortSignal.timeout(120_000);
    const reader = new GoogleDriveReader(await driveAccessToken(configuration, connectionId,
      { tenantId: document.tenant_id }, signal), signal, () => forgetDriveAccess(connectionId));
    return await read(reader, document.drive_file_id);
  } catch (error) {
    if (!(error instanceof DriveError)) throw error;
    if (error.code === "DRIVE_CONNECTION_NOT_FOUND") throw new DriveError(422, "DRIVE_CONNECTION_REMOVED", CONNECTION_REMOVED);
    if (error.status === 401) {
      throw new DriveError(409, error.code, "L'accès Google du compte qui a lié ce fichier a expiré : son membre doit reconnecter ce compte dans le panneau Google Drive.");
    }
    throw error;
  }
}

async function currentFile(reader: GoogleDriveReader, fileId: string, document: LinkedDriveDocument) {
  const file = await reader.file(fileId);
  const rejection = driveFileRejection(file);
  if (rejection) throw new DriveError(422, "DRIVE_UNSUPPORTED", rejection);
  // The dossier classified, and parses, the format recorded when the file was linked.
  if (document.mime_type && file.mimeType !== document.mime_type) {
    throw new DriveError(409, "DRIVE_FORMAT_CHANGED", "Le format du fichier a changé dans Drive depuis son lien. Retirez le lien puis liez de nouveau le fichier.");
  }
  return file;
}

/** Current Drive metadata of a linked piece, refused when it can no longer be read as this dossier file. */
export async function readLinkedDriveFile(document: LinkedDriveDocument) {
  return readWithLinkerAccount(document, (reader, fileId) => currentFile(reader, fileId, document));
}

/**
 * Reads a linked Drive piece with the Google account of the member who linked it.
 * The dossier keeps no copy; an import made from it stores its own source file, as for any import.
 */
export async function readLinkedDriveDocument(document: LinkedDriveDocument) {
  return readWithLinkerAccount(document, async (reader, fileId) => {
    const file = await currentFile(reader, fileId, document);
    return { bytes: await reader.download(file), file };
  });
}

import { z } from "zod";
import { AFFAIRE_INTAKE_ALLOWED_EXTENSIONS, AFFAIRE_INTAKE_ALLOWED_MIME_TYPES } from "@/lib/affaires/intake";

export const DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_MAX_FILES = 20;
export const DRIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DRIVE_MAX_BATCH_BYTES = 100 * 1024 * 1024;
export const driveIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
export const driveFileSchema = z.object({
  id: driveIdSchema,
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  version: z.string().regex(/^\d+$/).optional(),
  size: z.string().regex(/^\d+$/).optional(),
  modifiedTime: z.string().optional(),
  parents: z.array(driveIdSchema).optional(),
  driveId: z.string().optional(),
  trashed: z.boolean().optional(),
  capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
  md5Checksum: z.string().optional(),
});
export type DriveFile = z.infer<typeof driveFileSchema>;
export const driveSelectionSchema = z.object({
  id: driveIdSchema,
  version: z.string().regex(/^\d+$/),
  newVersion: z.boolean().default(false),
}).strict();
export const driveRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), token: z.string().min(1).max(4096), folderId: driveIdSchema,
    pageToken: z.string().max(2048).optional() }).strict(),
  z.object({ action: z.literal("import"), token: z.string().min(1).max(4096), folderId: driveIdSchema,
    files: z.array(driveSelectionSchema).min(1).max(DRIVE_MAX_FILES) }).strict(),
]);
export type DriveSelection = z.infer<typeof driveSelectionSchema>;
export type DriveRequest = z.infer<typeof driveRequestSchema>;
export const driveProvenanceSchema = z.object({
  provider: z.literal("google_drive"), folderId: driveIdSchema, fileId: driveIdSchema,
  sourceName: z.string().min(1).max(255), sourceMimeType: z.string().min(1).max(255),
  revision: z.string().regex(/^\d+$/), sourceModifiedTime: z.string().nullable(),
  sourceUrl: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string().datetime(), importedBy: z.string(), tenantId: z.string(), projectId: z.string(),
});
export type DriveProvenance = z.infer<typeof driveProvenanceSchema>;
export type DriveImportResult = {
  fileId: string;
  name: string;
  status: "imported" | "already_imported" | "failed";
  message: string;
  uploadId?: string;
  documentId?: string;
};
export type DriveHistory = { documentId: string; uploadId: string; source: DriveProvenance };
export type DriveListing = {
  folder: DriveFile;
  files: DriveFile[];
  nextPageToken?: string;
  account: { displayName: string; emailAddress: string };
};

export function driveFileRejection(file: DriveFile): string | null {
  if (file.trashed) return "Fichier supprimé de Drive.";
  if (file.driveId) return "Drives partagés non pris en charge dans ce POC.";
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    return "Google Docs, Sheets, Slides, dossiers et raccourcis ne sont pas importables dans ce POC.";
  }
  if (file.capabilities?.canDownload === false) return "Téléchargement interdit par le propriétaire.";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(AFFAIRE_INTAKE_ALLOWED_EXTENSIONS as readonly string[]).includes(extension) ||
    !(AFFAIRE_INTAKE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    return "Format non pris en charge.";
  }
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0) return "Fichier vide ou taille inconnue.";
  if (size > DRIVE_MAX_FILE_BYTES) return "Le fichier dépasse 50 Mo.";
  if (!file.version) return "Révision source indisponible.";
  return null;
}

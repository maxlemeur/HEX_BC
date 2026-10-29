import { z } from "zod";
import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_ALLOWED_MIME_TYPES,
} from "@/lib/affaires/intake";

export const DRIVE_READ_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const drivePurposeSchema = z.enum(["read", "write"]);
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export const DRIVE_MAX_FILES = 20;
export const DRIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DRIVE_OAUTH_START_PATH = "/api/google-drive/oauth/start";
export const driveIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
export const driveFileSchema = z.object({
  id: driveIdSchema,
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  version: z.string().regex(/^\d+$/).optional(),
  size: z.string().regex(/^\d+$/).optional(),
  modifiedTime: z.string().optional(),
  parents: z.array(driveIdSchema).optional(),
  driveId: driveIdSchema.optional(),
  trashed: z.boolean().optional(),
  capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
  md5Checksum: z.string().optional(),
  shortcutDetails: z
    .object({
      targetId: driveIdSchema,
      targetMimeType: z.string().max(255).optional(),
    })
    .optional(),
});
export type DriveFile = z.infer<typeof driveFileSchema>;
// "root" is My Drive; a shared drive is browsed from its root folder, whose id is the drive id.
export const driveLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), folderId: driveIdSchema }).strict(),
  z.object({ kind: z.literal("shared_with_me") }).strict(),
  z.object({ kind: z.literal("shared_drives") }).strict(),
]);
export type DriveLocation = z.infer<typeof driveLocationSchema>;
const connectionIdSchema = z.string().uuid();
export const driveRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list"),
      connectionId: connectionIdSchema,
      location: driveLocationSchema,
      pageToken: z.string().max(2048).optional(),
    })
    .strict(),
  // Each file names the folder it was chosen in, if any, so its link keeps that folder.
  z
    .object({
      action: z.literal("link_files"),
      connectionId: connectionIdSchema,
      files: z
        .array(
          z
            .object({ id: driveIdSchema, folderId: driveIdSchema.optional() })
            .strict(),
        )
        .min(1)
        .max(DRIVE_MAX_FILES),
    })
    .strict(),
  z
    .object({
      action: z.literal("link_folder"),
      connectionId: connectionIdSchema,
      folderId: driveIdSchema,
    })
    .strict(),
  z.object({ action: z.literal("unlink_folder") }).strict(),
  z
    .object({
      action: z.literal("disconnect"),
      connectionId: connectionIdSchema,
      grantVersion: z.string().uuid(),
    })
    .strict(),
]);
export type DriveRequest = z.infer<typeof driveRequestSchema>;

export const driveConnectionSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(["active", "reconnect_required"]),
  writeEnabled: z.boolean(),
  grantVersion: z.string().uuid(),
  connectedAt: z.string(),
});
export type DriveConnection = z.infer<typeof driveConnectionSchema>;
export const driveConnectionStateSchema = z.object({
  enabled: z.boolean(),
  writingAvailable: z.boolean(),
  connection: driveConnectionSchema.nullable(),
});
const ownConnection = {
  connectionId: connectionIdSchema,
  grantVersion: z.string().uuid(),
};
export const driveConnectionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disconnect"), ...ownConnection }).strict(),
  z.object({ action: z.literal("disable_write"), ...ownConnection }).strict(),
  z.object({ action: z.literal("picker"), ...ownConnection }).strict(),
  z
    .object({
      action: z.literal("comment"),
      ...ownConnection,
      fileId: driveIdSchema,
      content: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("rename"),
      ...ownConnection,
      fileId: driveIdSchema,
      name: z.string().trim().min(1).max(255),
    })
    .strict(),
]);
export type DriveConnectionRequest = z.infer<
  typeof driveConnectionRequestSchema
>;
export type DriveFolderLink = {
  folderId: string;
  folderName: string;
  sharedDriveId: string | null;
  connectionId: string | null;
  linkedAt: string;
  url: string;
};
/** A Drive piece of the affaire: MergeOne keeps the link, the file stays in Drive. */
export type DriveProvenance = {
  provider: "google_drive";
  fileId: string;
  sourceName: string;
  sourceUrl: string;
  folderId: string | null;
  folderName: string | null;
  revision: string | null;
  linkedAt: string;
  connectionAvailable: boolean;
};
export type DriveLinkedFile = {
  documentId: string;
  uploadId: string;
  source: DriveProvenance;
};
export type DriveListing = {
  location: DriveLocation;
  folder?: DriveFile;
  files: DriveFile[];
  nextPageToken?: string;
};
export type DriveLinkResult = {
  fileId: string;
  name: string;
  status: "linked" | "already_linked" | "failed";
  message: string;
  documentId?: string;
};
export type DriveState = {
  enabled: boolean;
  projectName: string;
  connections: DriveConnection[];
  folder: DriveFolderLink | null;
  links: DriveLinkedFile[];
};

export const DRIVE_OAUTH_OUTCOMES = {
  connected:
    "Compte Google ajouté. Il reste enregistré pour vos prochaines visites.",
  refused: "Connexion Google annulée. Aucun compte ajouté.",
  scope:
    "La lecture de Google Drive n'a pas été accordée. Recommencez en autorisant l'accès à Drive.",
  offline:
    "Google n'a pas accordé d'accès durable. Réessayez ou contactez votre administrateur. Ne retirez pas MergeOne de votre compte Google.",
  expired:
    "La connexion a expiré ou a été ouverte depuis une autre session. Recommencez.",
  disabled: "Google Drive n'est pas activé sur cet environnement.",
  failed: "Le compte Google n'a pas pu être ajouté. Réessayez.",
  account:
    "Utilisez le compte Google déjà enregistré, ou retirez-le pour en changer. Si vous avez autorisé un autre compte chez Google, vérifiez ses autorisations dans votre compte Google.",
  writing:
    "Écriture activée pour les fichiers choisis. La lecture du Drive reste disponible.",
  picker_unavailable:
    "L’écriture attend la configuration du sélecteur Google sur cet environnement.",
} as const;
export type DriveOAuthOutcome = keyof typeof DRIVE_OAUTH_OUTCOMES;

export const driveFileUrl = (fileId: string) =>
  `https://drive.google.com/file/d/${fileId}/view`;
export const driveFolderUrl = (folderId: string) =>
  `https://drive.google.com/drive/folders/${folderId}`;

export function driveFileRejection(file: DriveFile): string | null {
  if (file.trashed) return "Fichier supprimé de Drive.";
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    return "Google Docs, Sheets, Slides et raccourcis vers un fichier ne peuvent pas encore être liés.";
  }
  if (file.capabilities?.canDownload === false)
    return "Lecture interdite par le propriétaire.";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    !(AFFAIRE_INTAKE_ALLOWED_EXTENSIONS as readonly string[]).includes(
      extension,
    ) ||
    !(AFFAIRE_INTAKE_ALLOWED_MIME_TYPES as readonly string[]).includes(
      file.mimeType,
    )
  ) {
    return "Format non pris en charge.";
  }
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0)
    return "Fichier vide ou taille inconnue.";
  if (size > DRIVE_MAX_FILE_BYTES) return "Le fichier dépasse 50 Mo.";
  if (!file.version) return "Révision source indisponible.";
  return null;
}

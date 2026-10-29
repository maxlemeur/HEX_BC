import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DriveError } from "./errors";
import { DRIVE_FOLDER_MIME, DRIVE_MAX_FILE_BYTES, driveFileRejection, driveFileSchema, type DriveFile, type DriveListing, type DriveLocation } from "./contracts";

const FIELDS = "id,name,mimeType,version,size,modifiedTime,parents,driveId,trashed,capabilities(canDownload),md5Checksum,shortcutDetails(targetId,targetMimeType)";
// Shared drives are part of the read-only scope; every files call opts in explicitly.
const ALL_DRIVES = { supportsAllDrives: "true" };
export class GoogleDriveReader {
  private readonly signal: AbortSignal;
  /** onUnauthorized lets the caller drop an access token that Google no longer accepts. */
  constructor(private readonly token: string, signal: AbortSignal, private readonly onUnauthorized?: () => void) {
    this.signal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  }
  private async get(path: string, parameters: Record<string, string> = {}) {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` },
        cache: "no-store", redirect: "error", signal: this.signal });
    } catch {
      throw new DriveError(422, "DRIVE_NETWORK", "Connexion Drive interrompue. Réessayez dans un instant.");
    }
    if (!response.ok) {
      const [code, message] = response.status === 401 ? ["DRIVE_EXPIRED", "Accès Google expiré ou révoqué. Reconnectez ce compte."]
        : response.status === 403 ? ["DRIVE_FORBIDDEN", "Droit Drive insuffisant ou quota Google atteint. Vérifiez les droits et réessayez plus tard."]
        : response.status === 404 ? ["DRIVE_NOT_FOUND", "Pièce ou dossier Drive introuvable ou inaccessible avec ce compte."]
        : response.status === 429 ? ["DRIVE_QUOTA", "Quota Google atteint. Réessayez plus tard."]
        : ["DRIVE_UNAVAILABLE", "Google Drive est indisponible. Réessayez plus tard."];
      await response.body?.cancel();
      if (response.status === 401) this.onUnauthorized?.();
      throw new DriveError(response.status === 401 ? 401 : 422, code, message);
    }
    return response;
  }
  async account() {
    const about = z.object({ user: z.object({ permissionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
      displayName: z.string().min(1).max(255), emailAddress: z.string().min(3).max(320) }) })
      .parse(await (await this.get("about", { fields: "user(permissionId,displayName,emailAddress)" })).json());
    return about.user;
  }
  async file(id: string) {
    return driveFileSchema.parse(await (await this.get(`files/${encodeURIComponent(id)}`, { fields: FIELDS, ...ALL_DRIVES })).json());
  }
  async folder(id: string) {
    const folder = await this.file(id);
    if (folder.mimeType !== DRIVE_FOLDER_MIME || folder.trashed) {
      throw new DriveError(422, "DRIVE_NOT_FOLDER", "Choisissez un dossier Google Drive accessible.");
    }
    return folder;
  }
  async list(location: DriveLocation, pageToken?: string): Promise<DriveListing> {
    const page: Record<string, string> = pageToken ? { pageToken } : {};
    if (location.kind === "shared_drives") {
      const drives = z.object({ drives: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), name: z.string().min(1).max(255) })).default([]),
        nextPageToken: z.string().optional() }).parse(await (await this.get("drives", { pageSize: "100",
        fields: "nextPageToken,drives(id,name)", ...page })).json());
      return { location, nextPageToken: drives.nextPageToken,
        files: drives.drives.map((drive) => ({ id: drive.id, name: drive.name, mimeType: DRIVE_FOLDER_MIME, driveId: drive.id })) };
    }
    const folder = location.kind === "folder" ? await this.folder(location.folderId) : undefined;
    const query = folder ? `'${folder.id}' in parents and trashed = false` : "sharedWithMe = true and trashed = false";
    const scope: Record<string, string> = folder?.driveId ? { corpora: "drive", driveId: folder.driveId } : {};
    const response = await this.get("files", { q: query, fields: `nextPageToken,files(${FIELDS})`, pageSize: "100",
      orderBy: "folder,name", includeItemsFromAllDrives: "true", ...ALL_DRIVES, ...scope, ...page });
    const listing = z.object({ files: z.array(driveFileSchema), nextPageToken: z.string().optional() }).parse(await response.json());
    return { location, folder, ...listing };
  }
  /** Reads a linked file's current content, bounded, and checks it did not change meanwhile. */
  async download(file: DriveFile) {
    const rejection = driveFileRejection(file);
    if (rejection) throw new DriveError(422, "DRIVE_UNSUPPORTED", rejection);
    const response = await this.get(`files/${encodeURIComponent(file.id)}`, { alt: "media", ...ALL_DRIVES });
    if (!response.body) throw new DriveError(422, "DRIVE_EMPTY", "La pièce Drive est vide.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        // A stream cut or timed out mid-body is a Drive interruption, like a failed request.
        const { done, value } = await reader.read().catch(() => {
          throw new DriveError(422, "DRIVE_NETWORK", "Connexion Drive interrompue. Réessayez dans un instant.");
        });
        if (done) break;
        size += value.byteLength;
        if (size > DRIVE_MAX_FILE_BYTES || size > Number(file.size)) {
          throw new DriveError(422, "DRIVE_CHANGED", "Taille réelle refusée ou pièce modifiée pendant la lecture.");
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== Number(file.size) || !size) throw new DriveError(422, "DRIVE_INCOMPLETE", "Lecture Drive incomplète. Relancez l'analyse.");
    const current = await this.file(file.id);
    if (current.version !== file.version || current.trashed ||
      (file.md5Checksum && createHash("md5").update(bytes).digest("hex") !== file.md5Checksum)) {
      throw new DriveError(422, "DRIVE_CHANGED", "Pièce modifiée pendant la lecture. Relancez l'analyse.");
    }
    return bytes;
  }
}

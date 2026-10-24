import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, badRequest } from "@/lib/estimates/errors";
import { DRIVE_FOLDER_MIME, DRIVE_MAX_FILE_BYTES, driveFileRejection, driveFileSchema, type DriveFile } from "./contracts";

const FIELDS = "id,name,mimeType,version,size,modifiedTime,parents,driveId,trashed,capabilities(canDownload),md5Checksum";
export class GoogleDriveReader {
  private readonly signal: AbortSignal;
  constructor(private readonly token: string, signal: AbortSignal) {
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
      throw badRequest("Connexion Drive interrompue. Reconnectez-vous puis reprenez les échecs.", undefined, "DRIVE_NETWORK");
    }
    if (!response.ok) {
      const [code, message] = response.status === 401 ? ["DRIVE_EXPIRED", "Connexion Google expirée ou révoquée. Reconnectez-vous."]
        : response.status === 403 ? ["DRIVE_FORBIDDEN", "Droit Drive insuffisant ou quota Google atteint. Vérifiez les droits et réessayez plus tard."]
        : response.status === 404 ? ["DRIVE_NOT_FOUND", "Pièce ou dossier Drive introuvable ou inaccessible."]
        : response.status === 429 ? ["DRIVE_QUOTA", "Quota Google atteint. Réessayez plus tard."]
        : ["DRIVE_UNAVAILABLE", "Google Drive est indisponible. Réessayez plus tard."];
      await response.body?.cancel();
      throw new ApiError({ status: response.status === 401 ? 401 : 422, code, message });
    }
    return response;
  }
  async file(id: string) {
    return driveFileSchema.parse(await (await this.get(`files/${encodeURIComponent(id)}`, { fields: FIELDS })).json());
  }
  async folder(id: string) {
    const folder = await this.file(id);
    if (folder.mimeType !== DRIVE_FOLDER_MIME || folder.trashed || folder.driveId) {
      throw badRequest("Choisissez un dossier personnel Google Drive accessible, hors Drive partagé.");
    }
    return folder;
  }
  async list(folderId: string, pageToken?: string) {
    const folder = await this.folder(folderId);
    const response = await this.get("files", { q: `'${folder.id}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FIELDS})`, pageSize: "100", orderBy: "folder,name",
      ...(pageToken ? { pageToken } : {}) });
    const page = z.object({ files: z.array(driveFileSchema), nextPageToken: z.string().optional() }).parse(await response.json());
    const about = z.object({ user: z.object({ displayName: z.string(), emailAddress: z.string() }) })
      .parse(await (await this.get("about", { fields: "user(displayName,emailAddress)" })).json());
    return { folder, ...page, account: about.user };
  }
  async download(file: DriveFile, folderId: string) {
    const rejection = driveFileRejection(file);
    if (rejection) throw badRequest(rejection);
    if (!file.parents?.includes(folderId)) throw badRequest("Cette pièce n'appartient plus au dossier choisi.");
    const response = await this.get(`files/${encodeURIComponent(file.id)}`, { alt: "media" });
    if (!response.body) throw badRequest("La pièce Drive est vide.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > DRIVE_MAX_FILE_BYTES || size > Number(file.size)) {
          throw badRequest("Taille réelle refusée ou pièce modifiée pendant le transfert.");
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== Number(file.size) || !size) throw badRequest("Transfert incomplet. Reprenez cette pièce.");
    const current = await this.file(file.id);
    if (current.version !== file.version || current.trashed || !current.parents?.includes(folderId) ||
      (file.md5Checksum && createHash("md5").update(bytes).digest("hex") !== file.md5Checksum)) {
      throw badRequest("Pièce modifiée pendant l'import. Actualisez le dossier avant de confirmer.");
    }
    return { file: new File([bytes], file.name, { type: file.mimeType }),
      sha256: createHash("sha256").update(bytes).digest("hex") };
  }
}

import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DriveError } from "./errors";

// Kept free of Next: the worker, the routes and the owned native campaign share it.
export type DriveConfiguration =
  | { enabled: false }
  | { enabled: true; clientId: string; clientSecret: string; tokenKey: Buffer };

function tokenKey(value: string | undefined) {
  const key = value?.trim() ? Buffer.from(value.trim(), "base64") : null;
  return key?.length === 32 ? key : null;
}
/** Drive stays off until OAuth, the token key and the service role are all configured. */
export function driveConfiguration(environment: NodeJS.ProcessEnv = process.env): DriveConfiguration {
  const clientId = environment.MERGEONE_GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = environment.MERGEONE_GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const key = tokenKey(environment.MERGEONE_GOOGLE_DRIVE_TOKEN_KEY);
  const serviceRole = Boolean(environment.NEXT_PUBLIC_SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY);
  if (environment.MERGEONE_GOOGLE_DRIVE_ENABLED !== "true" || !clientId || !clientSecret || !key || !serviceRole) {
    return { enabled: false };
  }
  return { enabled: true, clientId, clientSecret, tokenKey: key };
}

export class DriveSecretError extends DriveError {
  constructor() {
    super(401, "DRIVE_SECRET_UNREADABLE", "Accès Google Drive illisible. Ajoutez le compte à nouveau.");
    this.name = "DriveSecretError";
  }
}
// AES-256-GCM with the identity of the row as associated data, so a token sealed for one
// member or Google account cannot be replayed against another row.
export function sealDriveSecret(key: Buffer, plaintext: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => typeof part === "string" ? part : part.toString("base64url")).join(".");
}
export function openDriveSecret(key: Buffer, sealed: string, context: string) {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || rest.length) throw new DriveSecretError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new DriveSecretError();
  }
}
export const connectionSecretContext = (tenantId: string, userId: string, googleAccountId: string) =>
  JSON.stringify(["google-drive-refresh-token", tenantId, userId, googleAccountId]);

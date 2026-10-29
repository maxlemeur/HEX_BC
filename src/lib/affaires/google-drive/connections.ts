import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { DriveConnection } from "./contracts";
import { DriveError } from "./errors";
import { refreshDriveAccess } from "./oauth";
import {
  connectionSecretContext,
  openDriveSecret,
  sealDriveSecret,
  type DriveConfiguration,
} from "./secrets";

type Enabled = Extract<DriveConfiguration, { enabled: true }>;
export type DriveMember = {
  supabase: unknown;
  tenantId: string;
  userId: string;
};
type Query = SupabaseClient<Database>;
const db = (member: DriveMember) => member.supabase as Query;
const service = () => createServiceRoleClient() as unknown as Query;
const connectionSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  status: z.enum(["active", "reconnect_required"]),
  write_enabled: z.boolean(),
  grant_version: z.string().uuid(),
  created_at: z.string(),
});
const toConnection = (
  row: z.infer<typeof connectionSchema>,
): DriveConnection => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  status: row.status,
  writeEnabled: row.write_enabled,
  grantVersion: row.grant_version,
  connectedAt: row.created_at,
});
const columns =
  "id,email,display_name,status,write_enabled,grant_version,created_at";
const notFound = () =>
  new DriveError(
    404,
    "DRIVE_CONNECTION_NOT_FOUND",
    "Compte Google introuvable. Reconnectez-le depuis votre profil.",
  );
const changed = () =>
  new DriveError(
    409,
    "DRIVE_MODE_CHANGED",
    "Les droits du compte ont changé. Actualisez avant de recommencer.",
  );
const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (id: string, cipher: string, grantVersion: string) =>
  `${id}:${grantVersion}:${createHash("sha256").update(cipher).digest("hex")}`;

export async function listDriveConnections(member: DriveMember) {
  const { data, error } = await db(member)
    .from("google_drive_connections")
    .select(columns)
    .eq("tenant_id", member.tenantId)
    .eq("user_id", member.userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error)
    throw new DriveError(
      500,
      "DRIVE_CONNECTIONS_UNAVAILABLE",
      "Impossible de lire votre compte Google.",
    );
  return z
    .array(connectionSchema)
    .parse(data ?? [])
    .map(toConnection);
}
export async function requireOwnDriveConnection(
  member: DriveMember,
  id: string,
) {
  const { data, error } = await db(member)
    .from("google_drive_connections")
    .select(columns)
    .eq("tenant_id", member.tenantId)
    .eq("user_id", member.userId)
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new DriveError(
      500,
      "DRIVE_CONNECTIONS_UNAVAILABLE",
      "Impossible de lire votre compte Google.",
    );
  if (!data) throw notFound();
  return toConnection(connectionSchema.parse(data));
}
export async function readDriveAuthorizationGeneration(member: DriveMember) {
  const { data, error } = await service().rpc(
    "begin_google_drive_authorization",
    { p_tenant_id: member.tenantId, p_user_id: member.userId },
  );
  const value = z.string().uuid().safeParse(data);
  if (error || !value.success)
    throw new DriveError(
      500,
      "DRIVE_AUTHORIZATION_UNAVAILABLE",
      "Impossible de préparer la connexion Google.",
    );
  return value.data;
}
export async function saveDriveConnection(
  member: DriveMember,
  configuration: Enabled,
  account: { permissionId: string; emailAddress: string; displayName: string },
  grant: { refreshToken: string; accessToken: string; expiresAt: number },
  authorization: { purpose: "read" | "write"; generation: string },
) {
  const cipher = sealDriveSecret(
    configuration.tokenKey,
    grant.refreshToken,
    connectionSecretContext(
      member.tenantId,
      member.userId,
      account.permissionId,
    ),
  );
  const { data, error } = await service().rpc(
    "save_google_drive_single_connection",
    {
      p_tenant_id: member.tenantId,
      p_user_id: member.userId,
      p_google_account_id: account.permissionId,
      p_email: account.emailAddress,
      p_display_name: account.displayName,
      p_refresh_token_ciphertext: cipher,
      p_purpose: authorization.purpose,
      p_generation: authorization.generation,
    },
  );
  if (error?.message === "GOOGLE_DRIVE_SINGLE_ACCOUNT")
    throw new DriveError(
      409,
      "DRIVE_SINGLE_ACCOUNT",
      "Utilisez le compte Google déjà connecté, ou retirez-le pour en changer.",
    );
  if (error?.message === "GOOGLE_DRIVE_AUTHORIZATION_EXPIRED")
    throw new DriveError(
      409,
      "DRIVE_AUTHORIZATION_EXPIRED",
      "Cette autorisation a expiré. Recommencez la connexion.",
    );
  const id = z.string().uuid().safeParse(data);
  if (error || !id.success)
    throw new DriveError(
      500,
      "DRIVE_CONNECTION_NOT_SAVED",
      "Le compte Google n’a pas pu être enregistré.",
    );
  // The database rotated grant_version. Discard this instance's old tokens;
  // other instances also miss their old cache entries because the version is
  // part of the key. The first use refreshes the newly saved grant.
  forgetDriveAccess(id.data);
  return id.data;
}
const secretSchema = z.object({
  tenant_id: z.string(),
  user_id: z.string(),
  google_account_id: z.string(),
  status: z.enum(["active", "reconnect_required"]),
  updated_at: z.string(),
  shared_grant: z.boolean(),
  refresh_token_ciphertext: z.string(),
  write_refresh_token_ciphertext: z.string().nullable(),
  write_enabled: z.boolean(),
  grant_version: z.string().uuid(),
});
async function secret(id: string) {
  const { data, error } = await service().rpc("google_drive_single_secret", {
    p_connection_id: id,
  });
  if (error)
    throw new DriveError(
      500,
      "DRIVE_CONNECTIONS_UNAVAILABLE",
      "Impossible de lire l’accès Google.",
    );
  const row = z.array(secretSchema).parse(data ?? [])[0];
  if (!row) throw notFound();
  return row;
}
async function token(
  configuration: Enabled,
  id: string,
  expected: { tenantId: string; userId?: string },
  purpose: "read" | "write",
  version?: string,
  signal?: AbortSignal,
) {
  const row = await secret(id);
  if (
    row.tenant_id !== expected.tenantId ||
    (expected.userId && row.user_id !== expected.userId)
  )
    throw notFound();
  if (version && row.grant_version !== version) throw changed();
  if (
    purpose === "write" &&
    (!row.write_enabled || !row.write_refresh_token_ciphertext)
  )
    throw new DriveError(
      403,
      "DRIVE_WRITE_DISABLED",
      "Ce compte est en lecture seule.",
    );
  if (row.status !== "active")
    throw new DriveError(
      401,
      "DRIVE_RECONNECT",
      "Reconnectez votre compte Google.",
    );
  const ciphertext =
    purpose === "write"
      ? row.write_refresh_token_ciphertext!
      : row.refresh_token_ciphertext;
  const key = cacheKey(id, ciphertext, row.grant_version);
  const cached = accessTokens.get(key);
  const verify = async () => {
    const current = await secret(id);
    if (
      current.tenant_id !== row.tenant_id ||
      current.user_id !== row.user_id ||
      current.status !== "active" ||
      current.grant_version !== row.grant_version ||
      current.refresh_token_ciphertext !== row.refresh_token_ciphertext ||
      (purpose === "write" &&
        (!current.write_enabled ||
          current.write_refresh_token_ciphertext !== ciphertext))
    )
      throw changed();
    signal?.throwIfAborted();
  };
  if (cached && cached.expiresAt > Date.now()) {
    await verify();
    return cached.token;
  }
  try {
    const access = await refreshDriveAccess(
      {
        clientId: configuration.clientId,
        clientSecret: configuration.clientSecret,
        refreshToken: openDriveSecret(
          configuration.tokenKey,
          ciphertext,
          connectionSecretContext(
            row.tenant_id,
            row.user_id,
            row.google_account_id,
          ),
        ),
        purpose,
      },
      signal,
    );
    await verify();
    accessTokens.set(key, {
      token: access.accessToken,
      expiresAt: access.expiresAt,
    });
    return access.accessToken;
  } catch (error) {
    if (purpose === "write" && error instanceof DriveError && error.code === "DRIVE_RECONNECT") {
      accessTokens.delete(key);
      const { error: removalError } = await service().rpc("set_google_drive_read_only", {
        p_tenant_id: row.tenant_id,
        p_user_id: row.user_id,
        p_connection_id: id,
        p_grant_version: row.grant_version,
      });
      if (removalError) throw new DriveError(500, "DRIVE_CONNECTIONS_UNAVAILABLE", "Impossible d’actualiser les droits Google. Actualisez le profil.");
      throw new DriveError(401, "DRIVE_RECONNECT", "Le droit d’écriture a expiré. Activez-le à nouveau depuis votre profil.");
    }
    if (
      purpose === "read" &&
      error instanceof DriveError &&
      error.code === "DRIVE_RECONNECT"
    )
      await service()
        .from("google_drive_connections")
        .update({
          status: "reconnect_required",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("grant_version", row.grant_version);
    throw error;
  }
}
export const driveAccessToken = (
  configuration: Enabled,
  id: string,
  expected: { tenantId: string; userId?: string },
  signal?: AbortSignal,
) => token(configuration, id, expected, "read", undefined, signal);
export async function driveWriteToken(
  configuration: Enabled,
  id: string,
  member: DriveMember,
  version: string,
  signal?: AbortSignal,
) {
  await requireOwnDriveConnection(member, id);
  return token(configuration, id, member, "write", version, signal);
}
export function forgetDriveAccess(id: string) {
  for (const key of accessTokens.keys())
    if (key.startsWith(`${id}:`)) accessTokens.delete(key);
}
async function mutateConnection(
  member: DriveMember,
  id: string,
  version: string,
  operation: "set_google_drive_read_only" | "remove_google_drive_single_connection",
) {
  const own = await requireOwnDriveConnection(member, id);
  if (own.grantVersion !== version) throw changed();
  const { data, error } = await service().rpc(operation, {
    p_tenant_id: member.tenantId,
    p_user_id: member.userId,
    p_connection_id: id,
    p_grant_version: version,
  });
  if (error)
    throw new DriveError(
      500,
      "DRIVE_CONNECTION_NOT_REMOVED",
      "La modification du compte a échoué. Réessayez.",
    );
  if (data !== true) throw changed();
  forgetDriveAccess(id);
}
export const disableDriveWriting = (
  member: DriveMember,
  id: string,
  version: string,
) => mutateConnection(member, id, version, "set_google_drive_read_only");
export async function disconnectDriveConnection(
  member: DriveMember,
  id: string,
  version: string,
) {
  await mutateConnection(
    member,
    id,
    version,
    "remove_google_drive_single_connection",
  );
  return { revoked: false, stillUsed: null };
}

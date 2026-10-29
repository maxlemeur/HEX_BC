import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { DriveConnection } from "./contracts";
import { DriveError } from "./errors";
import { refreshDriveAccess, revokeDriveAccess } from "./oauth";
import { connectionSecretContext, openDriveSecret, sealDriveSecret, type DriveConfiguration } from "./secrets";

type Enabled = Extract<DriveConfiguration, { enabled: true }>;
type Member = { supabase: unknown; tenantId: string; userId: string };
type Query = { from: (table: string) => any; rpc: (name: string, args: unknown) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const database = (member: Member) => member.supabase as Query;
const connectionSchema = z.object({ id: z.string(), email: z.string(), display_name: z.string(),
  status: z.enum(["active", "reconnect_required"]) });
const toConnection = (row: z.infer<typeof connectionSchema>): DriveConnection =>
  ({ id: row.id, email: row.email, displayName: row.display_name, status: row.status });
const notFound = () => new DriveError(404, "DRIVE_CONNECTION_NOT_FOUND", "Compte Google introuvable. Ajoutez-le à nouveau.");
// Short-lived access tokens are reused within a process, keyed by the stored ciphertext. The
// row is read on every use, so the owner, the tenant and a replaced token are checked first.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (connectionId: string, ciphertext: string) => `${connectionId}:${createHash("sha256").update(ciphertext).digest("hex")}`;

/** The member's own Google accounts in the active tenant, read under RLS. */
export async function listDriveConnections(member: Member) {
  const { data, error } = await database(member).from("google_drive_connections")
    .select("id,email,display_name,status").eq("tenant_id", member.tenantId).eq("user_id", member.userId)
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new DriveError(500, "DRIVE_CONNECTIONS_UNAVAILABLE", "Impossible de lire vos comptes Google.");
  return z.array(connectionSchema).parse(data ?? []).map(toConnection);
}
export async function requireOwnDriveConnection(member: Member, connectionId: string) {
  const { data, error } = await database(member).from("google_drive_connections")
    .select("id,email,display_name,status").eq("tenant_id", member.tenantId).eq("user_id", member.userId)
    .eq("id", connectionId).maybeSingle();
  if (error) throw new DriveError(500, "DRIVE_CONNECTIONS_UNAVAILABLE", "Impossible de lire vos comptes Google.");
  if (!data) throw notFound();
  return toConnection(connectionSchema.parse(data));
}

/** Stores the account for the signed-in member; the RPC binds the row to auth.uid(). */
export async function saveDriveConnection(member: Member, configuration: Enabled,
  account: { permissionId: string; emailAddress: string; displayName: string },
  grant: { refreshToken: string; accessToken: string; expiresAt: number }) {
  const ciphertext = sealDriveSecret(configuration.tokenKey, grant.refreshToken,
    connectionSecretContext(member.tenantId, member.userId, account.permissionId));
  const { data, error } = await database(member).rpc("save_google_drive_connection", {
    p_google_account_id: account.permissionId, p_email: account.emailAddress, p_display_name: account.displayName,
    p_refresh_token_ciphertext: ciphertext,
  });
  const id = z.string().uuid().safeParse(data);
  if (error || !id.success) throw new DriveError(500, "DRIVE_CONNECTION_NOT_SAVED", "Le compte Google n'a pas pu être enregistré. Réessayez.");
  accessTokens.set(cacheKey(id.data, ciphertext), { token: grant.accessToken, expiresAt: grant.expiresAt });
  return id.data;
}

const secretSchema = z.object({ tenant_id: z.string(), user_id: z.string(), google_account_id: z.string(),
  status: z.enum(["active", "reconnect_required"]), updated_at: z.string(), shared_grant: z.boolean(), refresh_token_ciphertext: z.string() });
async function readSecret(connectionId: string) {
  const { data, error } = await (createServiceRoleClient() as unknown as Query)
    .rpc("google_drive_connection_secret", { p_connection_id: connectionId });
  if (error) throw new DriveError(500, "DRIVE_CONNECTIONS_UNAVAILABLE", "Impossible de lire l'accès Google.");
  const row = z.array(secretSchema).parse(data ?? [])[0];
  if (!row) throw notFound();
  return { row, refreshToken: (key: Buffer) => openDriveSecret(key, row.refresh_token_ciphertext,
    connectionSecretContext(row.tenant_id, row.user_id, row.google_account_id)) };
}

export async function driveAccessToken(configuration: Enabled, connectionId: string,
  expected: { tenantId: string; userId?: string }, signal?: AbortSignal) {
  const { row, refreshToken } = await readSecret(connectionId);
  if (row.tenant_id !== expected.tenantId || (expected.userId && row.user_id !== expected.userId)) throw notFound();
  if (row.status === "reconnect_required") {
    throw new DriveError(401, "DRIVE_RECONNECT", "Accès Google expiré ou révoqué. Reconnectez ce compte.");
  }
  const key = cacheKey(connectionId, row.refresh_token_ciphertext);
  const cached = accessTokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  try {
    const access = await refreshDriveAccess({ clientId: configuration.clientId, clientSecret: configuration.clientSecret,
      refreshToken: refreshToken(configuration.tokenKey) }, signal);
    accessTokens.set(key, { token: access.accessToken, expiresAt: access.expiresAt });
    return access.accessToken;
  } catch (error) {
    if (error instanceof DriveError && error.code === "DRIVE_RECONNECT") {
      // Only the token that was refused: a reconnect saved meanwhile stays active.
      await (createServiceRoleClient() as unknown as Query).from("google_drive_connections")
        .update({ status: "reconnect_required", updated_at: new Date().toISOString() }).eq("id", connectionId).eq("updated_at", row.updated_at);
    }
    throw error;
  }
}

/** Forgets a cached access token that Google refused, so that the next use renews it. */
export function forgetDriveAccess(connectionId: string) {
  [...accessTokens.keys()].filter((key) => key.startsWith(`${connectionId}:`)).forEach((key) => accessTokens.delete(key));
}

/**
 * Removes the account; its links stay in the affaires. The grant is revoked at Google unless
 * another connection (another tenant or member) uses the same Google account: Google revokes
 * a grant for every token of that account at once.
 */
export async function disconnectDriveConnection(member: Member, configuration: Enabled, connectionId: string) {
  await requireOwnDriveConnection(member, connectionId);
  let revoked = false;
  let stillUsed = false;
  try {
    const { row, refreshToken } = await readSecret(connectionId);
    stillUsed = row.shared_grant;
    if (row.user_id === member.userId && !stillUsed) revoked = await revokeDriveAccess(refreshToken(configuration.tokenKey));
  } catch {
    revoked = false;
  }
  const { data, error } = await database(member).from("google_drive_connections").delete()
    .eq("tenant_id", member.tenantId).eq("user_id", member.userId).eq("id", connectionId).select("id");
  if (error || !(data as unknown[] | null)?.length) throw new DriveError(500, "DRIVE_CONNECTION_NOT_REMOVED", "Le compte Google n'a pas pu être retiré. Réessayez.");
  forgetDriveAccess(connectionId);
  return { revoked, stillUsed };
}

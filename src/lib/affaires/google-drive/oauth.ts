import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  DRIVE_READ_SCOPE,
  DRIVE_WRITE_SCOPE,
  drivePurposeSchema,
  type DriveOAuthOutcome,
} from "./contracts";
import { DriveError } from "./errors";
import { openDriveSecret, sealDriveSecret } from "./secrets";

// OAuth 2.0 web-server flow with PKCE and offline access: Google returns a refresh token
// that the server keeps encrypted, so an added account stays connected between visits.
export const DRIVE_OAUTH_CALLBACK_PATH = "/api/google-drive/oauth/callback";
export const DRIVE_OAUTH_COOKIE = "mergeone_drive_oauth";
export const DRIVE_OAUTH_TTL_SECONDS = 600;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_CONTEXT = "google-drive-oauth-state";

export type { DriveOAuthOutcome };
/** Only a dashboard page of this application can be the destination after Google. */
export function safeDriveReturnPath(value: string | null | undefined) {
  return value && /^\/dashboard(\/[A-Za-z0-9_-]+)*\/?$/.test(value)
    ? value
    : "/dashboard";
}
/** The page learns only an outcome code: no Google message or token is put in the URL. */
export function driveOAuthReturn(
  origin: string,
  returnTo: string,
  outcome: DriveOAuthOutcome,
  connectionId?: string,
) {
  const url = new URL(safeDriveReturnPath(returnTo), origin);
  url.searchParams.set("drive", outcome);
  if (connectionId) url.searchParams.set("driveConnection", connectionId);
  return url;
}

const stateSchema = z
  .object({
    state: z.string().min(32),
    verifier: z.string().min(43),
    returnTo: z.string(),
    userId: z.string(),
    tenantId: z.string(),
    expiresAt: z.number(),
    purpose: drivePurposeSchema.default("read"),
    generation: z.string().uuid(),
  })
  .strict();
export type DriveAuthorization = z.infer<typeof stateSchema>;

export function beginDriveAuthorization(input: {
  clientId: string;
  key: Buffer;
  redirectUri: string;
  returnTo: string;
  userId: string;
  tenantId: string;
  purpose?: "read" | "write";
  generation: string;
  now?: number;
}) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  Object.entries({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.purpose === "write" ? DRIVE_WRITE_SCOPE : DRIVE_READ_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const authorization: DriveAuthorization = {
    state,
    verifier,
    returnTo: safeDriveReturnPath(input.returnTo),
    userId: input.userId,
    tenantId: input.tenantId,
    purpose: input.purpose ?? "read",
    generation: input.generation,
    expiresAt: (input.now ?? Date.now()) + DRIVE_OAUTH_TTL_SECONDS * 1000,
  };
  return {
    url,
    cookie: sealDriveSecret(
      input.key,
      JSON.stringify(authorization),
      STATE_CONTEXT,
    ),
  };
}
/** The sealed cookie proves this browser started the flow; an expired or altered one is ignored. */
export function readDriveAuthorization(
  key: Buffer,
  cookie: string | undefined,
  now = Date.now(),
) {
  if (!cookie) return null;
  try {
    const authorization = stateSchema.parse(
      JSON.parse(openDriveSecret(key, cookie, STATE_CONTEXT)),
    );
    return authorization.expiresAt > now ? authorization : null;
  } catch {
    return null;
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).max(4096).optional(),
  scope: z.string().max(4096).optional(),
});
async function tokenRequest(
  body: Record<string, string>,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch {
    throw new DriveError(
      422,
      "DRIVE_NETWORK",
      "Google est injoignable. Réessayez dans un instant.",
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if ((payload as { error?: unknown } | null)?.error === "invalid_grant") {
      throw new DriveError(
        401,
        "DRIVE_RECONNECT",
        "Accès Google expiré ou révoqué. Reconnectez ce compte.",
      );
    }
    throw new DriveError(
      422,
      "DRIVE_OAUTH_FAILED",
      "Google a refusé la connexion. Réessayez.",
    );
  }
  const token = tokenSchema.safeParse(payload);
  if (!token.success)
    throw new DriveError(
      422,
      "DRIVE_OAUTH_FAILED",
      "Réponse Google invalide. Réessayez.",
    );
  return {
    ...token.data,
    expiresAt: Date.now() + Math.max(0, token.data.expires_in - 60) * 1000,
  };
}

function requireScope(scope: string | undefined, purpose: "read" | "write") {
  const expected = purpose === "write" ? DRIVE_WRITE_SCOPE : DRIVE_READ_SCOPE;
  const scopes = new Set(scope?.split(/\s+/).filter(Boolean));
  if (scopes.size !== 1 || !scopes.has(expected))
    throw new DriveError(
      422,
      "DRIVE_SCOPE_REFUSED",
      "Les droits accordés par Google ne correspondent pas au choix effectué.",
    );
}
export async function exchangeDriveCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  verifier: string;
  redirectUri: string;
  purpose?: "read" | "write";
}) {
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  requireScope(token.scope, input.purpose ?? "read");
  if (!token.refresh_token) {
    throw new DriveError(
      422,
      "DRIVE_OFFLINE_REFUSED",
      "Google n'a pas accordé d'accès durable. Retirez MergeOne de votre compte Google puis recommencez.",
    );
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expiresAt,
  };
}
export async function refreshDriveAccess(
  input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    purpose?: "read" | "write";
  },
  signal?: AbortSignal,
) {
  const scope =
    input.purpose === "write" ? DRIVE_WRITE_SCOPE : DRIVE_READ_SCOPE;
  const token = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      scope,
    },
    signal,
  );
  requireScope(token.scope ?? scope, input.purpose ?? "read");
  return { accessToken: token.access_token, expiresAt: token.expiresAt };
}
/** Revoking the refresh token also ends the access tokens Google issued from it. */
export async function revokeDriveAccess(refreshToken: string) {
  try {
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    // An already revoked token is reported as invalid: it is gone either way.
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

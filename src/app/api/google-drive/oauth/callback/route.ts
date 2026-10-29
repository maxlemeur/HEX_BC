import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { saveDriveConnection } from "@/lib/affaires/google-drive/connections";
import { DriveError } from "@/lib/affaires/google-drive/errors";
import { DRIVE_OAUTH_CALLBACK_PATH, DRIVE_OAUTH_COOKIE, driveOAuthReturn, exchangeDriveCode,
  readDriveAuthorization, type DriveOAuthOutcome } from "@/lib/affaires/google-drive/oauth";
import { GoogleDriveReader } from "@/lib/affaires/google-drive/provider";
import { driveConfiguration } from "@/lib/affaires/google-drive/secrets";

export const runtime = "nodejs";

/** Google's return: the code is exchanged server-side and only an outcome reaches the page. */
export async function GET(request: NextRequest) {
  const configuration = driveConfiguration();
  const authorization = configuration.enabled
    ? readDriveAuthorization(configuration.tokenKey, request.cookies.get(DRIVE_OAUTH_COOKIE)?.value) : null;
  const finish = (outcome: DriveOAuthOutcome, connectionId?: string) => {
    const response = NextResponse.redirect(driveOAuthReturn(request.nextUrl.origin, authorization?.returnTo ?? "/dashboard", outcome, connectionId));
    response.cookies.set(DRIVE_OAUTH_COOKIE, "", { httpOnly: true, secure: request.nextUrl.protocol === "https:",
      sameSite: "lax", path: "/api/google-drive/oauth", maxAge: 0 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  if (!configuration.enabled) return finish("disabled");
  const parameters = request.nextUrl.searchParams;
  if (!authorization || parameters.get("state") !== authorization.state) return finish("expired");
  if (parameters.get("error")) return finish("refused");
  const code = parameters.get("code");
  if (!code || code.length > 2048) return finish("failed");
  try {
    // The member who comes back must be the one who started, in the same active tenant.
    const member = await getAuthenticatedContext();
    if (member.userId !== authorization.userId || member.tenantId !== authorization.tenantId) return finish("expired");
    const grant = await exchangeDriveCode({ clientId: configuration.clientId, clientSecret: configuration.clientSecret, code,
      verifier: authorization.verifier, redirectUri: new URL(DRIVE_OAUTH_CALLBACK_PATH, request.nextUrl.origin).toString() });
    const account = await new GoogleDriveReader(grant.accessToken, request.signal).account();
    return finish("connected", await saveDriveConnection(member, configuration, account, grant));
  } catch (error) {
    const reason = error instanceof DriveError ? error.code : "unexpected";
    console.error("Google Drive connection failed", { reason });
    return finish(reason === "DRIVE_SCOPE_REFUSED" ? "scope" : reason === "DRIVE_OFFLINE_REFUSED" ? "offline" : "failed");
  }
}

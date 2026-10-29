import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import {
  beginDriveAuthorization,
  DRIVE_OAUTH_CALLBACK_PATH,
  DRIVE_OAUTH_COOKIE,
  DRIVE_OAUTH_TTL_SECONDS,
  driveOAuthReturn,
  safeDriveReturnPath,
} from "@/lib/affaires/google-drive/oauth";
import { driveConfiguration } from "@/lib/affaires/google-drive/secrets";
import { drivePurposeSchema } from "@/lib/affaires/google-drive/contracts";
import {
  listDriveConnections,
  readDriveAuthorizationGeneration,
} from "@/lib/affaires/google-drive/connections";

export const runtime = "nodejs";

/** Sends the signed-in member to Google to add a Drive account; it then stays connected. */
export async function GET(request: NextRequest) {
  const returnTo = safeDriveReturnPath(
    request.nextUrl.searchParams.get("returnTo"),
  );
  const configuration = driveConfiguration();
  if (!configuration.enabled)
    return NextResponse.redirect(
      driveOAuthReturn(request.nextUrl.origin, returnTo, "disabled"),
    );
  let member: Awaited<ReturnType<typeof getAuthenticatedContext>>;
  try {
    member = await getAuthenticatedContext();
  } catch {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }
  const purpose = drivePurposeSchema.safeParse(
    request.nextUrl.searchParams.get("purpose") ?? "read",
  );
  if (!purpose.success)
    return NextResponse.redirect(
      driveOAuthReturn(request.nextUrl.origin, returnTo, "scope"),
    );
  if (purpose.data === "write" && !configuration.picker)
    return NextResponse.redirect(
      driveOAuthReturn(request.nextUrl.origin, returnTo, "picker_unavailable"),
    );
  let generation: string;
  try {
    if (
      purpose.data === "write" &&
      (await listDriveConnections(member)).length !== 1
    )
      return NextResponse.redirect(
        driveOAuthReturn(request.nextUrl.origin, returnTo, "account"),
      );
    generation = await readDriveAuthorizationGeneration(member);
  } catch {
    return NextResponse.redirect(
      driveOAuthReturn(request.nextUrl.origin, returnTo, "failed"),
    );
  }
  const { url, cookie } = beginDriveAuthorization({
    clientId: configuration.clientId,
    key: configuration.tokenKey,
    redirectUri: new URL(
      DRIVE_OAUTH_CALLBACK_PATH,
      request.nextUrl.origin,
    ).toString(),
    returnTo,
    userId: member.userId,
    tenantId: member.tenantId,
    purpose: purpose.data,
    generation,
  });
  const response = NextResponse.redirect(url);
  // Sent back by the top-level return from Google (SameSite=Lax), never readable by scripts.
  response.cookies.set(DRIVE_OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/google-drive/oauth",
    maxAge: DRIVE_OAUTH_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { driveConnectionRequestSchema } from "@/lib/affaires/google-drive/contracts";
import {
  disableDriveWriting,
  disconnectDriveConnection,
  driveWriteToken,
  listDriveConnections,
} from "@/lib/affaires/google-drive/connections";
import { driveConfiguration } from "@/lib/affaires/google-drive/secrets";
import { writeDriveFile } from "@/lib/affaires/google-drive/writing";
import { DriveError } from "@/lib/affaires/google-drive/errors";
import { toDriveApiError } from "@/lib/affaires/google-drive/server";
import { ok, badRequest, toErrorResponse } from "@/lib/http/api-response";
import { withPrivateNoStore } from "@/lib/http/response";
import { isSameOriginRequest } from "@/lib/http/same-origin";

export const runtime = "nodejs";
export async function GET() {
  try {
    const member = await getAuthenticatedContext();
    const config = driveConfiguration();
    return withPrivateNoStore(
      ok({
        enabled: config.enabled,
        writingAvailable: config.enabled && Boolean(config.picker),
        connection: (await listDriveConnections(member))[0] ?? null,
      }),
    );
  } catch (error) {
    return withPrivateNoStore(toErrorResponse(toDriveApiError(error)));
  }
}
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request))
      throw badRequest("Origine de requête refusée.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw badRequest("Payload JSON requis.");
    const member = await getAuthenticatedContext();
    const reader = request.body?.getReader();
    if (!reader) throw badRequest("Payload manquant.");
    let bytes = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 16 * 1024) throw badRequest("Payload trop volumineux.");
        parts.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw badRequest("Payload JSON invalide.");
    }
    const input = driveConnectionRequestSchema.parse(payload);
    // Removing a grant is available even when Google integration is disabled.
    if (input.action === "disconnect")
      return withPrivateNoStore(
        ok(
          await disconnectDriveConnection(
            member,
            input.connectionId,
            input.grantVersion,
          ),
        ),
      );
    if (input.action === "disable_write") {
      await disableDriveWriting(member, input.connectionId, input.grantVersion);
      return withPrivateNoStore(ok({ done: true }));
    }
    const config = driveConfiguration();
    if (!config.enabled)
      throw new DriveError(
        503,
        "DRIVE_DISABLED",
        "Google Drive n’est pas activé sur cet environnement.",
      );
    if (input.action === "picker") {
      if (!config.picker)
        throw new DriveError(
          503,
          "DRIVE_PICKER_UNAVAILABLE",
          "Le sélecteur Google n’est pas configuré.",
        );
      return withPrivateNoStore(
        ok({
          ...config.picker,
          accessToken: await driveWriteToken(
            config,
            input.connectionId,
            member,
            input.grantVersion,
            request.signal,
          ),
        }),
      );
    }
    return withPrivateNoStore(
      ok(await writeDriveFile(member, config, input, request.signal)),
    );
  } catch (error) {
    return withPrivateNoStore(toErrorResponse(toDriveApiError(error)));
  }
}

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
import { ok, badRequest, toErrorResponse } from "@/lib/estimates/errors";

export const runtime = "nodejs";
function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET() {
  try {
    const member = await getAuthenticatedContext();
    const config = driveConfiguration();
    return privateResponse(
      ok({
        enabled: config.enabled,
        writingAvailable: config.enabled && Boolean(config.picker),
        connection: (await listDriveConnections(member))[0] ?? null,
      }),
    );
  } catch (error) {
    return privateResponse(toErrorResponse(toDriveApiError(error)));
  }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
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
      return privateResponse(
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
      return privateResponse(ok({ done: true }));
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
      return privateResponse(
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
    return privateResponse(
      ok(await writeDriveFile(member, config, input, request.signal)),
    );
  } catch (error) {
    return privateResponse(toErrorResponse(toDriveApiError(error)));
  }
}

import { z } from "zod";
import { driveIdSchema } from "@/lib/affaires/google-drive/contracts";
import { readOwnDriveFile } from "@/lib/affaires/google-drive/server";
import { toErrorResponse } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const maxDuration = 120;

const paramsSchema = z.object({ projectId: z.string().uuid(), fileId: driveIdSchema });
const connectionIdSchema = z.string().uuid();
const cacheControl = "private, no-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; fileId: string }> },
) {
  try {
    const { projectId, fileId } = paramsSchema.parse(await params);
    const connectionId = connectionIdSchema.parse(new URL(request.url).searchParams.get("connectionId"));
    const { bytes, fileName, mimeType } = await readOwnDriveFile(projectId, connectionId, fileId, request.signal);
    const name = fileName.toWellFormed().replace(/[\p{Cc}/\\]/gu, "_");
    const fallback = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "document";
    const encoded = encodeURIComponent(name).replace(/['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(new Blob([new Uint8Array(bytes)]).stream(), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", cacheControl);
    return response;
  }
}

import { after } from "next/server";
import { z } from "zod";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { driveRequestSchema } from "@/lib/affaires/google-drive/contracts";
import { driveState, executeDriveRequest } from "@/lib/affaires/google-drive/server";
import { processAffaireIntakeUpload } from "@/lib/affaires/intake-server";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ projectId: string }> };
async function projectId(context: Context) { return z.string().uuid().parse((await context.params).projectId); }
function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET(_request: Request, context: Context) {
  try { return noStore(ok(await driveState(await projectId(context)))); }
  catch (error) { return noStore(toErrorResponse(error)); }
}
export async function POST(request: Request, context: Context) {
  try {
    // Same-origin only: tokens are never accepted via query parameters or redirects.
    if (request.headers.get("origin") !== new URL(request.url).origin) throw badRequest("Origine de requête refusée.");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw badRequest("Payload JSON requis.");
    const reader = request.body?.getReader();
    if (!reader) throw badRequest("Payload manquant.");
    let body = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32 * 1024) throw badRequest("Payload Drive trop volumineux.");
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => undefined); }
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw badRequest("Payload JSON invalide."); }
    const result = await executeDriveRequest(await projectId(context), driveRequestSchema.parse(payload), request.signal);
    for (const uploadId of result.uploads) {
      after(async () => {
        try { await processAffaireIntakeUpload(uploadId); }
        catch { console.error("Drive intake processing incomplete", { uploadId }); }
      });
    }
    return noStore(ok(result));
  } catch (error) { return noStore(toErrorResponse(error)); }
}

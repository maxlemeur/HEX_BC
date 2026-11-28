import { z } from "zod";
import { readAffaireDocumentTranscription } from "@/lib/affaires/intake-transcription-read";
import { toErrorResponse } from "@/lib/http/api-response";
import { withPrivateNoStore } from "@/lib/http/response";

export const runtime = "nodejs";
const paramsSchema = z.object({
  projectId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  try {
    const { projectId, documentId } = paramsSchema.parse(await params);
    const data = await readAffaireDocumentTranscription(projectId, documentId);
    return Response.json({ ok: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = toErrorResponse(error);
    return withPrivateNoStore(response);
  }
}

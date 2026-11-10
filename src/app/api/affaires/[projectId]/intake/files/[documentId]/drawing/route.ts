import { z } from "zod";
import { readAffaireDocumentDrawing } from "@/lib/affaires/intake-document-drawing";
import { toErrorResponse } from "@/lib/estimates/errors";

export const runtime = "nodejs";
export const maxDuration = 300;
const paramsSchema = z.object({
  projectId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  try {
    const { projectId, documentId } = paramsSchema.parse(await params);
    const drawing = await readAffaireDocumentDrawing(projectId, documentId, request.signal);
    return new Response(drawing.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        // A DXF is text: named so, it is compressed on its way to the browser.
        "Content-Type": "text/plain",
        "Content-Length": String(drawing.bytes.byteLength),
        "Content-Disposition": 'attachment; filename="plan.dxf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

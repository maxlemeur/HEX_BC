import { z } from "zod";
import { readAffaireDocumentPreview } from "@/lib/affaires/intake-document-preview";
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
    const download = new URL(request.url).searchParams.get("download") === "1";
    const document = await readAffaireDocumentPreview(
      projectId,
      documentId,
      download,
    );
    const filename =
      document.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) ||
      "document";
    const encoded = encodeURIComponent(document.fileName).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(new Uint8Array(document.bytes), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(document.bytes.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encoded}`,
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

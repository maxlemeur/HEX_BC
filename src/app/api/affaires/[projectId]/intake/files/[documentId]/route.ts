import { createHash } from "node:crypto";
import { z } from "zod";

import { getAffaireIntakeDpgfDownload, readAffaireIntakeDpgfFile } from "@/lib/affaires/intake-server";
import { badRequest, conflict, ok, toErrorResponse } from "@/lib/estimates/errors";
import { ImportsApiError, toErrorResponse as toImportsErrorResponse, createImportFromMultipartFormData, reviewTabularPdfImportFile, validateTabularPdfReviewFile } from "@/lib/imports/server";

const paramsSchema = z.object({ projectId: z.string().uuid(), documentId: z.string().uuid() });
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review_pdf") }).strict(),
  z.object({ action: z.literal("import"), approvedTables: z.array(z.object({
    sourcePage: z.number().int().positive(), tableIndex: z.number().int().nonnegative(),
  }).strict()).max(100).optional(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
]);

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function readAction(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw badRequest("Origine de requête refusée.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw badRequest("Payload JSON requis.");
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("Payload manquant.");
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16 * 1024) throw badRequest("Payload trop volumineux.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw badRequest("Payload JSON invalide."); }
  return bodySchema.parse(payload);
}

/** Streamed, so a Drive piece is not bound by the platform's buffered response size. */
function fileResponse(file: File) {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
        controller.enqueue(bytes.subarray(offset, offset + 1024 * 1024));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": file.type || "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> }
) {
  try {
    const { projectId, documentId } = paramsSchema.parse(await params);
    const url = new URL(request.url);
    // content=1 returns the bytes; Drive pieces are read this way since they have no stored copy.
    if (url.searchParams.get("content") === "1") {
      return fileResponse(await readAffaireIntakeDpgfFile(projectId, documentId));
    }
    url.search = "?content=1";
    return noStore(ok(await getAffaireIntakeDpgfDownload(projectId, documentId, url.toString())));
  } catch (error) {
    return noStore(error instanceof ImportsApiError ? toImportsErrorResponse(error) : toErrorResponse(error));
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> }
) {
  try {
    const { projectId, documentId } = paramsSchema.parse(await params);
    const body = await readAction(request);
    const file = await readAffaireIntakeDpgfFile(projectId, documentId);
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type.toLowerCase().includes("pdf");
    if (body.action === "review_pdf") {
      if (!isPdf) throw badRequest("La pièce sélectionnée n'est pas un PDF.");
      await validateTabularPdfReviewFile(file);
      const sourceSha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
      return noStore(ok({ ...await reviewTabularPdfImportFile({ file, sourceDocumentId: documentId }), source_sha256: sourceSha256 }));
    }
    if (isPdf) {
      if (!body.approvedTables?.length || !body.sourceSha256) throw badRequest("Revoyez le PDF et retenez au moins un tableau.");
      await validateTabularPdfReviewFile(file);
      const sourceSha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
      if (sourceSha256 !== body.sourceSha256) throw conflict("La copie PDF a changé. Revoyez les tableaux avant de les importer.");
    }
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);
    return noStore(ok(await createImportFromMultipartFormData(form, documentId, body.approvedTables), 201));
  } catch (error) {
    return noStore(error instanceof ImportsApiError ? toImportsErrorResponse(error) : toErrorResponse(error));
  }
}

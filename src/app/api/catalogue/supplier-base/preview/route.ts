import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { canAddToCatalogue } from "@/lib/catalogue/access";
import {
  SUPPLIER_BASE_FILE_TOO_LARGE, SUPPLIER_BASE_MAX_FILE_BYTES, supplierBaseUploadSchema,
} from "@/lib/catalogue/supplier-base-contract";
import { buildSupplierBasePreview } from "@/lib/catalogue/supplier-base-plan-server";
import { readSupplierBaseWorkbook } from "@/lib/catalogue/supplier-base-workbook";
import { badRequest, forbidden, payloadTooLarge, toErrorResponse } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MULTIPART_BYTES = SUPPLIER_BASE_MAX_FILE_BYTES + 32 * 1024;

async function readUpload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/iu.test(contentType) || !request.body) {
    throw badRequest("Joignez un classeur Excel au champ « file ».");
  }
  if (Number(request.headers.get("content-length")) > MAX_MULTIPART_BYTES) throw payloadTooLarge(SUPPLIER_BASE_FILE_TOO_LARGE);

  let received = 0;
  const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_MULTIPART_BYTES) throw payloadTooLarge(SUPPLIER_BASE_FILE_TOO_LARGE);
      controller.enqueue(chunk);
    },
  }));
  const form = await new Response(body, { headers: { "Content-Type": contentType } }).formData().catch(() => {
    if (received > MAX_MULTIPART_BYTES) throw payloadTooLarge(SUPPLIER_BASE_FILE_TOO_LARGE);
    throw badRequest("Le fichier joint est illisible.");
  });
  const files = form.getAll("file");
  if (files.length !== 1) throw badRequest("Joignez un seul classeur Excel.");
  const file = files[0];
  if (file instanceof File && file.size > SUPPLIER_BASE_MAX_FILE_BYTES) throw payloadTooLarge(SUPPLIER_BASE_FILE_TOO_LARGE);
  return supplierBaseUploadSchema.parse({ file }).file;
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedTenantContext();
    if (!canAddToCatalogue(context.tenantRole)) {
      throw forbidden("Seuls les administrateurs et les ingénieurs peuvent préparer cet import.");
    }
    const file = await readUpload(request);
    const workbook = await readSupplierBaseWorkbook(Buffer.from(await file.arrayBuffer()), request.signal);
    request.signal.throwIfAborted();
    const data = await buildSupplierBasePreview(context, workbook);
    const json = JSON.stringify({ ok: true, data });
    if (Buffer.byteLength(json) > SUPPLIER_BASE_MAX_FILE_BYTES) {
      throw payloadTooLarge("L’aperçu est trop volumineux. Répartissez les feuilles fournisseurs entre plusieurs classeurs.");
    }
    return new Response(json, {
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

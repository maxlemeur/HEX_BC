import { badRequest, ImportsApiError, MAX_IMPORT_FILE_SIZE_BYTES } from "@/lib/imports/server";

const multipartEnvelopeBytes = 1024 * 1024;

function bodyTooLarge() {
  return new ImportsApiError({
    status: 413,
    code: "PAYLOAD_TOO_LARGE",
    message: "Le corps de la requête d’import dépasse la taille autorisée.",
  });
}

async function parseBoundedBody<T>(
  request: Request,
  maxBytes: number,
  invalidMessage: string,
  parse: (body: Response) => Promise<T>
): Promise<T> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw bodyTooLarge();
  const source = request.body;
  if (!source) throw badRequest(invalidMessage);

  let received = 0;
  const bounded = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) throw bodyTooLarge();
      controller.enqueue(chunk);
    },
  }));
  try {
    return await parse(new Response(bounded, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }));
  } catch {
    // A Fetch decoder may wrap the stream error in an invalid-form TypeError.
    if (received > maxBytes) throw bodyTooLarge();
    throw badRequest(invalidMessage);
  }
}

export function readImportJson(request: Request, maxBytes = MAX_IMPORT_FILE_SIZE_BYTES): Promise<unknown> {
  return parseBoundedBody(request, maxBytes, "Payload JSON invalide.", (body) => body.json());
}

export function readImportFormData(request: Request): Promise<FormData> {
  // A file at the 50 MiB domain limit still needs space for fields and MIME framing.
  return parseBoundedBody(request, MAX_IMPORT_FILE_SIZE_BYTES + multipartEnvelopeBytes,
    "Payload multipart invalide.", (body) => body.formData());
}

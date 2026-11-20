import { badRequest, payloadTooLarge } from "@/lib/http/api-response";

/**
 * A bounded JSON body: 1 MB by default, the largest body of the material request routes being 300 lines or a pasted
 * message of 20,000 characters (their files go from the browser to storage). A route reading more passes its own
 * limit. Refusals are the shared `ApiError`s: 413 beyond the limit, 400 for a body that is not JSON.
 */
const JSON_MAX_BYTES = 1024 * 1024;

export async function readJsonBody(
  request: Request,
  { maxBytes = JSON_MAX_BYTES, tooLargeMessage = "Le corps de la requête dépasse la taille autorisée." }:
    { maxBytes?: number; tooLargeMessage?: string } = {},
): Promise<unknown> {
  const tooLarge = () => payloadTooLarge(tooLargeMessage);
  const invalid = () => badRequest("Payload JSON invalide.");
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
  if (!request.body) throw invalid();

  let received = 0;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) throw tooLarge();
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(bounded).json();
  } catch {
    // A Fetch decoder may wrap the stream error in its own TypeError.
    throw received > maxBytes ? tooLarge() : invalid();
  }
}

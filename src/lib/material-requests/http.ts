import { z } from "zod";

import { badRequest, payloadTooLarge } from "@/lib/estimates/errors";

/** What the material request routes share: identifiers of the URL and a bounded JSON body. */

const id = (name: string) => z.string().uuid(`${name} invalide.`);

export const projectParamsSchema = z.object({ projectId: id("projectId") });
export const requestParamsSchema = projectParamsSchema.extend({ requestId: id("requestId") });
export const lineParamsSchema = requestParamsSchema.extend({ lineId: id("lineId") });
export const fileParamsSchema = requestParamsSchema.extend({ fileId: id("fileId") });
export const technicianParamsSchema = z.object({ technicianId: id("technicianId") });

/**
 * The largest JSON body is 300 lines or a pasted message of 20,000 characters. No route here receives
 * a file: originals go from the browser to storage (files-server.ts).
 */
const JSON_MAX_BYTES = 1024 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const tooLarge = () => payloadTooLarge("Le corps de la requête dépasse la taille autorisée.");
  const invalid = () => badRequest("Payload JSON invalide.");
  if (Number(request.headers.get("content-length")) > JSON_MAX_BYTES) throw tooLarge();
  if (!request.body) throw invalid();

  let received = 0;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > JSON_MAX_BYTES) throw tooLarge();
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(bounded).json();
  } catch {
    // A Fetch decoder may wrap the stream error in its own TypeError.
    throw received > JSON_MAX_BYTES ? tooLarge() : invalid();
  }
}

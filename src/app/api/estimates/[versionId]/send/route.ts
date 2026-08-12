import { z } from "zod";

import { sendEstimateEmail } from "@/lib/email/send-estimate";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { sendEstimateSchema } from "@/lib/estimates/schemas";

export const runtime = "nodejs";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});
const idempotencyKeySchema = z.string().uuid("Idempotency-Key invalide.");

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const payload = sendEstimateSchema.parse(await parseJsonBody(request));
    const rawIdempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!rawIdempotencyKey) {
      throw badRequest(
        "En-tete Idempotency-Key obligatoire.",
        undefined,
        "IDEMPOTENCY_KEY_REQUIRED"
      );
    }
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const data = await sendEstimateEmail({
      versionId,
      payload,
      requestUrl: request.url,
      idempotencyKey,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

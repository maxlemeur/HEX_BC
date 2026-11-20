import { z } from "zod";

import { parseEstimateEmailReceipt } from "@/lib/email/send-estimate-contract";
import { sendEstimateEmail } from "@/lib/email/send-estimate";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { sendEstimateSchema } from "@/lib/estimates/schemas";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER, normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export const runtime = "nodejs";

const idempotencyKeySchema = z.string().uuid("Idempotency-Key invalide.");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const payload = sendEstimateSchema.parse(await parseJsonBody(request, badRequest));
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
      concurrencyToken: request.headers.get("if-match"),
      draftLockSessionId: normalizeEstimateDraftLockSessionId(request.headers.get(ESTIMATE_DRAFT_LOCK_SESSION_HEADER)),
    });
    return ok(parseEstimateEmailReceipt(data, { versionId, requestId: idempotencyKey }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

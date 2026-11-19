import { parseEstimateStatusResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { patchEstimateStatusSchema } from "@/lib/estimates/schemas";
import { patchEstimateStatus } from "@/lib/estimates/version-lifecycle-server";
import {
  ESTIMATE_DRAFT_LOCK_SESSION_HEADER,
  normalizeEstimateDraftLockSessionId,
} from "@/lib/estimates/lock-session";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

function resolveConcurrencyToken(request: Request) {
  const ifMatch = request.headers.get("if-match")?.trim();
  if (ifMatch && ifMatch.length > 0) {
    return ifMatch;
  }

  return undefined;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = patchEstimateStatusSchema.parse(await parseJsonBody(request, badRequest));
    const token = resolveConcurrencyToken(request);
    if (!token) {
      throw badRequest("Jeton de concurrence manquant.");
    }
    const sessionHeader = request.headers.get(ESTIMATE_DRAFT_LOCK_SESSION_HEADER);
    const data = sessionHeader === null
      ? await patchEstimateStatus(versionId, body, token)
      : await patchEstimateStatus(versionId, body, token, {
          draftLockSessionId: normalizeEstimateDraftLockSessionId(sessionHeader),
        });
    return ok(validateEstimateResponse(() => parseEstimateStatusResponse(data, versionId, body.status)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

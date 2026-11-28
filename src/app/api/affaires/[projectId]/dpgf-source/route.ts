import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseLinkedDpgfSourceResponse } from "@/lib/estimates/section-copy-response";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { getAffaireLinkedDpgfSource } from "@/lib/estimates/linked-dpgf-read-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");

    const data = await getAffaireLinkedDpgfSource(projectId);
    return ok(validateEstimateResponse(() => parseLinkedDpgfSourceResponse(data)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

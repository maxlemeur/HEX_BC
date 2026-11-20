import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { reviewVersionZeroLineSchema } from "@/lib/estimates/schemas";
import { reviewVersionZeroLine } from "@/lib/estimates/version-zero-drafts";
import { parseJsonBody, uuidRouteParams } from "@/lib/http/request";

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      versionId: string;
      draftId: string;
      lineDraftId: string;
    }>;
  }
) {
  try {
    const { versionId, draftId, lineDraftId } = await uuidRouteParams(params, "versionId", "draftId", "lineDraftId");
    const body = reviewVersionZeroLineSchema.parse(await parseJsonBody(request, badRequest));
    const data = await reviewVersionZeroLine({
      versionId,
      draftId,
      lineDraftId,
      reviewStatus: body.review_status,
      editedValues: body.edited_values,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

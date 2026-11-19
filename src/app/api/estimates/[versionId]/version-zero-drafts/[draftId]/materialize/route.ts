import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParams } from "@/lib/http/request";
import { materializeVersionZeroDraft } from "@/lib/estimates/version-zero-drafts";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; draftId: string }> }
) {
  try {
    const { versionId, draftId } = await uuidRouteParams(params, "versionId", "draftId");
    const data = await materializeVersionZeroDraft({ versionId, draftId });
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

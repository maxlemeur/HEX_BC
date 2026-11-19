import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParam } from "@/lib/http/request";
import { getEstimatePdfLayoutConfiguration } from "@/lib/estimates/pdf-generator";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    return ok(await getEstimatePdfLayoutConfiguration(versionId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

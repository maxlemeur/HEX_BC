import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBodyOrEmptyObject } from "@/lib/http/request";
import { materialRequestPhotoAnalysisInputSchema } from "@/lib/material-requests/photo-analysis";
import { fileParamsSchema } from "@/lib/material-requests/http";
import { analyzeMaterialRequestPhoto } from "@/lib/material-requests/photo-analysis-server";

type Context = { params: Promise<{ projectId: string; requestId: string; fileId: string }> };

/**
 * The AI reading of one original: draft lines, in reading order, that the screen adds through the routes of the
 * lines. Nothing is written here. 409 MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE where no reading can run for the
 * caller, 503 MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED when the reading gave no lines.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    const settings = materialRequestPhotoAnalysisInputSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    return ok(await analyzeMaterialRequestPhoto(projectId, requestId, fileId, settings, { signal: request.signal }));
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return toErrorResponse(error);
  }
}

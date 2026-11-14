import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { replaceMaterialRequestLinesSchema } from "@/lib/material-requests/contracts";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { replaceMaterialRequestLines } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/**
 * Splits the message again: the request's draft lines, as the screen named them, give way to the lines read again.
 * 409 MATERIAL_REQUEST_LINES_CHANGED or MATERIAL_REQUEST_LINES_KEPT, and nothing is written, otherwise.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const input = replaceMaterialRequestLinesSchema.parse(await readJsonBody(request));
    return ok(await replaceMaterialRequestLines(projectId, requestId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

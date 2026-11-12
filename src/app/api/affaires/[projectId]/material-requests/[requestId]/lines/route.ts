import { ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  bulkUpdateMaterialRequestLinesSchema,
  createMaterialRequestLinesSchema,
} from "@/lib/material-requests/contracts";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { bulkUpdateMaterialRequestLines, createMaterialRequestLines } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const { lines } = createMaterialRequestLinesSchema.parse(await readJsonBody(request));
    return ok(await createMaterialRequestLines(projectId, requestId, lines), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** One change applied to a selection of lines. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const input = bulkUpdateMaterialRequestLinesSchema.parse(await readJsonBody(request));
    return ok(await bulkUpdateMaterialRequestLines(projectId, requestId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

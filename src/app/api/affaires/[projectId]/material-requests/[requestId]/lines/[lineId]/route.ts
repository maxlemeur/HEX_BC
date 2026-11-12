import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateMaterialRequestLineSchema } from "@/lib/material-requests/contracts";
import { lineParamsSchema, readJsonBody } from "@/lib/material-requests/http";
import { deleteMaterialRequestLine, updateMaterialRequestLine } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string; lineId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, lineId } = lineParamsSchema.parse(await params);
    const input = updateMaterialRequestLineSchema.parse(await readJsonBody(request));
    return ok(await updateMaterialRequestLine(projectId, requestId, lineId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId, lineId } = lineParamsSchema.parse(await params);
    return ok(await deleteMaterialRequestLine(projectId, requestId, lineId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

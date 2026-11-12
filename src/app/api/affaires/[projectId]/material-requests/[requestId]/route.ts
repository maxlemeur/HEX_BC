import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateMaterialRequestSchema } from "@/lib/material-requests/contracts";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { deleteMaterialRequest, getMaterialRequestDetail, updateMaterialRequest } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    return ok(await getMaterialRequestDetail(projectId, requestId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const input = updateMaterialRequestSchema.parse(await readJsonBody(request));
    return ok(await updateMaterialRequest(projectId, requestId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    return ok(await deleteMaterialRequest(projectId, requestId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

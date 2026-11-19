import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { updateEstimateAssemblySchema } from "@/lib/estimates/schemas";
import {
  deleteEstimateAssembly,
  getEstimateAssembly,
  updateEstimateAssembly,
} from "@/lib/estimates/server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assemblyId: string }> }
) {
  try {
    const assemblyId = await uuidRouteParam(params, "assemblyId");
    const data = await getEstimateAssembly(assemblyId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assemblyId: string }> }
) {
  try {
    const assemblyId = await uuidRouteParam(params, "assemblyId");
    const body = updateEstimateAssemblySchema.parse(await parseJsonBody(request, badRequest));
    const data = await updateEstimateAssembly(assemblyId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assemblyId: string }> }
) {
  try {
    const assemblyId = await uuidRouteParam(params, "assemblyId");
    const data = await deleteEstimateAssembly(assemblyId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

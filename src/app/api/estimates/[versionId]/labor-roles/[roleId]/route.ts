import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { updateLaborRoleSchema } from "@/lib/estimates/schemas";
import { updateLaborRole } from "@/lib/estimates/reference-data-server";
import { parseJsonBody, uuidRouteParams } from "@/lib/http/request";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string; roleId: string }> }
) {
  try {
    const { versionId, roleId } = await uuidRouteParams(params, "versionId", "roleId");
    const body = updateLaborRoleSchema.parse(await parseJsonBody(request, badRequest));
    const data = await updateLaborRole(versionId, roleId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

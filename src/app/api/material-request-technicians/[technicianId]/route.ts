import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateMaterialRequestTechnicianSchema } from "@/lib/material-requests/contracts";
import { readJsonBody, technicianParamsSchema } from "@/lib/material-requests/http";
import { updateMaterialRequestTechnician } from "@/lib/material-requests/technicians-server";

type Context = { params: Promise<{ technicianId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { technicianId } = technicianParamsSchema.parse(await params);
    const input = updateMaterialRequestTechnicianSchema.parse(await readJsonBody(request));
    return ok(await updateMaterialRequestTechnician(technicianId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

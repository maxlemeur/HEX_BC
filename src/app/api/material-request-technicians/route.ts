import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { createMaterialRequestTechnicianSchema } from "@/lib/material-requests/contracts";
import { readJsonBody } from "@/lib/material-requests/http";
import {
  createMaterialRequestTechnician,
  listMaterialRequestTechnicians,
} from "@/lib/material-requests/technicians-server";

// TI-690: the technicians of the active tenant, a plain list of names. Rights are checked in the domain module.

export async function GET() {
  try {
    return ok(await listMaterialRequestTechnicians());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createMaterialRequestTechnicianSchema.parse(await readJsonBody(request));
    return ok(await createMaterialRequestTechnician(input), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

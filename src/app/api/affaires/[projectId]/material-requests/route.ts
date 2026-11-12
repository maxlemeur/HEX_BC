import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { createMaterialRequestSchema } from "@/lib/material-requests/contracts";
import { projectParamsSchema, readJsonBody } from "@/lib/material-requests/http";
import { createMaterialRequest, listMaterialRequests } from "@/lib/material-requests/server";

// TI-690: the material requests of an affaire. Rights are checked in the domain module.

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId } = projectParamsSchema.parse(await params);
    return ok(await listMaterialRequests(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId } = projectParamsSchema.parse(await params);
    const input = createMaterialRequestSchema.parse(await readJsonBody(request));
    return ok(await createMaterialRequest(projectId, input), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

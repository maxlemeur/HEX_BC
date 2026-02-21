import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateEstimateAssemblySchema } from "@/lib/estimates/schemas";
import {
  deleteEstimateAssembly,
  getEstimateAssembly,
  updateEstimateAssembly,
} from "@/lib/estimates/server";

const paramsSchema = z.object({
  assemblyId: z.string().uuid("assemblyId invalide."),
});

async function getAssemblyId(paramsPromise: Promise<{ assemblyId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).assemblyId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assemblyId: string }> }
) {
  try {
    const assemblyId = await getAssemblyId(params);
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
    const assemblyId = await getAssemblyId(params);
    const body = updateEstimateAssemblySchema.parse(await parseJsonBody(request));
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
    const assemblyId = await getAssemblyId(params);
    const data = await deleteEstimateAssembly(assemblyId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

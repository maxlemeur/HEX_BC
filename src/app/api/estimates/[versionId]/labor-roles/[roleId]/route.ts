import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateLaborRoleSchema } from "@/lib/estimates/schemas";
import { updateLaborRole } from "@/lib/estimates/server";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  roleId: z.string().uuid("roleId invalide."),
});

async function getParams(
  paramsPromise: Promise<{ versionId: string; roleId: string }>
) {
  const params = await paramsPromise;
  return paramsSchema.parse(params);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string; roleId: string }> }
) {
  try {
    const { versionId, roleId } = await getParams(params);
    const body = updateLaborRoleSchema.parse(await parseJsonBody(request));
    const data = await updateLaborRole(versionId, roleId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

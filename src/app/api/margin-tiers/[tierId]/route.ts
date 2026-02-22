import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateMarginTierSchema } from "@/lib/estimates/schemas";
import { deleteMarginTier, updateMarginTier } from "@/lib/estimates/server";

const paramsSchema = z.object({
  tierId: z.string().uuid("tierId invalide."),
});

async function getTierId(paramsPromise: Promise<{ tierId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).tierId;
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
  { params }: { params: Promise<{ tierId: string }> }
) {
  try {
    const tierId = await getTierId(params);
    const body = updateMarginTierSchema.parse(await parseJsonBody(request));
    const data = await updateMarginTier(tierId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tierId: string }> }
) {
  try {
    const tierId = await getTierId(params);
    const data = await deleteMarginTier(tierId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

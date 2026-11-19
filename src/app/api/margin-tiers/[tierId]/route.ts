import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { updateMarginTierSchema } from "@/lib/estimates/schemas";
import { deleteMarginTier, updateMarginTier } from "@/lib/estimates/server";
import { parseJsonBody } from "@/lib/http/request";

const paramsSchema = z.object({
  tierId: z.string().uuid("tierId invalide."),
});

async function getTierId(paramsPromise: Promise<{ tierId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).tierId;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tierId: string }> }
) {
  try {
    const tierId = await getTierId(params);
    const body = updateMarginTierSchema.parse(await parseJsonBody(request, badRequest));
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

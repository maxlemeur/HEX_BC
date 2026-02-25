import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { deletePlanSet, getPlanSet, planSetIdSchema } from "@/lib/takeoff/plans";

const paramsSchema = z
  .object({
    setId: planSetIdSchema,
  })
  .strict();

async function getSetId(paramsPromise: Promise<{ setId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).setId;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const data = await deletePlanSet(setId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const data = await getPlanSet(setId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

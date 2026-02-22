import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createEstimateVariantSchema,
  promoteEstimateVariantSchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateVariant,
  promoteEstimateVariant,
} from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBodyOrDefault(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    createEstimateVariantSchema.parse(await parseJsonBodyOrDefault(request));
    const data = await createEstimateVariant(versionId);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    promoteEstimateVariantSchema.parse(await parseJsonBodyOrDefault(request));
    const data = await promoteEstimateVariant(versionId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

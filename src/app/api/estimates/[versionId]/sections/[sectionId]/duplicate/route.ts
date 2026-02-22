import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { duplicateEstimateSectionSchema } from "@/lib/estimates/schemas";
import { duplicateSectionFromVersion } from "@/lib/estimates/server";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  sectionId: z.string().uuid("sectionId invalide."),
});

async function getParams(
  paramsPromise: Promise<{ versionId: string; sectionId: string }>
) {
  const params = await paramsPromise;
  return paramsSchema.parse(params);
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
  { params }: { params: Promise<{ versionId: string; sectionId: string }> }
) {
  try {
    const { versionId, sectionId } = await getParams(params);
    const body = duplicateEstimateSectionSchema.parse(
      await parseJsonBodyOrDefault(request)
    );
    const data = await duplicateSectionFromVersion(versionId, sectionId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseDuplicateSectionResponse } from "@/lib/estimates/section-copy-response";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { duplicateEstimateSectionSchema } from "@/lib/estimates/schemas";
import { duplicateSectionFromVersion } from "@/lib/estimates/server";
import { parseJsonBodyOrEmptyObject } from "@/lib/http/request";

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; sectionId: string }> }
) {
  try {
    const { versionId, sectionId } = await getParams(params);
    const body = duplicateEstimateSectionSchema.parse(
      await parseJsonBodyOrEmptyObject(request, badRequest)
    );
    const data = await duplicateSectionFromVersion(versionId, sectionId, body);
    return ok(validateEstimateResponse(() => parseDuplicateSectionResponse(data, { sourceVersionId: versionId, targetVersionId: body.target_version_id ?? versionId })), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

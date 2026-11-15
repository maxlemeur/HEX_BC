import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseImportLinkedDpgfResponse } from "@/lib/estimates/section-copy-response";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { importLinkedDpgfSourceSchema } from "@/lib/estimates/schemas";
import { importLinkedDpgfSourceIntoVersion } from "@/lib/estimates/server";
import { parseJsonBodyOrEmptyObject } from "@/lib/http/request";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = importLinkedDpgfSourceSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    const data = await importLinkedDpgfSourceIntoVersion(versionId, body);
    return ok(validateEstimateResponse(() => parseImportLinkedDpgfResponse(data, versionId)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

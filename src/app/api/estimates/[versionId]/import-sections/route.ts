import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseImportSectionsResponse } from "@/lib/estimates/section-copy-response";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { importEstimateSectionsSchema } from "@/lib/estimates/schemas";
import { importSectionsFromVersion } from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
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
    const body = importEstimateSectionsSchema.parse(await parseJsonBody(request));
    const data = await importSectionsFromVersion(versionId, body);
    return ok(validateEstimateResponse(() => parseImportSectionsResponse(data, { sourceVersionId: body.source_version_id, targetVersionId: versionId, mode: body.mode })), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

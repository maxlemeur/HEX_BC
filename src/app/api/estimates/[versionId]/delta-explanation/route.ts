import { z } from "zod";

import {
  estimateDeltaExplanationQuerySchema,
  estimateExplanationResponseSchema,
} from "@/lib/estimates/explanation-schemas";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getEstimateDeltaExplanation } from "@/lib/estimates/explanations";

export const runtime = "nodejs";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return estimateDeltaExplanationQuerySchema.parse({
    compare_version_id: searchParams.get("compare_version_id"),
    detail: searchParams.get("detail") ?? undefined,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const parsedParams = paramsSchema.parse(await params);
    const query = parseQuery(request);
    const explanation = await getEstimateDeltaExplanation({
      versionId: parsedParams.versionId,
      compareVersionId: query.compare_version_id,
      includeDetail: query.detail,
    });

    return ok(
      estimateExplanationResponseSchema.parse({
        explanation,
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

import { z } from "zod";

import {
  estimateExplanationDetailQuerySchema,
  estimateExplanationResponseSchema,
} from "@/lib/estimates/explanation-schemas";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getEstimateLineExplanation } from "@/lib/estimates/explanations";

export const runtime = "nodejs";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  lineId: z.string().uuid("lineId invalide."),
});

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return estimateExplanationDetailQuerySchema.parse({
    detail: searchParams.get("detail") ?? undefined,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string; lineId: string }> }
) {
  try {
    const parsedParams = paramsSchema.parse(await params);
    const query = parseQuery(request);
    const explanation = await getEstimateLineExplanation({
      versionId: parsedParams.versionId,
      lineId: parsedParams.lineId,
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

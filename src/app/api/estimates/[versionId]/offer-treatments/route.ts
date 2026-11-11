import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { setOfferTreatmentsSchema } from "@/lib/estimates/offer-treatment-plan";
import { setEstimateLineOfferTreatments } from "@/lib/estimates/offer-treatment-server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

/** TI-682: saves the internal reasons of exclusions and the reserves written in the offer of an engine 3 draft. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = versionIdParamSchema.parse(await params);
    const body = setOfferTreatmentsSchema.parse(await parseJsonBody(request));
    return ok(await setEstimateLineOfferTreatments(versionId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}

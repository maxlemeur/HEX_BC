import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { trackSuggestionCorrectionsSchema } from "@/lib/estimates/schemas";
import { getLearnings, trackCorrection } from "@/lib/estimates/suggestion-learning";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getParams(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = await getParams(params);
    const data = await getLearnings({
      versionId,
      includeInactive: false,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = await getParams(params);
    const body = trackSuggestionCorrectionsSchema.parse(await parseJsonBody(request));
    const data = await trackCorrection({
      versionId,
      corrections: body.corrections.map((correction) => ({
        rule_id: correction.rule_id,
        field_name: correction.field_name,
        original_value: correction.original_value ?? null,
        corrected_value: correction.corrected_value ?? null,
        item_title: correction.item_title,
      })),
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

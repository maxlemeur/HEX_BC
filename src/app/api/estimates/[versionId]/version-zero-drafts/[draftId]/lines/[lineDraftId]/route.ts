import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { reviewVersionZeroLineSchema } from "@/lib/estimates/schemas";
import { reviewVersionZeroLine } from "@/lib/estimates/version-zero-drafts";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  lineDraftId: z.string().uuid("lineDraftId invalide."),
});

async function getParams(
  paramsPromise: Promise<{
    versionId: string;
    draftId: string;
    lineDraftId: string;
  }>
) {
  return paramsSchema.parse(await paramsPromise);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      versionId: string;
      draftId: string;
      lineDraftId: string;
    }>;
  }
) {
  try {
    const { versionId, draftId, lineDraftId } = await getParams(params);
    const body = reviewVersionZeroLineSchema.parse(await parseJsonBody(request));
    const data = await reviewVersionZeroLine({
      versionId,
      draftId,
      lineDraftId,
      reviewStatus: body.review_status,
      editedValues: body.edited_values
        ? {
            title: body.edited_values.title ?? null,
            description: body.edited_values.description ?? null,
            quantity: body.edited_values.quantity ?? null,
            unit: body.edited_values.unit ?? null,
          }
        : undefined,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

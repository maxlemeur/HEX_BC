import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { instantiateEstimateFromTemplateSchema } from "@/lib/estimates/schemas";
import { instantiateEstimateFromTemplate } from "@/lib/estimates/server";

const paramsSchema = z.object({
  templateId: z.string().uuid("templateId invalide."),
});

async function getTemplateId(paramsPromise: Promise<{ templateId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).templateId;
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
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await getTemplateId(params);
    const body = instantiateEstimateFromTemplateSchema.parse(
      await parseJsonBody(request)
    );
    const data = await instantiateEstimateFromTemplate(templateId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

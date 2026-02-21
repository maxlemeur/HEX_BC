import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { duplicateEstimateTemplateSchema } from "@/lib/estimates/schemas";
import { duplicateEstimateTemplate } from "@/lib/estimates/server";

const paramsSchema = z.object({
  templateId: z.string().uuid("templateId invalide."),
});

async function getTemplateId(paramsPromise: Promise<{ templateId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).templateId;
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
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await getTemplateId(params);
    const body = duplicateEstimateTemplateSchema.parse(
      await parseJsonBodyOrDefault(request)
    );
    const data = await duplicateEstimateTemplate(templateId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

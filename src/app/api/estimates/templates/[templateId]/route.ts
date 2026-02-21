import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateEstimateTemplateSchema } from "@/lib/estimates/schemas";
import {
  deleteEstimateTemplate,
  getEstimateTemplate,
  updateEstimateTemplate,
} from "@/lib/estimates/server";

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await getTemplateId(params);
    const data = await getEstimateTemplate(templateId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await getTemplateId(params);
    const body = updateEstimateTemplateSchema.parse(await parseJsonBody(request));
    const data = await updateEstimateTemplate(templateId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await getTemplateId(params);
    const data = await deleteEstimateTemplate(templateId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

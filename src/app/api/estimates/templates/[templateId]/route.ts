import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { updateEstimateTemplateSchema } from "@/lib/estimates/schemas";
import {
  deleteEstimateTemplate,
  getEstimateTemplate,
  updateEstimateTemplate,
} from "@/lib/estimates/templates-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await uuidRouteParam(params, "templateId");
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
    const templateId = await uuidRouteParam(params, "templateId");
    const body = updateEstimateTemplateSchema.parse(await parseJsonBody(request, badRequest));
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
    const templateId = await uuidRouteParam(params, "templateId");
    const data = await deleteEstimateTemplate(templateId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

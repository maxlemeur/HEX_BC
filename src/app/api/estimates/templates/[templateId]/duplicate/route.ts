import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { duplicateEstimateTemplateSchema } from "@/lib/estimates/schemas";
import { duplicateEstimateTemplate } from "@/lib/estimates/templates-server";
import { parseJsonBodyOrEmptyObject, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await uuidRouteParam(params, "templateId");
    const body = duplicateEstimateTemplateSchema.parse(
      await parseJsonBodyOrEmptyObject(request, badRequest)
    );
    const data = await duplicateEstimateTemplate(templateId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

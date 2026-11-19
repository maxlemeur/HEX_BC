import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { instantiateEstimateFromTemplateSchema } from "@/lib/estimates/schemas";
import { instantiateEstimateFromTemplate } from "@/lib/estimates/templates-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await uuidRouteParam(params, "templateId");
    const body = instantiateEstimateFromTemplateSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await instantiateEstimateFromTemplate(templateId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

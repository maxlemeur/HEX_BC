import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { insertTemplateIntoVersionSchema } from "@/lib/estimates/schemas";
import { insertTemplateIntoVersion } from "@/lib/estimates/assemblies-server";
import { uuidRouteParam, parseJsonBodyOrEmptyObject } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await uuidRouteParam(params, "templateId");
    const { searchParams } = new URL(request.url);
    const body = await parseJsonBodyOrEmptyObject(request, badRequest);

    const payload = insertTemplateIntoVersionSchema.parse({
      versionId: searchParams.get("versionId"),
      ...(body && typeof body === "object" ? body : {}),
    });

    const data = await insertTemplateIntoVersion({
      templateId,
      versionId: payload.version_id,
      afterItemId: payload.after_item_id ?? null,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

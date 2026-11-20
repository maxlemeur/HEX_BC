import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { insertAssemblyIntoVersionSchema } from "@/lib/estimates/schemas";
import { insertAssemblyIntoVersion } from "@/lib/estimates/assemblies-server";
import { uuidRouteParam, parseJsonBodyOrEmptyObject } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assemblyId: string }> }
) {
  try {
    const assemblyId = await uuidRouteParam(params, "assemblyId");
    const { searchParams } = new URL(request.url);
    const body = await parseJsonBodyOrEmptyObject(request, badRequest);

    const payload = insertAssemblyIntoVersionSchema.parse({
      versionId: searchParams.get("versionId"),
      ...(body && typeof body === "object" ? body : {}),
    });

    const data = await insertAssemblyIntoVersion({
      assemblyId,
      versionId: payload.version_id,
      afterItemId: payload.after_item_id ?? null,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

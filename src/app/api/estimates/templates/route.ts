import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import {
  createEstimateTemplateFromVersionSchema,
  listEstimateTemplatesQuerySchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateTemplateFromVersion,
  listEstimateTemplates,
} from "@/lib/estimates/templates-server";
import { parseJsonBody, parsePositiveIntParam } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = listEstimateTemplatesQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveIntParam(searchParams.get("limit"), badRequest) ?? 10,
      order: searchParams.get("order") ?? undefined,
    });

    const data = await listEstimateTemplates(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createEstimateTemplateFromVersionSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await createEstimateTemplateFromVersion(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

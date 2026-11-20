import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import {
  createEstimateAssemblySchema,
  listEstimateAssembliesQuerySchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateAssembly,
  listEstimateAssemblies,
} from "@/lib/estimates/server";
import { parseJsonBody, parsePositiveIntParam } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = listEstimateAssembliesQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveIntParam(searchParams.get("limit"), badRequest) ?? 20,
      order: searchParams.get("order") ?? undefined,
    });

    const data = await listEstimateAssemblies(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createEstimateAssemblySchema.parse(await parseJsonBody(request, badRequest));
    const data = await createEstimateAssembly(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

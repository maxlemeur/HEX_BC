import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createEstimateAssemblySchema,
  listEstimateAssembliesQuerySchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateAssembly,
  listEstimateAssemblies,
} from "@/lib/estimates/server";

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest("Parametre limit invalide.");
  }

  return parsed;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = listEstimateAssembliesQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveInt(searchParams.get("limit")) ?? 20,
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
    const body = createEstimateAssemblySchema.parse(await parseJsonBody(request));
    const data = await createEstimateAssembly(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

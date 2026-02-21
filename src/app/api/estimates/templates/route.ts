import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createEstimateTemplateFromVersionSchema,
  listEstimateTemplatesQuerySchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateTemplateFromVersion,
  listEstimateTemplates,
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

    const query = listEstimateTemplatesQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveInt(searchParams.get("limit")) ?? 10,
      order: searchParams.get("order"),
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
      await parseJsonBody(request)
    );
    const data = await createEstimateTemplateFromVersion(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

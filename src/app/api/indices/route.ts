import {
  badRequest,
  bulkUpsertMaterialIndices,
  createMaterialIndex,
  deleteMaterialIndex,
  listMaterialIndices,
  ok,
  toErrorResponse,
  updateMaterialIndex,
} from "@/lib/catalogue/server";
import { indicesActionSchema, indicesListQuerySchema } from "@/lib/catalogue/schemas";

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

    const query = indicesListQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveInt(searchParams.get("limit")) ?? 200,
    });

    const data = await listMaterialIndices(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const payload = indicesActionSchema.parse(body);

    switch (payload.action) {
      case "create": {
        const data = await createMaterialIndex(payload.item);
        return ok(data, 201);
      }
      case "update": {
        const data = await updateMaterialIndex(payload);
        return ok(data);
      }
      case "delete": {
        const data = await deleteMaterialIndex(payload.id);
        return ok(data);
      }
      case "bulk-upsert": {
        const data = await bulkUpsertMaterialIndices(payload.items);
        return ok(data);
      }
      default:
        throw badRequest("Action indices non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

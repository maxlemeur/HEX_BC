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
import { parseJsonBody, parsePositiveIntParam } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = indicesListQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveIntParam(searchParams.get("limit"), badRequest) ?? 200,
    });

    const data = await listMaterialIndices(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, badRequest);
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

import {
  badRequest,
  createMissingPriceImportEntities,
  ok,
  toErrorResponse,
} from "@/lib/catalogue/server";
import { createMissingPriceImportEntitiesSchema } from "@/lib/catalogue/schemas";
import { parseJsonBody } from "@/lib/http/request";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, badRequest);
    const payload = createMissingPriceImportEntitiesSchema.parse(body);
    const data = await createMissingPriceImportEntities(payload);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

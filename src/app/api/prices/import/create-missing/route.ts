import {
  badRequest,
  createMissingPriceImportEntities,
  ok,
  toErrorResponse,
} from "@/lib/catalogue/server";
import { createMissingPriceImportEntitiesSchema } from "@/lib/catalogue/schemas";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const payload = createMissingPriceImportEntitiesSchema.parse(body);
    const data = await createMissingPriceImportEntities(payload);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

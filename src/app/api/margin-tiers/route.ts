import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { createMarginTierSchema } from "@/lib/estimates/schemas";
import { createMarginTier } from "@/lib/estimates/server";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const body = createMarginTierSchema.parse(await parseJsonBody(request));
    const data = await createMarginTier(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

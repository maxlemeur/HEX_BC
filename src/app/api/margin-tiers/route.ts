import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { createMarginTierSchema } from "@/lib/estimates/schemas";
import { createMarginTier } from "@/lib/estimates/server";
import { parseJsonBody } from "@/lib/http/request";

export async function POST(request: Request) {
  try {
    const body = createMarginTierSchema.parse(await parseJsonBody(request, badRequest));
    const data = await createMarginTier(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

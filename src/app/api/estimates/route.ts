import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { createEstimateSchema } from "@/lib/estimates/schemas";
import { createEstimate, listLatestEstimates } from "@/lib/estimates/server";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET() {
  try {
    const data = await listLatestEstimates();
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createEstimateSchema.parse(await parseJsonBody(request));
    const data = await createEstimate(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

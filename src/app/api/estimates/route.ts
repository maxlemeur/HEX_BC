import { parseCreateEstimateResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { createEstimateSchema } from "@/lib/estimates/schemas";
import { createEstimate, listLatestEstimates } from "@/lib/estimates/server";
import { parseJsonBody } from "@/lib/http/request";

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
    const body = createEstimateSchema.parse(await parseJsonBody(request, badRequest));
    const data = await createEstimate(body);
    return ok(validateEstimateResponse(() => parseCreateEstimateResponse(data, body.project_id)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

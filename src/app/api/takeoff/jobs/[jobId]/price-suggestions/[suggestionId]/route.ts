import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { reviewTakeoffPriceSuggestion } from "@/lib/takeoff/server";

async function getParams(
  paramsPromise: Promise<{ jobId: string; suggestionId: string }>
) {
  return await paramsPromise;
}

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ jobId: string; suggestionId: string }>;
  }
) {
  try {
    const { jobId, suggestionId } = await getParams(params);
    const body = await request.json();
    const data = await reviewTakeoffPriceSuggestion(jobId, suggestionId, body);

    return ok(data);
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

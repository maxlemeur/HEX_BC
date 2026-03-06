import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
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
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

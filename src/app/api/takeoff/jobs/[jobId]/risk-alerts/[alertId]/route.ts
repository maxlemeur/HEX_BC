import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { updateTakeoffRiskAlertStatus } from "@/lib/takeoff/server";

async function getParams(
  paramsPromise: Promise<{ jobId: string; alertId: string }>
) {
  return await paramsPromise;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string; alertId: string }> }
) {
  try {
    const { jobId, alertId } = await getParams(params);
    const body = await request.json();
    const data = await updateTakeoffRiskAlertStatus(jobId, alertId, body);

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

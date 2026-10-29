import { parseTakeoffJobCompareResponse } from "@/lib/takeoff/compare-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import {
  compareTakeoffJobs,
  parseCompareTakeoffJobsQuery,
} from "@/lib/takeoff/server";

function toQueryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

async function getJobId(paramsPromise: Promise<{ jobId: string }>) {
  return (await paramsPromise).jobId;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = await getJobId(params);
    const query = parseCompareTakeoffJobsQuery(toQueryObject(request));
    const data = await compareTakeoffJobs(jobId, query);

    return ok(parseTakeoffJobCompareResponse(data, { jobId, withJobId: query.with, threshold: query.threshold }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

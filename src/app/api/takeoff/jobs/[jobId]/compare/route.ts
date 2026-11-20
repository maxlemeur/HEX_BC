import { parseTakeoffJobCompareResponse } from "@/lib/takeoff/compare-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import {
  compareTakeoffJobs,
  parseCompareTakeoffJobsQuery,
} from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const query = parseCompareTakeoffJobsQuery(searchParamsObject(request));
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

import { parseTakeoffJobDetailResponse } from "@/lib/takeoff/job-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import {
  getTakeoffJobDetails,
  parseGetTakeoffJobDetailsQuery,
} from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const query = parseGetTakeoffJobDetailsQuery(searchParamsObject(request));
    const data = await getTakeoffJobDetails(jobId, query);
    return ok(parseTakeoffJobDetailResponse(data, { jobId, itemsLimit: query.items_limit, itemsOffset: query.items_offset }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

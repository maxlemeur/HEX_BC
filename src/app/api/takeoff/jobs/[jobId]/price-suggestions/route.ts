import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import {
  getTakeoffPriceSuggestion,
  parseTakeoffPriceSuggestionQuery,
  requestTakeoffPriceSuggestion,
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
    const query = parseTakeoffPriceSuggestionQuery(toQueryObject(request));
    const data = await getTakeoffPriceSuggestion(jobId, query);

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = await getJobId(params);
    const body = await request.json();
    const data = await requestTakeoffPriceSuggestion(jobId, body);

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

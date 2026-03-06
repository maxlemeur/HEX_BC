import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import {
  fetchTakeoffLineEvidencePanel,
  parseTakeoffLineEvidencePanelQuery,
} from "@/lib/takeoff/server";

function toQueryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

async function getParams(
  paramsPromise: Promise<{ jobId: string; lineId: string }>
) {
  return await paramsPromise;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string; lineId: string }> }
) {
  try {
    const { jobId, lineId } = await getParams(params);
    const query = parseTakeoffLineEvidencePanelQuery(toQueryObject(request));
    const data = await fetchTakeoffLineEvidencePanel(jobId, {
      ...query,
      line_id: lineId,
    });

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

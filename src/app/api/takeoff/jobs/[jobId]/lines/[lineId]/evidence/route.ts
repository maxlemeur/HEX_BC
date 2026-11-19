import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { parseTakeoffLineEvidencePanelResponse } from "@/lib/takeoff/line-evidence-contracts";
import {
  fetchTakeoffLineEvidencePanel,
  parseTakeoffLineEvidencePanelQuery,
} from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

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
    const query = parseTakeoffLineEvidencePanelQuery(searchParamsObject(request));
    const data = await fetchTakeoffLineEvidencePanel(jobId, {
      ...query,
      line_id: lineId,
    });

    return ok(parseTakeoffLineEvidencePanelResponse(data, {
      jobId, versionId: query.version_id, lineId,
    }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

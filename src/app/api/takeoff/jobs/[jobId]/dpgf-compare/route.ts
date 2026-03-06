import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { buildTakeoffRowRiskMap } from "@/lib/takeoff/risk-radar";
import {
  fetchTakeoffActiveRiskAlerts,
  fetchDpgfTakeoffComparison,
  parseTakeoffDpgfComparisonQuery,
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
    const query = parseTakeoffDpgfComparisonQuery(toQueryObject(request));
    const [data, alerts] = await Promise.all([
      fetchDpgfTakeoffComparison(jobId, query),
      fetchTakeoffActiveRiskAlerts(jobId, {
        version_id: query.version_id,
      }),
    ]);
    const lineRiskByLineId = buildTakeoffRowRiskMap(
      alerts.filter((item) => item.scope_type === "line")
    );

    return ok({
      ...data,
      rows: data.rows.map((row) => ({
        ...row,
        risk: lineRiskByLineId.get(row.line_id) ?? row.risk,
      })),
    });
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

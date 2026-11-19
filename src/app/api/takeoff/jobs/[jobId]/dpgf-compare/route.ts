import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { parseTakeoffDpgfComparisonResponse } from "@/lib/takeoff/dpgf-comparison-contracts";
import { buildTakeoffRowRiskMap } from "@/lib/takeoff/risk-radar";
import {
  fetchTakeoffActiveRiskAlerts,
  fetchDpgfTakeoffComparison,
  parseTakeoffDpgfComparisonQuery,
} from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const query = parseTakeoffDpgfComparisonQuery(searchParamsObject(request));
    const [data, alerts] = await Promise.all([
      fetchDpgfTakeoffComparison(jobId, query),
      fetchTakeoffActiveRiskAlerts(jobId, {
        version_id: query.version_id,
      }),
    ]);
    const lineRiskByLineId = buildTakeoffRowRiskMap(
      alerts.filter((item) => item.scope_type === "line")
    );

    const response = {
      ...data,
      rows: data.rows.map((row) => ({
        ...row,
        risk: lineRiskByLineId.get(row.line_id) ?? row.risk,
      })),
    };
    return ok(parseTakeoffDpgfComparisonResponse(response, {
      jobId, versionId: query.version_id, view: query.view, cursor: query.cursor,
    }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

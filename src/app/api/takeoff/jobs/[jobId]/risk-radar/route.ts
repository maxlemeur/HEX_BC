import { parseTakeoffRiskRadarResponse } from "@/lib/takeoff/risk-response-contracts";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import {
  fetchTakeoffRiskRadar,
  parseTakeoffRiskRadarQuery,
} from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const query = parseTakeoffRiskRadarQuery(searchParamsObject(request));
    const data = await fetchTakeoffRiskRadar(jobId, query);

    return ok(parseTakeoffRiskRadarResponse(data, { jobId, versionId: query.version_id, severity: query.severity, status: query.status, scope: query.scope, lotId: query.lot_id }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

import { parseTakeoffJobListResponse } from "@/lib/takeoff/job-response-contracts";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { listTakeoffJobs, parseListTakeoffJobsQuery } from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const query = parseListTakeoffJobsQuery(searchParamsObject(request));
    const data = await listTakeoffJobs(query);
    return ok(parseTakeoffJobListResponse(data, { versionId: query.estimate_version_id, projectId: query.project_id, status: query.status, level: query.level, limit: query.limit, offset: query.offset }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

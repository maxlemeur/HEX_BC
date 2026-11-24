import { NextResponse } from "next/server";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { listActivityCenterJobs } from "@/lib/takeoff/activity-center";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");

    if (!projectId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: "project_id requis.",
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    const jobId = searchParams.get("jobId");
    if (jobId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "BAD_REQUEST", message: "Identifiant d’analyse invalide.", retryable: false },
        },
        { status: 400 }
      );
    }

    const rawLimit = searchParams.has("limit")
      ? Number(searchParams.get("limit"))
      : undefined;
    const rawOffset = searchParams.has("offset")
      ? Number(searchParams.get("offset"))
      : undefined;
    const rawCompletionsOffset = searchParams.has("completionsOffset")
      ? Number(searchParams.get("completionsOffset"))
      : undefined;

    const data = await listActivityCenterJobs({
      project_id: projectId,
      versionId: searchParams.get("versionId"),
      lot: searchParams.get("lot"),
      planSetId: searchParams.get("planSetId"),
      status: searchParams.get("status"),
      level: searchParams.get("level"),
      period: searchParams.get("period"),
      jobId: jobId?.toLowerCase() ?? null,
      tracking: searchParams.get("view") === "tracking",
      limit:
        rawLimit != null && Number.isFinite(rawLimit) && rawLimit > 0
          ? rawLimit
          : undefined,
      offset:
        rawOffset != null && Number.isFinite(rawOffset) && rawOffset >= 0
          ? rawOffset
          : undefined,
      completionsOffset:
        rawCompletionsOffset != null && Number.isFinite(rawCompletionsOffset) && rawCompletionsOffset >= 0
          ? rawCompletionsOffset
          : undefined,
    });

    return ok(data);
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

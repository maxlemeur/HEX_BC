import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
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

    const rawLimit = searchParams.has("limit")
      ? Number(searchParams.get("limit"))
      : undefined;
    const rawOffset = searchParams.has("offset")
      ? Number(searchParams.get("offset"))
      : undefined;

    const data = await listActivityCenterJobs({
      project_id: projectId,
      versionId: searchParams.get("versionId"),
      lot: searchParams.get("lot"),
      planSetId: searchParams.get("planSetId"),
      status: searchParams.get("status"),
      level: searchParams.get("level"),
      period: searchParams.get("period"),
      limit:
        rawLimit != null && Number.isFinite(rawLimit) && rawLimit > 0
          ? rawLimit
          : undefined,
      offset:
        rawOffset != null && Number.isFinite(rawOffset) && rawOffset >= 0
          ? rawOffset
          : undefined,
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

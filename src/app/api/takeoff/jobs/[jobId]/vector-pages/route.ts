import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffVectorReading } from "@/lib/takeoff/vectors/read-server";

// TI-662: the vector reading of a takeoff job (pages, scale, groups, item geometry) for the review viewer.
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    return ok(await getTakeoffVectorReading(jobId));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), { status: error.status });
    }
    return toErrorResponse(error);
  }
}

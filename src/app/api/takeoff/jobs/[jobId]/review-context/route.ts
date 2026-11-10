import { NextResponse } from "next/server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffReviewContext } from "@/lib/takeoff/review-context-server";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await getTakeoffReviewContext((await params).jobId));
  } catch (error) {
    if (error instanceof TakeoffError) return NextResponse.json(toTakeoffErrorResponse(error), { status: error.status });
    return toErrorResponse(error);
  }
}

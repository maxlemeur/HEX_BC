import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-server";

// TI-682 lot D: the pages of this takeoff that another takeoff already brought into its estimate version (read only).
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await getTakeoffJobPageContributions((await params).jobId));
  } catch (error) {
    if (error instanceof TakeoffError) return NextResponse.json(toTakeoffErrorResponse(error), { status: error.status });
    return toErrorResponse(error);
  }
}

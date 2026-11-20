import { parseTakeoffPreviewConversionResponse } from "@/lib/takeoff/apply-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { previewTakeoffJobConversion } from "@/lib/takeoff/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    const data = await previewTakeoffJobConversion(jobId, body);
    return ok(parseTakeoffPreviewConversionResponse(data, { jobId, strategy: body.strategy, targetSectionId: body.target_section_id }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

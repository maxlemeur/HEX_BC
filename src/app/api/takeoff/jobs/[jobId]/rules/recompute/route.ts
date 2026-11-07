import { NextResponse } from "next/server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { recoverTakeoffRules } from "@/lib/takeoff/rules/recovery-server";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await recoverTakeoffRules((await params).jobId));
  } catch (error) {
    return error instanceof TakeoffError
      ? NextResponse.json(toTakeoffErrorResponse(error), { status: error.status }) : toErrorResponse(error);
  }
}

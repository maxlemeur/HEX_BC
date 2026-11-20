import { parseTakeoffItemBatchPatchResponse } from "@/lib/takeoff/item-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { batchUpdateTakeoffItems } from "@/lib/takeoff/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    const data = await batchUpdateTakeoffItems(jobId, body);
    return ok(parseTakeoffItemBatchPatchResponse(data, body.items.map((item: { item_id: string }) => item.item_id)));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}

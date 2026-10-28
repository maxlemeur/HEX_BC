import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { reconcilePlanSetDossier } from "@/lib/takeoff/plans";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const { setId } = z.object({ setId: z.string().uuid() }).parse(await params);
    return ok(await reconcilePlanSetDossier(setId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

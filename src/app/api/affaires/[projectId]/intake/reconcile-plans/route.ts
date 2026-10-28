import { z } from "zod";

import { reconcileAffairePlanPresence } from "@/lib/affaires/intake-server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(await params);
    return ok(await reconcileAffairePlanPresence(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

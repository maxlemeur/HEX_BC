import { z } from "zod";

import { reconcileAffairePlanPresence } from "@/lib/affaires/intake-derived-state-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";

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

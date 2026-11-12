import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { technicianParamsSchema } from "@/lib/material-requests/http";
import {
  TECHNICIAN_HISTORY_DEFAULT_LIMIT,
  TECHNICIAN_HISTORY_MAX_LIMIT,
  listTechnicianRequests,
} from "@/lib/material-requests/technicians-server";

type Context = { params: Promise<{ technicianId: string }> };

const querySchema = z.object({
  limit: z
    .string()
    .regex(/^\d{1,2}$/, "limit invalide.")
    .transform(Number)
    .pipe(z.number().int().min(1).max(TECHNICIAN_HISTORY_MAX_LIMIT))
    .default(TECHNICIAN_HISTORY_DEFAULT_LIMIT),
});

/** A technician's most recent requests, in the affaires the caller can read. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { technicianId } = technicianParamsSchema.parse(await params);
    const { limit } = querySchema.parse({ limit: new URL(request.url).searchParams.get("limit") ?? undefined });
    return ok(await listTechnicianRequests(technicianId, limit));
  } catch (error) {
    return toErrorResponse(error);
  }
}

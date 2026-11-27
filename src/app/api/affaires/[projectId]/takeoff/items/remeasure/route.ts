import { z } from "zod";

import { badRequest, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody, uuidRouteParamsOr404 } from "@/lib/http/request";
import { itemRemeasureCommandSchema } from "@/lib/takeoff/item-table-contracts";
import { runItemRemeasure } from "@/lib/takeoff/item-review-commands-server";

import { readItemMeasureReadings } from "@/lib/takeoff/item-measure-readings-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** A new manual request of the member who confirms, on their own subscription, for the selection of the preview. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const body = itemRemeasureCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Demande de nouvelle mesure invalide.", undefined, "VALIDATION_ERROR");
    return ok(await runItemRemeasure(projectId, {
      ...body.data, item_ids: body.data.item_ids.map((id) => id.toLowerCase()),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const scope = paramsSchema.safeParse(await params);
    const query = z.object({ item: z.uuid(), plan: z.uuid(), jobId: z.uuid().optional(), requestId: z.uuid().optional() })
      .refine(({ jobId, requestId }) => Boolean(jobId) === Boolean(requestId)).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!scope.success || !query.success) throw badRequest("Poste ou plan invalide.");
    const { item, plan, jobId, requestId } = query.data;
    return ok(await readItemMeasureReadings(scope.data.projectId, item, plan, jobId && requestId ? { jobId, requestId } : undefined));
  } catch (error) {
    return toErrorResponse(error);
  }
}

import { z } from "zod";
import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { retainCommandSchema } from "@/lib/takeoff/measure-review-contracts";
import { readMeasureReview, retainMeasure } from "@/lib/takeoff/measure-review-server";

const paramsSchema = z.object({ projectId: z.string().uuid(), answerId: z.string().uuid() });
type Context = { params: Promise<z.infer<typeof paramsSchema>> };

async function scope(ctx: Context) {
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) throw notFound("Réponse du poste introuvable.");
  return parsed.data;
}

export async function GET(_request: Request, ctx: Context) {
  try {
    const { projectId, answerId } = await scope(ctx);
    return ok(await readMeasureReview(projectId, answerId));
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request, ctx: Context) {
  try {
    const { projectId, answerId } = await scope(ctx);
    const command = retainCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!command.success) throw unprocessableEntity("Confirmation de la mesure invalide.");
    return ok(await retainMeasure(projectId, answerId, command.data));
  } catch (error) { return toErrorResponse(error); }
}

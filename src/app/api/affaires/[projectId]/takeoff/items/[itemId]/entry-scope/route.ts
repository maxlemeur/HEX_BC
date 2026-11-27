import { z } from "zod";
import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { entryScopeCommandSchema } from "@/lib/takeoff/entry-scope-contracts";
import { changeEntryScope } from "@/lib/takeoff/entry-scope-server";

const paramsSchema = z.object({ projectId: z.string().uuid(), itemId: z.string().uuid() });

export async function POST(request: Request, ctx: { params: Promise<z.infer<typeof paramsSchema>> }) {
  try {
    const params = paramsSchema.safeParse(await ctx.params);
    if (!params.success) throw notFound("Poste introuvable.");
    const body = entryScopeCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Changement de portée invalide.");
    return ok(await changeEntryScope(params.data.projectId, params.data.itemId, body.data));
  } catch (error) { return toErrorResponse(error); }
}

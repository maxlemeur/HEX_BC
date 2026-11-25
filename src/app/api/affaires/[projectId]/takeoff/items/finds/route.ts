import { z } from "zod";
import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { findCommandSchema } from "@/lib/takeoff/unlisted-finds";
import { decideUnlistedFinds, readUnlistedFinds } from "@/lib/takeoff/unlisted-finds-server";

type Context = { params: Promise<{projectId: string}> };
async function project(context: Context) {
  const parsed = z.string().uuid().safeParse((await context.params).projectId);
  if (!parsed.success) throw notFound("Affaire introuvable.");
  return parsed.data;
}
export async function GET(_request: Request, context: Context) {
  try { return ok(await readUnlistedFinds(await project(context))); }
  catch (error) { return toErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const parsed = findCommandSchema.safeParse(await parseJsonBody(request,badRequest));
    if (!parsed.success) throw unprocessableEntity("Vérifiez la désignation, l’unité, la section ou le motif.");
    return ok(await decideUnlistedFinds(await project(context),parsed.data));
  } catch (error) { return toErrorResponse(error); }
}

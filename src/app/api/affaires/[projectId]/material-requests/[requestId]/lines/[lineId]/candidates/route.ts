import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { searchMaterialRequestLineCandidates } from "@/lib/material-requests/articles-server";
import { materialRequestLineCandidatesQuerySchema } from "@/lib/material-requests/contracts";
import { lineParamsSchema } from "@/lib/material-requests/http";

type Context = { params: Promise<{ projectId: string; requestId: string; lineId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, lineId } = lineParamsSchema.parse(await params);
    // A cleared search box sends `q=`: it is no search, the line's own words are used.
    const raw = new URL(request.url).searchParams.get("q");
    const { q } = materialRequestLineCandidatesQuerySchema.parse({ q: raw?.trim() ? raw : undefined });
    return ok(await searchMaterialRequestLineCandidates(projectId, requestId, lineId, q));
  } catch (error) {
    return toErrorResponse(error);
  }
}

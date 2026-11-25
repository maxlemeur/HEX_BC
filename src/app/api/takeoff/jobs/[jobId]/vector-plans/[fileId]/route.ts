import { z } from "zod";
import { TakeoffError, toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { readDismissedFindDossierPlan } from "@/lib/takeoff/unlisted-find-source-server";
import { readAttestedTakeoffPlan } from "@/lib/takeoff/vectors/read-server";

const dossierFallback = z.object({ projectId: z.string().uuid(), decisionId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string; fileId: string }> }) {
  try {
    const { jobId, fileId } = await params;
    const bytes = await readAttestedTakeoffPlan(jobId, fileId).catch(error => {
      if (!(error instanceof TakeoffError) || error.status !== 404) throw error;
      const query = new URL(request.url).searchParams;
      const fallback = dossierFallback.safeParse({ projectId: query.get("projectId"), decisionId: query.get("decisionId") });
      if (!fallback.success) throw error;
      return readDismissedFindDossierPlan(fallback.data.projectId, fallback.data.decisionId,
        jobId.toLowerCase(), fileId.toLowerCase(), request.signal);
    });
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "none",
    } });
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

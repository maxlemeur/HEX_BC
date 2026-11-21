import { NextResponse } from "next/server";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { TAKEOFF_REQUEST_ACTIVITY_VIEWS, type TakeoffRequestActivityView } from "@/lib/takeoff/request-activity-contracts";
import { readTakeoffRequestActivity, toRequestActivityReadError } from "@/lib/takeoff/request-activity-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message, retryable: false } }, { status: 400 });
}

/** The affaire's launch requests and the analyses of their plans: the projection the activity reads while it changes. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");
    if (!projectId || !UUID.test(projectId)) return badRequest("project_id requis.");
    const rawView = searchParams.get("view") ?? "current";
    if (!(TAKEOFF_REQUEST_ACTIVITY_VIEWS as readonly string[]).includes(rawView)) return badRequest("Vue inconnue.");
    const view = rawView as TakeoffRequestActivityView;
    const requestId = searchParams.get("requestId");
    const jobId = searchParams.get("jobId");
    if (view === "request" && (!requestId || !UUID.test(requestId))) return badRequest("Identifiant de demande invalide.");
    if (view === "job" && (!jobId || !UUID.test(jobId))) return badRequest("Identifiant d’analyse invalide.");
    const rawOffset = searchParams.has("offset") ? Number(searchParams.get("offset")) : 0;
    const rawLimit = searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined;
    if (!Number.isSafeInteger(rawOffset) || rawOffset < 0) return badRequest("Décalage invalide.");
    if (rawLimit !== undefined && (!Number.isSafeInteger(rawLimit) || rawLimit < 1)) return badRequest("Nombre de résultats invalide.");

    const seen = (name: string) => {
      const value = searchParams.get(name);
      return value && value.length <= 200 ? value : null;
    };
    return ok(await readTakeoffRequestActivity({
      projectId: projectId.toLowerCase(), view,
      requestId: requestId?.toLowerCase() ?? null, jobId: jobId?.toLowerCase() ?? null,
      offset: rawOffset, limit: rawLimit,
      dossierSeen: seen("dossierSeen"), actionSeen: seen("actionSeen"), actionSeenAt: seen("actionSeenAt"),
    }));
  } catch (error) {
    // A timeout or a lost connection is a read to try again; only a refusal stops the page's reads.
    return toTakeoffRouteErrorResponse(toRequestActivityReadError(error));
  }
}

import { z } from "zod";

import { fetchAffaireHubPlansSummary } from "@/lib/affaires/server";
import { fetchAffaireIntakeWorkspace, requireAffaireProjectReadAccess } from "@/lib/affaires/intake-server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

// The affaire page reads its dossier here while documents are added or analysed, instead of
// refreshing the router: a refresh holds back what the person's saves bring to the screen (TI-722).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = z.object({ projectId: z.string().uuid("projectId invalide.") }).parse(await params);
    const withPlans = new URL(request.url).searchParams.get("plans") === "1";
    const [workspace, plansSummary] = await Promise.all([
      fetchAffaireIntakeWorkspace(projectId),
      withPlans
        ? requireAffaireProjectReadAccess(projectId)
          .then(({ context }) => isTakeoffEnabled(context.tenantId))
          // The plans complete the read: when they cannot be read, the page keeps those it shows.
          .then((enabled) => enabled ? fetchAffaireHubPlansSummary(projectId) : null)
          .catch(() => undefined)
        : undefined,
    ]);
    const response = ok(plansSummary === undefined ? { workspace } : { workspace, plansSummary });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

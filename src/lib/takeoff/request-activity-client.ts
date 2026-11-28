import { callTakeoffApi, TAKEOFF_READ_REQUEST_TIMEOUT_MS } from "@/lib/takeoff/client-http";
import {
  takeoffRequestActivityResponseSchema,
  type TakeoffRequestActivityResponse,
  type TakeoffRequestActivityView,
} from "@/lib/takeoff/request-activity-contracts";

const FAILURE = "Impossible de lire l’avancement du métré.";

/** The affaire's launch requests and the analyses of their plans (GET /api/takeoff/activity-center/requests). */
export async function fetchTakeoffRequestActivity(projectId: string, query: {
  view: TakeoffRequestActivityView; requestId?: string | null; jobId?: string | null; offset?: number; limit?: number;
  /** What the page's last answer read: the server does not compute them again when they did not move. */
  dossierSeen?: string | null; actionSeen?: string | null; actionSeenAt?: string | null;
}): Promise<TakeoffRequestActivityResponse> {
  const params = new URLSearchParams({ project_id: projectId, view: query.view });
  if (query.requestId) params.set("requestId", query.requestId);
  if (query.jobId) params.set("jobId", query.jobId);
  if (query.offset) params.set("offset", String(query.offset));
  if (query.limit) params.set("limit", String(query.limit));
  if (query.dossierSeen) params.set("dossierSeen", query.dossierSeen);
  if (query.actionSeen) params.set("actionSeen", query.actionSeen);
  if (query.actionSeenAt) params.set("actionSeenAt", query.actionSeenAt);
  return callTakeoffApi(`/api/takeoff/activity-center/requests?${params.toString()}`, { method: "GET" },
    takeoffRequestActivityResponseSchema, FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

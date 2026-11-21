import { TakeoffApiError, TAKEOFF_READ_REQUEST_TIMEOUT_MS } from "@/lib/takeoff/client-http";
import {
  takeoffRequestActivityResponseSchema,
  type TakeoffRequestActivityResponse,
  type TakeoffRequestActivityView,
} from "@/lib/takeoff/request-activity-contracts";
import { isRecord } from "@/lib/value-guards";

const FAILURE = "Impossible de lire l’avancement du métré.";

/** The affaire's launch requests and the analyses of their plans (GET /api/takeoff/activity-center/requests). */
export async function fetchTakeoffRequestActivity(projectId: string, query: {
  view: TakeoffRequestActivityView; requestId?: string | null; jobId?: string | null; offset?: number; limit?: number;
}): Promise<TakeoffRequestActivityResponse> {
  const params = new URLSearchParams({ project_id: projectId, view: query.view });
  if (query.requestId) params.set("requestId", query.requestId);
  if (query.jobId) params.set("jobId", query.jobId);
  if (query.offset) params.set("offset", String(query.offset));
  if (query.limit) params.set("limit", String(query.limit));
  let response: Response;
  try {
    response = await fetch(`/api/takeoff/activity-center/requests?${params.toString()}`, {
      method: "GET", credentials: "same-origin", headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TAKEOFF_READ_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // A network failure carries the browser's own (English) message: never shown as is.
    throw new TakeoffApiError(FAILURE, 0, null, null);
  }
  const body = await response.json().catch(() => null) as unknown;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!response.ok || !isRecord(body) || body.ok !== true) {
    const message = typeof error?.message === "string" && error.message.trim() ? error.message : FAILURE;
    throw new TakeoffApiError(message, response.status, error?.details ?? null, typeof error?.code === "string" ? error.code : null);
  }
  const parsed = takeoffRequestActivityResponseSchema.safeParse(body.data);
  if (!parsed.success) throw new TakeoffApiError(FAILURE, response.status, null, null);
  return parsed.data;
}

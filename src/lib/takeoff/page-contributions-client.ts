import { readTakeoffEnvelope } from "@/lib/takeoff/client-http";
import {
  takeoffPageContributionsResponseSchema,
  type TakeoffLaunchPageContributionsRequest,
  type TakeoffPageContributionsResponse,
} from "@/lib/takeoff/page-contributions-contracts";

// TI-682 lot D: the read of the pages already in the estimate, for the review, the application and the launch.

const FAILURE = "Impossible de vérifier les pages déjà au devis.";

function read(path: string, init: RequestInit): Promise<TakeoffPageContributionsResponse> {
  return readTakeoffEnvelope(path, init, takeoffPageContributionsResponseSchema, FAILURE);
}

/** `versionId`: the estimate version the review shows (the takeoff's own, or a copy it was carried over into). */
export function fetchTakeoffJobPageContributions(jobId: string, versionId: string, options: { signal?: AbortSignal } = {}) {
  return read(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/page-contributions?version_id=${encodeURIComponent(versionId)}`,
    { method: "GET", signal: options.signal });
}

export function fetchLaunchPageContributions(request: TakeoffLaunchPageContributionsRequest, options: { signal?: AbortSignal } = {}) {
  return read("/api/takeoff/page-contributions", { method: "POST", signal: options.signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
}

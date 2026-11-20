import { readTakeoffEnvelope } from "@/lib/takeoff/client-http";
import {
  takeoffPageReplacementResponseSchema,
  type TakeoffPageReplacementRequest,
  type TakeoffPageReplacementResponse,
} from "@/lib/takeoff/page-replacement-contracts";

// TI-682 lot D, PR 2: the proposal of the « Pages déjà au devis » step of the application wizard.

const FAILURE = "Impossible de proposer le remplacement des pages déjà au devis.";

export async function fetchTakeoffPageReplacement(jobId: string, request: TakeoffPageReplacementRequest,
  options: { signal?: AbortSignal } = {}): Promise<TakeoffPageReplacementResponse> {
  return readTakeoffEnvelope(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/page-replacement`, { method: "POST", signal: options.signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(request) }, takeoffPageReplacementResponseSchema, FAILURE);
}

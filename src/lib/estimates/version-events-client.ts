import { requestJson } from "@/lib/estimates/client-requests";
import { parseEstimateEventsResponse } from "@/lib/estimates/write-response-contracts";
import type { EstimateVersionEvent } from "@/lib/estimates/schemas";

export type EstimateVersionEventType =
  | "sent"
  | "accepted"
  | "archived"
  | "rejected"
  | "seal_verified"
  | "approval_submitted"
  | "approval_rules_evaluated"
  | "approval_status_changed"
  | "approval_decided";

export async function fetchEstimateVersionEvents(
  versionId: string,
  options: { signal?: AbortSignal } = {}
): Promise<EstimateVersionEvent[]> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/events`,
    {
      method: "GET",
      signal: options.signal,
    },
    "Impossible de charger les événements.",
    value => parseEstimateEventsResponse(value, versionId)
  );

  return payload.events;
}

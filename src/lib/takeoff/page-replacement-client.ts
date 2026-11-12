import {
  takeoffPageReplacementResponseSchema,
  type TakeoffPageReplacementRequest,
  type TakeoffPageReplacementResponse,
} from "@/lib/takeoff/page-replacement-contracts";

// TI-682 lot D, PR 2: the proposal of the « Pages déjà au devis » step of the application wizard.

const FAILURE = "Impossible de proposer le remplacement des pages déjà au devis.";

export async function fetchTakeoffPageReplacement(jobId: string, request: TakeoffPageReplacementRequest,
  options: { signal?: AbortSignal } = {}): Promise<TakeoffPageReplacementResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/page-replacement`, { method: "POST", credentials: "same-origin",
      signal: options.signal, headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(request) });
  } catch (error) {
    // A network failure carries the browser's own (English) message: never shown as is.
    if (options.signal?.aborted) throw error;
    throw new Error(FAILURE);
  }
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(typeof body?.error?.message === "string" && body.error.message.trim() ? body.error.message : FAILURE);
  }
  const parsed = takeoffPageReplacementResponseSchema.safeParse(body.data);
  if (!parsed.success) throw new Error(FAILURE);
  return parsed.data;
}

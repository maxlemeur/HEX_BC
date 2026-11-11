import {
  takeoffPageContributionsResponseSchema,
  type TakeoffLaunchPageContributionsRequest,
  type TakeoffPageContributionsResponse,
} from "@/lib/takeoff/page-contributions-contracts";

// TI-682 lot D: the read of the pages already in the estimate, for the review, the application and the launch.

const FAILURE = "Impossible de vérifier les pages déjà au devis.";

async function read(path: string, init: RequestInit): Promise<TakeoffPageContributionsResponse> {
  const response = await fetch(path, { credentials: "same-origin", ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(typeof body?.error?.message === "string" && body.error.message.trim() ? body.error.message : FAILURE);
  }
  const parsed = takeoffPageContributionsResponseSchema.safeParse(body.data);
  if (!parsed.success) throw new Error(FAILURE);
  return parsed.data;
}

export function fetchTakeoffJobPageContributions(jobId: string, options: { signal?: AbortSignal } = {}) {
  return read(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/page-contributions`, { method: "GET", signal: options.signal });
}

export function fetchLaunchPageContributions(request: TakeoffLaunchPageContributionsRequest, options: { signal?: AbortSignal } = {}) {
  return read("/api/takeoff/page-contributions", { method: "POST", signal: options.signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
}

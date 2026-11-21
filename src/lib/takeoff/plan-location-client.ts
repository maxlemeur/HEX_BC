import type { z } from "zod";

import { TakeoffApiError, TAKEOFF_READ_REQUEST_TIMEOUT_MS, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS } from "@/lib/takeoff/client-http";
import {
  takeoffJobPlanLocationsSchema,
  takeoffPlanFileLocationSchema,
  type TakeoffPlanLocationSave,
} from "@/lib/takeoff/plan-location-contracts";
import { isRecord } from "@/lib/value-guards";

// Reading a plan revision includes its title blocks: a read can take a few seconds on a large PDF.
const READ_TIMEOUT_MS = Math.max(TAKEOFF_READ_REQUEST_TIMEOUT_MS, 45_000);

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>, failure: string, timeoutMs: number): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init, signal, headers: { accept: "application/json", ...(init.headers ?? {}) } });
  } catch {
    // A network failure carries the browser's own (English) message: never shown as is.
    throw new TakeoffApiError(failure, 0, null, null);
  }
  const body = await response.json().catch(() => null) as unknown;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!response.ok || !isRecord(body) || body.ok !== true) {
    const message = typeof error?.message === "string" && error.message.trim() ? error.message : failure;
    throw new TakeoffApiError(message, response.status, error?.details ?? null, typeof error?.code === "string" ? error.code : null);
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) throw new TakeoffApiError(failure, response.status, null, null);
  return parsed.data;
}

const planPath = (setId: string, fileId: string) =>
  `/api/takeoff/plan-sets/${encodeURIComponent(setId)}/files/${encodeURIComponent(fileId)}/location`;

export function fetchTakeoffPlanFileLocation(setId: string, fileId: string) {
  return request(planPath(setId, fileId), { method: "GET" }, takeoffPlanFileLocationSchema,
    "Impossible de lire la localisation de ce plan.", READ_TIMEOUT_MS);
}

export function saveTakeoffPlanFileLocation(setId: string, fileId: string, body: TakeoffPlanLocationSave) {
  return request(planPath(setId, fileId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    takeoffPlanFileLocationSchema, "Impossible d’enregistrer la localisation de ce plan.", Math.max(TAKEOFF_WRITE_REQUEST_TIMEOUT_MS, READ_TIMEOUT_MS));
}

export function fetchTakeoffJobPlanLocations(jobId: string) {
  return request(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/plan-locations`, { method: "GET" }, takeoffJobPlanLocationsSchema,
    "Impossible de lire la localisation des plans de ce métré.", Math.max(READ_TIMEOUT_MS, 90_000));
}

/** The reason a save was refused for a change made meanwhile: the screen reloads and shows what is stored now. */
export function planLocationConflictReason(error: unknown) {
  if (!(error instanceof TakeoffApiError) || error.status !== 409 || !isRecord(error.details)) return null;
  const reason = error.details.reason;
  return reason === "TAKEOFF_PLAN_LOCATION_CONFLICT" || reason === "TAKEOFF_PLAN_LOCATION_REVISION_CHANGED"
    || reason === "TAKEOFF_PLAN_LOCATION_SOURCE_STALE" ? reason : null;
}

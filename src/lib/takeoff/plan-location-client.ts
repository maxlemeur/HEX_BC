import {
  callTakeoffApi as request,
  TakeoffApiError,
  TAKEOFF_READ_REQUEST_TIMEOUT_MS,
  TAKEOFF_WRITE_REQUEST_TIMEOUT_MS,
} from "@/lib/takeoff/client-http";
import {
  planLocationReplacementSchema,
  takeoffJobPlanLocationsSchema,
  takeoffPlanFileLocationSchema,
  type TakeoffPlanLocationSave,
} from "@/lib/takeoff/plan-location-contracts";
import { isRecord } from "@/lib/value-guards";

// Reading a plan revision includes its title blocks: a read can take a few seconds on a large PDF.
const READ_TIMEOUT_MS = Math.max(TAKEOFF_READ_REQUEST_TIMEOUT_MS, 45_000);

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

const CONFLICT_REASONS = ["TAKEOFF_PLAN_LOCATION_CONFLICT", "TAKEOFF_PLAN_LOCATION_REVISION_CHANGED",
  "TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED", "TAKEOFF_PLAN_LOCATION_SOURCE_STALE", "TAKEOFF_PLAN_LOCATION_COPY_PENDING"] as const;

/**
 * Why a read or a save was refused for a change made meanwhile, and the plan's current copy when the dossier replaced
 * it: the screen reloads (or opens that copy) and shows what applies now.
 */
export function planLocationConflict(error: unknown) {
  if (!(error instanceof TakeoffApiError) || error.status !== 409 || !isRecord(error.details)) return null;
  const reason = CONFLICT_REASONS.find((candidate) => candidate === (error.details as Record<string, unknown>).reason);
  if (!reason) return null;
  const replacement = planLocationReplacementSchema.safeParse(error.details.replacement);
  return { reason, replacement: replacement.success ? replacement.data : null, message: error.message };
}

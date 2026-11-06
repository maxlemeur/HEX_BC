import { isEstimateApiError } from "@/lib/estimates/client";

/** Une sauvegarde refusée parce que la version a changé depuis la lecture. */
export function isVersionConflictError(error: unknown) {
  return (
    isEstimateApiError(error) &&
    error.status === 409 &&
    ["VERSION_CONFLICT", "ESTIMATE_BATCH_STALE", "ESTIMATE_BATCH_CONTEXT_CHANGED"].includes(error.code ?? "")
  );
}

/** Une écriture refusée parce que la page ne détient plus le verrou d'édition. */
export function isDraftLockRequiredError(error: unknown) {
  return isEstimateApiError(error) && ["LOCK_REQUIRED", "ESTIMATE_BATCH_LOCK_REQUIRED"].includes(error.code ?? "");
}

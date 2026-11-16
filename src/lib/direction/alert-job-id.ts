// Leaf module (type-only imports): the client components that read direction
// alerts import it, as does the direction server.
import type { TakeoffRiskAlert } from "@/lib/takeoff/types";

/** Takeoff job of an alert: its column, else the job id kept in its metadata. */
export function resolveAlertJobId(alert: TakeoffRiskAlert) {
  if (typeof alert.takeoff_job_id === "string") {
    return alert.takeoff_job_id;
  }

  const metadata =
    typeof alert.metadata === "object" && alert.metadata !== null
      ? (alert.metadata as Record<string, unknown>)
      : {};

  return (
    (typeof metadata.takeoff_job_id === "string"
      ? metadata.takeoff_job_id
      : null) ??
    (typeof metadata.takeoffJobId === "string"
      ? metadata.takeoffJobId
      : null)
  );
}

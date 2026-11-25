import "server-only";

import { mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AnyTakeoffLaunchManifest } from "./launch-request";
import { deriveTakeoffRequestUnits, parseTakeoffRequestManifest, type TakeoffRequestUnitJobRow } from "./request-activity";

type Service = ReturnType<typeof createServiceRoleClient>;
type AdmittedRow = {
  id: string; created_at: string; state: string; manifest: AnyTakeoffLaunchManifest | null;
  takeoff_jobs: TakeoffRequestUnitJobRow[] | null;
};

const UNIT_JOB_COLUMNS = "id, launch_request_id, launch_unit_key, status, started_at, next_retry_at, analysis_outcome, error_code, updated_at";

/** Sealed requests in this affaire, newest first, with the outcome of each individual reading. */
export async function readAdmittedPlanRequests(service: Service, tenantId: string, projectId: string) {
  const read = await readAllRows(() => service.from("takeoff_launch_requests")
    .select(`id, created_at, state, manifest, takeoff_jobs!takeoff_jobs_launch_request_fkey(${UNIT_JOB_COLUMNS})`, { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId).in("state", ["admitted", "closed"])
    .not("admitted_at", "is", null), { pageSize: 1000 });
  if (read.error) throw mapSupabaseError(read.error, "Impossible de lire les analyses de l’affaire.");
  const requests = (read.data ?? []) as unknown as AdmittedRow[];
  return requests.sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
    .flatMap(request => {
      const manifest = request.manifest;
      if (!manifest || !Array.isArray(manifest.plans)) return [];
      const units = deriveTakeoffRequestUnits({ requestId: request.id, manifest: parseTakeoffRequestManifest(manifest),
        jobs: request.takeoff_jobs ?? [] });
      return [{ manifest, units, state: request.state, jobs: request.takeoff_jobs ?? [] }];
    });
}

type Reading = { id: string; documentId: string | null; name: string; state: "analysed" | "in_progress" };

/** Only a successful or still active unit can prevent another copy of the same bytes from being read. */
export async function readAdmittedContent(service: Service, tenantId: string, projectId: string) {
  return admittedContent(await readAdmittedPlanRequests(service, tenantId, projectId));
}

export function admittedContent(requests: Awaited<ReturnType<typeof readAdmittedPlanRequests>>) {
  const byDigest = new Map<string, Reading[]>();
  for (const { manifest, units, state } of requests) {
    if (!units) continue;
    const byFile = new Map(units.units.map(unit => [unit.planFileId, unit.state]));
    for (const plan of manifest.plans) {
      if (!plan.content_sha256) continue;
      const unit = units.format === "grouped" ? units.units[0]?.state : byFile.get(plan.plan_file_id);
      if (unit !== "succeeded" && !(state === "admitted" && (unit === "queued" || unit === "running"))) continue;
      const readings = byDigest.get(plan.content_sha256) ?? [];
      readings.push({ id: plan.plan_file_id, documentId: plan.intake_document_id, name: plan.name,
        state: unit === "succeeded" ? "analysed" : "in_progress" });
      byDigest.set(plan.content_sha256, readings);
    }
  }
  return byDigest;
}

export function readingThroughOtherCopy(readings: Reading[] | undefined, id: string) {
  return readings?.find(reading => reading.id !== id && reading.state === "analysed")
    ?? readings?.find(reading => reading.id !== id);
}

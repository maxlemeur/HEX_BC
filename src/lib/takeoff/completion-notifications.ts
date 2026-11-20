import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { toTakeoffAnalysisOutcome } from "@/lib/takeoff/completion-outcome";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const PAGE_SIZE = 30;

export async function listTakeoffCompletionNotifications(page: number) {
  const { supabase, tenantId } = await getAuthenticatedTenantContext();
  const { data, error } = await supabase.from("takeoff_completion_notifications")
    .select(`id, outcome, finished_at, read_at, delivery_state, project_id,
      job_id, subject_kind, request_id,
      project:estimate_projects!takeoff_completion_project_fkey(name),
      job:takeoff_jobs!takeoff_completion_job_fkey(estimate_version_id, error_code)`)
    .eq("tenant_id", tenantId)
    .order("finished_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (error) throw mapSupabaseError(error, "Impossible de charger vos notifications.");
  const rows = data ?? [];
  const notifications = rows.slice(0, PAGE_SIZE).flatMap((row) => {
    const outcome = toTakeoffAnalysisOutcome(row.outcome);
    return outcome ? [{ ...row, outcome }] : [];
  });
  return { notifications, hasOlder: rows.length > PAGE_SIZE, takeoffEnabled: await isTakeoffEnabled(tenantId) };
}

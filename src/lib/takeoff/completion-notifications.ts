import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { toTakeoffNoticeOutcome } from "@/lib/takeoff/completion-outcome";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { readTakeoffRequestsReadingList } from "@/lib/takeoff/review-link-server";

const PAGE_SIZE = 30;

export async function listTakeoffCompletionNotifications(page: number) {
  const { supabase, tenantId } = await getAuthenticatedTenantContext();
  const { data, error } = await supabase.from("takeoff_completion_notifications")
    .select(`id, outcome, finished_at, read_at, delivery_state, project_id,
      job_id, subject_kind, request_id, reason_code,
      project:estimate_projects!takeoff_completion_project_fkey(name),
      job:takeoff_jobs!takeoff_completion_job_fkey(estimate_version_id, error_code)`)
    .eq("tenant_id", tenantId)
    .order("finished_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (error) throw mapSupabaseError(error, "Impossible de charger vos notifications.");
  const rows = data ?? [];
  const shown = rows.slice(0, PAGE_SIZE);
  // The requests that read the affaire's list (lot 4): their end opens the table of items.
  const readingList = await readTakeoffRequestsReadingList(supabase, tenantId,
    shown.map((row) => (row.subject_kind === "request" ? row.request_id : null)));
  const notifications = shown.flatMap((row) => {
    // A launch request's end may be partial: some of its plans were read.
    const outcome = toTakeoffNoticeOutcome(row.outcome);
    return outcome ? [{ ...row, outcome, readsList: Boolean(row.request_id && readingList.has(row.request_id.toLowerCase())) }] : [];
  });
  return { notifications, hasOlder: rows.length > PAGE_SIZE, takeoffEnabled: await isTakeoffEnabled(tenantId) };
}

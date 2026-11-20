import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { toTakeoffAnalysisOutcome } from "@/lib/takeoff/completion-outcome";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { getTakeoffFailureReasonLabel } from "@/lib/takeoff/visible-status";

const PAGE_SIZE = 30;

export const TAKEOFF_COMPLETION_LABELS = {
  success: "Analyse terminée",
  failure: "Analyse échouée",
  canceled: "Analyse annulée",
} as const;

export function takeoffCompletionFailureReason(code: string | null | undefined) {
  if (code === TakeoffErrorCode.FORBIDDEN) return "L’accès nécessaire au traitement n’est plus disponible.";
  if (code === TakeoffErrorCode.AI_PROVIDER) return "Le service d’analyse n’a pas pu terminer le métré.";
  return getTakeoffFailureReasonLabel({ errorCode: code })
    ?? "Le traitement n’a pas pu terminer le métré. Consultez l’activité de l’affaire.";
}

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

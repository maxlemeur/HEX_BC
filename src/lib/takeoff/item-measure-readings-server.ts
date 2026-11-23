import "server-only";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { readTakeoffLaunchRequestUnits } from "@/lib/takeoff/launch-request-units-server";
import { describeTakeoffJobFailure } from "@/lib/takeoff/visible-status";
import { itemMeasureReadingsSchema } from "@/lib/takeoff/item-table-contracts";
import { asRecord } from "@/lib/value-guards";

export async function readItemMeasureReadings(projectId: string, itemId: string, planKey: string, receipt?: { jobId: string; requestId: string }) {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { supabase, userId, tenantId } = context;
  let query = supabase.from("takeoff_jobs").select("id,launch_request_id,preparation_snapshot")
    .eq("project_id", project.id).eq("tenant_id", tenantId).eq("created_by", userId)
    .eq("preparation_snapshot->>remeasure_item", itemId).eq("preparation_snapshot->>remeasure_plan", planKey);
  if (receipt) query = query.eq("id", receipt.jobId).eq("launch_request_id", receipt.requestId);
  const { data: job, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la dernière demande de mesure.");
  if (!job?.launch_request_id) return null;
  const previous = asRecord(job.preparation_snapshot)?.remeasure_previous_answer;
  const answer = async (where: { jobId: string } | { answerId: string }) => {
    const query = supabase.from("takeoff_item_answers").select(
      "id, job_id, list_revision_id, plan_file_id, plan_generation, outcome, quantity, unit, searched_pages, unreadable_pages, reasons, comparison_only, observations:takeoff_item_answer_observations!takeoff_item_answer_observations_answer_fkey(id, ordinal, page, evidence)",
    )
      .eq("tenant_id", tenantId).eq("project_id", project.id).eq("item_id", itemId).eq("plan_logical_id", planKey);
    const { data, error: failure } = await ("jobId" in where ? query.eq("job_id", where.jobId) : query.eq("id", where.answerId)).maybeSingle();
    if (failure) throw mapSupabaseError(failure, "Impossible de lire le résultat de la mesure.");
    if (!data) return null;
    const reasons = Array.isArray(data.reasons) ? data.reasons.flatMap((entry) => {
      const text = asRecord(entry)?.text;
      return typeof text === "string" ? [text] : [];
    }) : [];
    return {
      answerId: data.id, jobId: data.job_id, listRevisionId: data.list_revision_id, planFileId: data.plan_file_id,
      generation: data.plan_generation, outcome: data.outcome, quantity: data.quantity, unit: data.unit,
      pages: data.searched_pages, unreadablePages: data.unreadable_pages, reasons, comparisonOnly: data.comparison_only,
      observations: data.observations.sort((left, right) => left.ordinal - right.ordinal).map(({ id, page, evidence }) => ({ id, page, evidence })),
    };
  };
  const { units } = await readTakeoffLaunchRequestUnits(context, project.id, job.launch_request_id);
  const unit = units.find((entry) => entry.jobId === job.id);
  if (!unit) return null;
  const [prior, latest] = await Promise.all([typeof previous === "string" ? answer({ answerId: previous }) : null,
    unit.state === "succeeded" ? answer({ jobId: job.id }) : null]);
  return itemMeasureReadingsSchema.parse({ jobId: job.id, requestId: job.launch_request_id, state: unit.state,
    reason: unit.reasonCode ? describeTakeoffJobFailure(unit.reasonCode) : null, previous: prior, latest });
}

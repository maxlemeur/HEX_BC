import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError, notFound } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readAdmittedPlanRequests } from "./admitted-plan-readings-server";
import type { BriefPlanOption } from "./brief-plan-choice";
import type { TakeoffRelaunchChoice } from "./launch-request";
import type { TakeoffPreparationSnapshot } from "./preparation";
import { assertPreparationProjectAccess } from "./preparation-repository";
import { currentPlanCopies } from "./relaunch-plan-copies-server";
import { isTakeoffSourceVisible, resolveTakeoffRequestUnitState } from "./request-activity";
import { readTakeoffVisibleSources } from "./source-visibility-server";

export type RelaunchPlanState = Exclude<BriefPlanOption["state"], "unverified"> | "failed";

export type RelaunchPlanChoice = {
  planSetId: string | null;
  defaultIds: string[];
  states: Record<string, RelaunchPlanState>;
  withoutCopy: TakeoffRelaunchChoice["withoutCopy"];
};

const priority: Record<RelaunchPlanState, number> = { not_analysed: 0, failed: 1, in_progress: 2, analysed: 3 };

/** Read the selected predecessor and the affaire's plan readings, using the same unit states as the activity centre. */
export async function readRelaunchPlanChoice(context: AuthenticatedTenantContext, projectId: string,
  predecessorJobId: string, singlePlan: boolean): Promise<RelaunchPlanChoice> {
  await assertPreparationProjectAccess(context, projectId, true);
  const service = createServiceRoleClient();
  const [{ data: predecessor, error }, requests] = await Promise.all([
    service.from("takeoff_jobs").select("plan_set_id, launch_request_id, launch_unit_key, preparation_snapshot, status, analysis_outcome, started_at, error_code, next_retry_at")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", predecessorJobId).maybeSingle(),
    readAdmittedPlanRequests(service, context.tenantId, projectId),
  ]);
  if (error) throw mapSupabaseError(error, "Impossible de lire l’analyse à relancer.");
  if (!predecessor) throw notFound("Cette analyse n’appartient pas à l’affaire.");

  const states = new Map<string, RelaunchPlanState>();
  const defaults = new Map<string, string>();
  const remember = (id: string, state: RelaunchPlanState) => {
    if (priority[state] > priority[states.get(id) ?? "not_analysed"]) states.set(id, state);
  };
  const recordPlan = (id: string, name: string, state: ReturnType<typeof resolveTakeoffRequestUnitState> | undefined,
    belongsToPredecessor: boolean, isLive: boolean) => {
    if (state === "succeeded") remember(id, "analysed");
    if (state === "failed") remember(id, "failed");
    if (isLive && (state === "queued" || state === "running")) remember(id, "in_progress");
    if (belongsToPredecessor && (singlePlan || state === "failed" || state === "not_started")) defaults.set(id, name);
  };

  const predecessorRequest = requests.find(({ units }) => units?.requestId === predecessor.launch_request_id);
  for (const { manifest, units, state } of requests) {
    if (!units) continue;
    const perPlan = new Map(units.units.map((unit) => [unit.planFileId, unit]));
    for (const plan of manifest.plans) {
      const id = plan.plan_file_id.toLowerCase();
      const unit = units.format === "grouped" ? units.units[0] : perPlan.get(id);
      const replaces = units.requestId === predecessor.launch_request_id
        && (!singlePlan || (unit?.jobId === predecessorJobId && (units.format === "per_plan" || manifest.plans.length === 1)));
      recordPlan(id, plan.name, unit?.state, replaces, state === "admitted");
    }
  }
  if (!predecessorRequest) {
    const snapshot = predecessor.preparation_snapshot as TakeoffPreparationSnapshot | null;
    const planId = predecessor.launch_unit_key?.startsWith("plan:") ? predecessor.launch_unit_key.slice(5) : null;
    const plans = (snapshot?.preparation?.sources ?? []).filter((source) => source.active && source.kind === "plan"
      && (planId ? source.document_id === planId : source.plan_set_id !== null));
    const state = predecessor.status === "failed" && !predecessor.analysis_outcome && !predecessor.next_retry_at
      ? "failed" : resolveTakeoffRequestUnitState(predecessor);
    for (const plan of plans) recordPlan(plan.document_id.toLowerCase(), plan.document_name, state,
      !singlePlan || plans.length === 1, state === "running");
  }

  const planSetId = predecessor.plan_set_id;
  const copies = planSetId && defaults.size > 0 ? await currentPlanCopies(service, context, projectId, planSetId, [...defaults.keys()]) : null;
  const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId, projectId,
    ids: [...states.keys(), ...(copies?.scope ?? []), ...(copies?.withoutCopy ?? []).flatMap(({ id, piece }) => [id, piece])] });
  return {
    planSetId,
    defaultIds: (copies?.scope ?? []).filter((id) => isTakeoffSourceVisible(visible, id)
      && (singlePlan || (states.get(id) !== "analysed" && states.get(id) !== "in_progress"))),
    states: Object.fromEntries([...states].filter(([id]) => isTakeoffSourceVisible(visible, id))),
    withoutCopy: (copies?.withoutCopy ?? []).map(({ id, piece, removed }, index) => ({
      name: isTakeoffSourceVisible(visible, id, piece) ? defaults.get(id) ?? `Plan ${index + 1}` : `Plan ${index + 1}`,
      reason: removed ? "removed" : "copy_missing",
    })),
  };
}

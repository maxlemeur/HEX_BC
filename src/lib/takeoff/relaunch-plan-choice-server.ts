import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError, notFound } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
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
  stops: Record<string, "interrupted" | "before_start">;
  eligiblePlanSetIds: string[];
  checkedPlanSetId: string | null;
  currentIds: string[];
  unavailable: Record<string, "removed" | "copy_missing">;
  withoutCopy: TakeoffRelaunchChoice["withoutCopy"];
};

const priority: Record<RelaunchPlanState, number> = { not_analysed: 0, failed: 1, in_progress: 2, analysed: 3 };

/** Read the selected predecessor and the affaire's plan readings, using the same unit states as the activity centre. */
export async function readRelaunchPlanChoice(context: AuthenticatedTenantContext, projectId: string,
  predecessorJobId: string, singlePlan: boolean, selectedPlanSetId?: string): Promise<RelaunchPlanChoice> {
  await assertPreparationProjectAccess(context, projectId, true);
  const service = createServiceRoleClient();
  const [{ data: predecessor, error }, requests, sets] = await Promise.all([
    service.from("takeoff_jobs").select("plan_set_id, launch_request_id, launch_unit_key, preparation_snapshot, status, analysis_outcome, started_at, error_code, next_retry_at")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", predecessorJobId).maybeSingle(),
    readAdmittedPlanRequests(service, context.tenantId, projectId),
    readAllRows(() => context.supabase.from("plan_sets").select("id", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).is("estimate_version_id", null).order("id")),
  ]);
  if (error) throw mapSupabaseError(error, "Impossible de lire l’analyse à relancer.");
  if (!predecessor) throw notFound("Cette analyse n’appartient pas à l’affaire.");
  if (sets.error) throw mapSupabaseError(sets.error, "Impossible de lire les jeux de plans de l’affaire.");

  const states = new Map<string, RelaunchPlanState>();
  const defaults = new Map<string, string>();
  const stops = new Map<string, RelaunchPlanChoice["stops"][string]>();
  const remember = (id: string, state: RelaunchPlanState) => {
    if (priority[state] > priority[states.get(id) ?? "not_analysed"]) states.set(id, state);
  };
  const recordPlan = (id: string, name: string, state: ReturnType<typeof resolveTakeoffRequestUnitState> | undefined,
    belongsToPredecessor: boolean, isLive: boolean, startedAt: string | null | undefined) => {
    if (state === "canceled") {
      if (belongsToPredecessor) stops.set(id, startedAt ? "interrupted" : "before_start");
      state = startedAt ? "failed" : "not_started";
    }
    if (state === "succeeded") remember(id, "analysed");
    if (state === "failed") remember(id, "failed");
    if (isLive && (state === "queued" || state === "running")) remember(id, "in_progress");
    if (belongsToPredecessor && (singlePlan || state === "failed" || state === "not_started")) defaults.set(id, name);
  };

  const predecessorRequest = requests.find(({ units }) => units?.requestId === predecessor.launch_request_id);
  for (const { manifest, units, state, jobs } of requests) {
    if (!units) continue;
    const perPlan = new Map(units.units.map((unit) => [unit.planFileId, unit]));
    const startedAtByJob = new Map(jobs.map((job) => [job.id, job.started_at]));
    for (const plan of manifest.plans) {
      const id = plan.plan_file_id.toLowerCase();
      const unit = units.format === "grouped" ? units.units[0] : perPlan.get(id);
      const replaces = units.requestId === predecessor.launch_request_id
        && (!singlePlan || (unit?.jobId === predecessorJobId && (units.format === "per_plan" || manifest.plans.length === 1)));
      recordPlan(id, plan.name, unit?.state, replaces, state === "admitted", unit && startedAtByJob.get(unit.jobId));
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
      !singlePlan || plans.length === 1, state === "running", predecessor.started_at);
  }

  const eligiblePlanSetIds = (sets.data ?? []).map(({ id }) => id);
  const planSetId = predecessor.plan_set_id && eligiblePlanSetIds.includes(predecessor.plan_set_id) ? predecessor.plan_set_id : null;
  const checkedPlanSetId = selectedPlanSetId && eligiblePlanSetIds.includes(selectedPlanSetId) ? selectedPlanSetId : planSetId;
  const [copies, files] = await Promise.all([
    planSetId && defaults.size > 0 ? currentPlanCopies(service, context, projectId, planSetId, [...defaults.keys()]) : null,
    checkedPlanSetId ? readAllRows(() => context.supabase.from("plan_files").select("id", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("plan_set_id", checkedPlanSetId).order("id")) : null,
  ]);
  if (files?.error) throw mapSupabaseError(files.error, "Impossible de lire les plans de l’affaire.");
  const checked = checkedPlanSetId && files?.data?.length
    ? await currentPlanCopies(service, context, projectId, checkedPlanSetId, files.data.map(({ id }) => id), "exact") : null;
  const withoutCopy = copies?.withoutCopy ?? (!planSetId
    ? [...defaults.keys()].map((id) => ({ id, piece: null, removed: false })) : []);
  const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId, projectId,
    ids: [...states.keys(), ...stops.keys(), ...(copies?.scope ?? []), ...withoutCopy.flatMap(({ id, piece }) => [id, piece])] });
  return {
    planSetId,
    eligiblePlanSetIds,
    checkedPlanSetId,
    currentIds: checked?.scope ?? [],
    unavailable: Object.fromEntries((checked?.withoutCopy ?? []).map(({ id, removed }) => [id, removed ? "removed" : "copy_missing"])),
    defaultIds: (copies?.scope ?? []).filter((id) => isTakeoffSourceVisible(visible, id)
      && (singlePlan || (states.get(id) !== "analysed" && states.get(id) !== "in_progress"))),
    states: Object.fromEntries([...states].filter(([id]) => isTakeoffSourceVisible(visible, id))),
    stops: Object.fromEntries([...stops].filter(([id]) => isTakeoffSourceVisible(visible, id))),
    withoutCopy: withoutCopy.map(({ id, piece, removed }, index) => ({
      name: isTakeoffSourceVisible(visible, id, piece) ? defaults.get(id) ?? `Plan ${index + 1}` : `Plan ${index + 1}`,
      reason: removed ? "removed" : "copy_missing",
    })),
  };
}

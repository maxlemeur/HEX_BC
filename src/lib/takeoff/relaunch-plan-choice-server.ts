import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError, notFound } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readPlanCopyDigest } from "./plan-copy-digest-server";
import { admittedContent, readAdmittedPlanRequests, readingThroughOtherCopy } from "./admitted-plan-readings-server";
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
  readThrough: Record<string, string>;
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
  const [{ data: predecessor, error }, requests, sets, olderJobs] = await Promise.all([
    service.from("takeoff_jobs").select("plan_set_id, launch_request_id, launch_unit_key, preparation_snapshot, status, analysis_outcome, started_at, error_code, next_retry_at")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", predecessorJobId).maybeSingle(),
    readAdmittedPlanRequests(service, context.tenantId, projectId),
    readAllRows(() => context.supabase.from("plan_sets").select("id", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).is("estimate_version_id", null).order("id")),
    readAllRows(() => service.from("takeoff_jobs").select(
      "id, launch_unit_key, preparation_snapshot, status, analysis_outcome, started_at, error_code, next_retry_at", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).is("launch_request_id", null)
      .not("preparation_snapshot", "is", null)),
  ]);
  if (error) throw mapSupabaseError(error, "Impossible de lire l’analyse à relancer.");
  if (!predecessor) throw notFound("Cette analyse n’appartient pas à l’affaire.");
  if (sets.error) throw mapSupabaseError(sets.error, "Impossible de lire les jeux de plans de l’affaire.");

  if (olderJobs.error) throw mapSupabaseError(olderJobs.error, "Impossible de lire les anciennes analyses de l’affaire.");
  const history = admittedContent(requests);
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
  const historical = (olderJobs.data ?? []).filter(job => job.id !== predecessorJobId);
  if (!predecessorRequest) historical.push({ ...predecessor, id: predecessorJobId });
  for (const job of historical) {
    const snapshot = job.preparation_snapshot as TakeoffPreparationSnapshot | null;
    const planId = job.launch_unit_key?.startsWith("plan:") ? job.launch_unit_key.slice(5) : null;
    const plans = (snapshot?.preparation?.sources ?? []).filter(source => source.active && source.kind === "plan"
      && (planId ? source.document_id === planId : Boolean(source.plan_set_id)));
    const state = job.status === "failed" && !job.analysis_outcome && !job.next_retry_at
      ? "failed" : resolveTakeoffRequestUnitState(job);
    for (const plan of plans) {
      const id = plan.document_id.toLowerCase();
      const hasReading = state === "succeeded" || state === "running" || state === "queued";
      // A historical file can be replaced in place. Only the predecessor's
      // retry choice is known before comparing the bytes its snapshot read.
      if (job.id === predecessorJobId) {
        recordPlan(id, plan.document_name, hasReading ? undefined : state, !singlePlan || plans.length === 1,
          false, job.started_at);
      }
      if (plan.content_hash && hasReading) {
        const readings = history.get(plan.content_hash) ?? [];
        readings.push({ id, name: plan.document_name, documentId: null, state: state === "succeeded" ? "analysed" : "in_progress" });
        history.set(plan.content_hash, readings);
      }
    }
  }

  const eligiblePlanSetIds = (sets.data ?? []).map(({ id }) => id);
  const planSetId = predecessor.plan_set_id && eligiblePlanSetIds.includes(predecessor.plan_set_id) ? predecessor.plan_set_id : null;
  const checkedPlanSetId = selectedPlanSetId && eligiblePlanSetIds.includes(selectedPlanSetId) ? selectedPlanSetId : planSetId;
  const [copies, files] = await Promise.all([
    planSetId && defaults.size > 0 ? currentPlanCopies(service, context, projectId, planSetId, [...defaults.keys()]) : null,
    checkedPlanSetId ? readAllRows(() => context.supabase.from("plan_files").select("id, plan_set_id, file_path, file_name, file_size_bytes", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("plan_set_id", checkedPlanSetId).order("id")) : null,
  ]);
  if (files?.error) throw mapSupabaseError(files.error, "Impossible de lire les plans de l’affaire.");
  const checked = checkedPlanSetId && files?.data?.length
    ? await currentPlanCopies(service, context, projectId, checkedPlanSetId, files.data.map(({ id }) => id), "exact") : null;
  const withoutCopy = copies?.withoutCopy ?? (!planSetId
    ? [...defaults.keys()].map((id) => ({ id, piece: null, removed: false })) : []);
  const twins = new Map<string, NonNullable<ReturnType<typeof readingThroughOtherCopy>>>();
  const current = new Set(checked?.scope);
  if (history.size) {
    for (const file of files?.data ?? []) {
      if (!current.has(file.id) || states.get(file.id) === "analysed") continue;
      const digest = await readPlanCopyDigest(context, file);
      if (!digest) continue;
      const readings = history.get(digest);
      for (const reading of readings ?? []) {
        if (reading.id === file.id) remember(file.id, reading.state);
      }
      const prior = readingThroughOtherCopy(readings, file.id);
      if (prior && priority[prior.state] >= priority[states.get(file.id) ?? "not_analysed"]) {
        remember(file.id, prior.state);
        twins.set(file.id, prior);
      }
    }
  }
  const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId, projectId,
    ids: [...[...twins.values()].flatMap(prior => [prior.id, prior.documentId]), ...states.keys(), ...stops.keys(), ...(copies?.scope ?? []), ...withoutCopy.flatMap(({ id, piece }) => [id, piece])] });
  return {
    planSetId,
    eligiblePlanSetIds,
    checkedPlanSetId,
    currentIds: checked?.scope ?? [],
    unavailable: Object.fromEntries((checked?.withoutCopy ?? []).map(({ id, removed }) => [id, removed ? "removed" : "copy_missing"])),
    readThrough: Object.fromEntries([...twins].filter(([, prior]) => isTakeoffSourceVisible(visible, prior.id, prior.documentId))
      .map(([id, prior]) => [id, prior.name])),
    defaultIds: (copies?.scope ?? []).filter((id) => isTakeoffSourceVisible(visible, id)
      && !twins.has(id) && (singlePlan || (states.get(id) !== "analysed" && states.get(id) !== "in_progress"))),
    states: Object.fromEntries([...states].filter(([id]) => isTakeoffSourceVisible(visible, id))),
    stops: Object.fromEntries([...stops].filter(([id]) => isTakeoffSourceVisible(visible, id))),
    withoutCopy: withoutCopy.map(({ id, piece, removed }, index) => ({
      name: isTakeoffSourceVisible(visible, id, piece) ? defaults.get(id) ?? `Plan ${index + 1}` : `Plan ${index + 1}`,
      reason: removed ? "removed" : "copy_missing",
    })),
  };
}

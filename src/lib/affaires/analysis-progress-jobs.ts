import "server-only";

import type { analysisProgressPages } from "@/lib/affaires/analysis-progress-pages";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";

const PROJECT_PREFILTER_LIMIT = 32;
const RETRY_FILTER = "status.eq.failed,execution_provider.eq.chatgpt_local,next_retry_at.not.is.null";
const ENDED_FILTER = "status.neq.failed,execution_provider.neq.chatgpt_local,next_retry_at.is.null";
export const JOB_COLUMNS = "id, status, estimate_version_id, processing_strategy, provider_batch_state, error_code, created_at, completed_at, analysis_finished_at, analysis_completion_event_id, execution_provider, next_retry_at, plan_set_id, launch_unit_key, exceptions:takeoff_dpgf_review_decisions!takeoff_dpgf_review_decisions_takeoff_job_id_fkey(id)";
export type Job = Pick<Database["public"]["Tables"]["takeoff_jobs"]["Row"],
  "id" | "status" | "estimate_version_id" | "processing_strategy" | "provider_batch_state" | "error_code" |
  "created_at" | "completed_at" | "analysis_finished_at" | "execution_provider" | "next_retry_at" |
  "plan_set_id" | "launch_unit_key"> & { exceptions: Array<{ id: string }> };
export type StandaloneJob = Job & Pick<Database["public"]["Tables"]["takeoff_jobs"]["Row"],
  "analysis_completion_event_id" | "created_by" | "analysis_requested_by" | "updated_at"> & {
  project: { id: string; name: string };
};
export const STANDALONE_JOB_LANES = ["jobLive", "jobRetry", "jobAnalysisEnd", "jobCompletedEnd", "jobLegacyEnd"] as const;
export type StandaloneJobLane = (typeof STANDALONE_JOB_LANES)[number];

export type StandaloneJobScope = {
  supabase: ServerSupabaseClient;
  tenantId: string;
  /** The owner the affaires must have, or null when the member reads every affaire of the tenant. */
  owner: string | null;
  /** Ends after this instant are discoverable. */
  cutoff: string;
  /** Live work updated after this instant is discoverable. */
  activityCutoff: string;
  pages: ReturnType<typeof analysisProgressPages>;
};

function emptyLanes(): Record<StandaloneJobLane, StandaloneJob[]> {
  return { jobLive: [], jobRetry: [], jobAnalysisEnd: [], jobCompletedEnd: [], jobLegacyEnd: [] };
}

type DateColumn = "updated_at" | "completed_at" | "analysis_finished_at";
type Windows = Pick<StandaloneJobScope, "cutoff" | "activityCutoff">;
/** The filters of one lane, on the takeoff_jobs resource the lane embeds. */
type LaneFilter = {
  eq(column: string, value: string): LaneFilter;
  is(column: string, value: null | boolean): LaneFilter;
  not(column: string, operator: "in" | "is", value: string | null): LaneFilter;
  gt(column: string, value: string): LaneFilter;
  or(filter: string): LaneFilter;
};
type EmbedRequest = {
  eq(column: string, value: string): unknown;
  is(column: string, value: null | boolean): unknown;
  not(column: string, operator: string, value: string | null): unknown;
  gt(column: string, value: string): unknown;
  in(column: string, values: readonly string[]): unknown;
  or(filter: string, options: { referencedTable: string }): unknown;
  limit(count: number, options: { referencedTable: string }): unknown;
};

const ended = (filter: LaneFilter) => filter.not("status", "in", "(pending,processing)").or(ENDED_FILTER);
const JOB_LANES: ReadonlyArray<{ lane: StandaloneJobLane; date: DateColumn; filter(filter: LaneFilter, windows: Windows): LaneFilter }> = [
  // The indexed updated_at range keeps old undated ends out of the live scan.
  { lane: "jobLive", date: "updated_at", filter: (filter, { activityCutoff }) => filter.is("analysis_finished_at", null)
    .is("completed_at", null).gt("updated_at", activityCutoff).or(`status.in.(pending,processing),and(${RETRY_FILTER})`) },
  { lane: "jobRetry", date: "completed_at", filter: (filter, { activityCutoff }) => filter.is("analysis_finished_at", null)
    .not("completed_at", "is", null).gt("completed_at", activityCutoff).eq("status", "failed")
    .eq("execution_provider", "chatgpt_local").not("next_retry_at", "is", null) },
  { lane: "jobAnalysisEnd", date: "analysis_finished_at", filter: (filter, { cutoff }) => ended(filter)
    .not("analysis_finished_at", "is", null).gt("analysis_finished_at", cutoff) },
  { lane: "jobCompletedEnd", date: "completed_at", filter: (filter, { cutoff }) => ended(filter)
    .is("analysis_finished_at", null).not("completed_at", "is", null).gt("completed_at", cutoff) },
  { lane: "jobLegacyEnd", date: "updated_at", filter: (filter, { cutoff }) => ended(filter)
    .is("analysis_finished_at", null).is("completed_at", null).gt("updated_at", cutoff) },
];
const JOB_LANE_COLUMNS = `${JOB_COLUMNS}, created_by, analysis_requested_by, updated_at, project:estimate_projects!takeoff_jobs_project_tenant_fkey!inner(id,name)`;

/** The filters of the lane embedded as `alias` in a request on the member's tenant. */
function embeddedLane(request: EmbedRequest, alias: string): LaneFilter {
  const column = (name: string) => `${alias}.${name}`;
  const filter: LaneFilter = {
    eq: (name, value) => (request.eq(column(name), value), filter),
    is: (name, value) => (request.is(column(name), value), filter),
    not: (name, operator, value) => (request.not(column(name), operator, value), filter),
    gt: (name, value) => (request.gt(column(name), value), filter),
    or: (condition) => (request.or(condition, { referencedTable: alias }), filter),
  };
  return filter;
}

/**
 * The standalone jobs of each lane on the current page, for the member's readable affaires of the tenant.
 * The lanes are read in one PostgREST request: the member's tenant row embeds takeoff_jobs once per lane,
 * each embedding with the lane's own filters, keyset, order and limit. Every embedded row stays under the
 * RLS of its own table, so the tenant row adds no visibility; it only groups the lanes in one round trip.
 */
export async function readStandaloneJobLanes(scope: StandaloneJobScope): Promise<Record<StandaloneJobLane, StandaloneJob[]>> {
  const { supabase, tenantId, owner, pages } = scope;

  async function readJobProjectPrefilter() {
    if (!owner) return null;
    const { data, error } = await supabase.from("estimate_projects").select("id")
      .eq("tenant_id", tenantId).eq("user_id", owner).is("is_archived", false).limit(PROJECT_PREFILTER_LIMIT + 1);
    if (error) throw mapSupabaseError(error, "Impossible de lire les affaires du suivi.");
    return data.length <= PROJECT_PREFILTER_LIMIT ? data.map(({ id }) => id) : null;
  }

  const result = emptyLanes();
  const projectIds = await readJobProjectPrefilter();
  if (projectIds?.length === 0) return result;
  const lanes = JOB_LANES.flatMap((lane) => {
    const page = pages.page<StandaloneJob>(lane.lane, lane.date);
    return page ? [{ ...lane, page }] : [];
  });
  if (!lanes.length) return result;
  const request = supabase.from("tenants")
    .select(["id", ...lanes.map(({ lane }) => `${lane}:takeoff_jobs!takeoff_jobs_tenant_id_fkey(${JOB_LANE_COLUMNS})`)].join(", "))
    .eq("id", tenantId);
  for (const { lane, page, filter } of lanes) {
    const embedded = embeddedLane(request, lane);
    embedded.eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).is("project.is_archived", false)
      .is("launch_request_id", null);
    // Each review needs only an existence witness.
    request.limit(1, { referencedTable: `${lane}.exceptions` });
    if (projectIds) request.in(`${lane}.project_id`, projectIds);
    if (owner) embedded.eq("project.user_id", owner);
    filter(embedded, scope);
    page.bound(request, lane);
  }
  const { data, error } = await request.maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire le suivi des analyses.");
  // Without a readable tenant row, no job of the tenant is readable either.
  const row = data as Partial<Record<StandaloneJobLane, StandaloneJob[]>> | null;
  for (const { lane, page } of lanes) result[lane] = page.settle(row?.[lane] ?? null);
  return result;
}

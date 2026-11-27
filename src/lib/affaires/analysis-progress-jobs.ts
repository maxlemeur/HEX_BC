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

/** The standalone jobs of each lane on the current page, for the member's readable affaires of the tenant. */
export async function readStandaloneJobLanes(scope: StandaloneJobScope): Promise<Record<StandaloneJobLane, StandaloneJob[]>> {
  const { supabase, tenantId, owner, cutoff, activityCutoff, pages } = scope;

  async function readJobProjectPrefilter() {
    if (!owner) return null;
    const { data, error } = await supabase.from("estimate_projects").select("id")
      .eq("tenant_id", tenantId).eq("user_id", owner).is("is_archived", false).limit(PROJECT_PREFILTER_LIMIT + 1);
    if (error) throw mapSupabaseError(error, "Impossible de lire les affaires du suivi.");
    return data.length <= PROJECT_PREFILTER_LIMIT ? data.map(({ id }) => id) : null;
  }

  const readJobs = (projectIds: string[] | null) => {
    const query = supabase.from("takeoff_jobs").select(
      `${JOB_COLUMNS}, created_by, analysis_requested_by, updated_at, project:estimate_projects!takeoff_jobs_project_tenant_fkey!inner(id,name)`,
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).is("project.is_archived", false)
      .is("launch_request_id", null).limit(1, { referencedTable: "exceptions" });
    if (projectIds) query.in("project_id", projectIds);
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const projectIds = await readJobProjectPrefilter();
  if (projectIds?.length === 0) return emptyLanes();
  const ended = () => readJobs(projectIds).not("status", "in", "(pending,processing)").or(ENDED_FILTER);
  const [jobLive, jobRetry, jobAnalysisEnd, jobCompletedEnd, jobLegacyEnd] = await Promise.all([
    // The indexed updated_at range keeps old undated ends out of the live scan.
    pages.read("jobLive", () => readJobs(projectIds).is("analysis_finished_at", null).is("completed_at", null)
      .gt("updated_at", activityCutoff).or(`status.in.(pending,processing),and(${RETRY_FILTER})`), "updated_at"),
    pages.read("jobRetry", () => readJobs(projectIds).is("analysis_finished_at", null).not("completed_at", "is", null)
      .gt("completed_at", activityCutoff).eq("status", "failed").eq("execution_provider", "chatgpt_local")
      .not("next_retry_at", "is", null), "completed_at"),
    pages.read("jobAnalysisEnd", () => ended().not("analysis_finished_at", "is", null)
      .gt("analysis_finished_at", cutoff), "analysis_finished_at"),
    pages.read("jobCompletedEnd", () => ended().is("analysis_finished_at", null).not("completed_at", "is", null)
      .gt("completed_at", cutoff), "completed_at"),
    pages.read("jobLegacyEnd", () => ended().is("analysis_finished_at", null).is("completed_at", null)
      .gt("updated_at", cutoff), "updated_at"),
  ]);
  return { jobLive, jobRetry, jobAnalysisEnd, jobCompletedEnd, jobLegacyEnd };
}

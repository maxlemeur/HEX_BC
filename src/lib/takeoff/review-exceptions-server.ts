import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function listJobsWithBlockingExceptions(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[]
): Promise<Set<string>> {
  if (jobIds.length === 0) {
    return new Set();
  }

  const jobsWithExceptions = new Set<string>();

  const { data, error } = await readAllRowsInChunks(jobIds, (pageIds) => supabase
    .from("takeoff_dpgf_review_decisions")
    .select("takeoff_job_id, id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .in("takeoff_job_id", pageIds));

  if (error) return new Set();
  for (const row of data ?? []) {
    jobsWithExceptions.add(row.takeoff_job_id);
  }

  return jobsWithExceptions;
}

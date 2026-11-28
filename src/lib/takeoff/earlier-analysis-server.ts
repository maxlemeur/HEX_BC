import "server-only";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { listTakeoffItemsByJobId } from "@/lib/takeoff/job-read-server";
import { earlierAnalysisView, EARLIER_ANALYSIS_ROWS_SHOWN, keptWarnings, type EarlierAnalysisView } from "./earlier-analysis";
import type { TakeoffLinkJobFacts } from "./review-link";
import { readTakeoffRequestsReadingList, readTakeoffReviewLinkFacts } from "./review-link-server";
import { UUID_PATTERN as UUID } from "@/lib/value-guards";

/**
 * The reads of « Analyse antérieure » (earlier-analysis.ts), with the member's session in the affaire the member reads
 * (requireAffaireAccess): the rules of the jobs, their results and rows decide what is shown, as for their review.
 */

/** The most recent jobs looked at for the list beside the table, and how many of them it names. */
const JOBS_READ = 50;
const LISTED = 10;

function readFailure(error: { code?: string; message: string }): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, "Impossible de lire les analyses antérieures de l’affaire.");
}

export type EarlierAnalysisEntry = { jobId: string; status: string; level: string; fileName: string | null; at: string };

/**
 * The analyses beside the table of items: only once the affaire has a list (before, the table says the list is not
 * recorded and the analyses stay in « Suivi des analyses »), the most recent ones that were not read against it.
 */
export async function listEarlierTakeoffAnalyses(projectId: string): Promise<{ entries: EarlierAnalysisEntry[]; more: boolean } | null> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const [{ data: list, error: listError }, { data: jobs, error: jobsError }] = await Promise.all([
    context.supabase.from("takeoff_list_revisions").select("id").eq("tenant_id", context.tenantId).eq("project_id", project.id).limit(1),
    context.supabase.from("takeoff_jobs").select("id, status, level, source_file_name, completed_at, created_at, launch_request_id")
      .eq("tenant_id", context.tenantId).eq("project_id", project.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(JOBS_READ),
  ]);
  if (listError) readFailure(listError);
  if (jobsError) readFailure(jobsError);
  if (!list?.length) return null;
  const sealed = await readTakeoffRequestsReadingList(context.supabase, context.tenantId, (jobs ?? []).map((job) => job.launch_request_id));
  const earlier = (jobs ?? []).filter((job) => !job.launch_request_id || !sealed.has(job.launch_request_id.toLowerCase()));
  return {
    entries: earlier.slice(0, LISTED).map((job) => ({ jobId: job.id, status: job.status, level: job.level, fileName: job.source_file_name,
      at: job.completed_at ?? job.created_at })),
    more: earlier.length > LISTED,
  };
}

/**
 * One analysis of the affaire as an earlier analysis; « list » for a job read against the list (it is not one: the table
 * shows it), null when the member reads no such job in this affaire.
 */
export async function readEarlierTakeoffAnalysis(projectId: string, jobId: string):
  Promise<{ kind: "earlier"; view: EarlierAnalysisView } | { kind: "list"; facts: TakeoffLinkJobFacts; projectId: string } | null> {
  if (!UUID.test(jobId)) return null;
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const id = jobId.toLowerCase();
  const { data: job, error } = await context.supabase.from("takeoff_jobs")
    .select("id, status, level, source_file_name, completed_at, created_at, error_code, estimate_version_id")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", id).maybeSingle();
  if (error) readFailure(error);
  if (!job) return null;
  const facts = await readTakeoffReviewLinkFacts({ supabase: context.supabase, tenantId: context.tenantId, projectId: project.id,
    jobId: id, versionId: null, line: null });
  if (facts.readsList) return { kind: "list", facts, projectId: project.id };
  const [{ data: result, error: resultError }, rows] = await Promise.all([
    context.supabase.from("takeoff_results").select("warnings, tables, provider_meta").eq("tenant_id", context.tenantId).eq("job_id", id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    listTakeoffItemsByJobId({ supabase: context.supabase, tenantId: context.tenantId, jobId: id, limit: EARLIER_ANALYSIS_ROWS_SHOWN, offset: 0 }),
  ]);
  if (resultError) readFailure(resultError);
  return { kind: "earlier", view: earlierAnalysisView({ job, result: result ?? null, rows: rows.data, rowsTotal: rows.total }) };
}

/**
 * The analysis a link to a review named, as the table's explanation names it: a job of this affaire read against the
 * list, its plan's file, when it ended, and the warnings its reading kept (what its review showed beside its rows: the
 * works seen outside the list, the readings left out). Null for any other job.
 */
export async function readLinkedListAnalysis(projectId: string, jobId: string) {
  if (!UUID.test(jobId)) return null;
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const id = jobId.toLowerCase();
  const [{ data: job, error }, facts] = await Promise.all([
    context.supabase.from("takeoff_jobs").select("id, source_file_name, completed_at, created_at")
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", id).maybeSingle(),
    readTakeoffReviewLinkFacts({ supabase: context.supabase, tenantId: context.tenantId, projectId: project.id, jobId: id,
      versionId: null, line: null }),
  ]);
  if (error) readFailure(error);
  if (!job || !facts.readsList) return null;
  const { data: result, error: resultError } = await context.supabase.from("takeoff_results").select("warnings")
    .eq("tenant_id", context.tenantId).eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (resultError) readFailure(resultError);
  const { warnings, unreadable } = keptWarnings(result?.warnings);
  return { fileName: job.source_file_name, at: job.completed_at ?? job.created_at, warnings, unreadableWarnings: unreadable };
}

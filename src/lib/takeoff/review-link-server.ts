import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";
import type { TakeoffLinkJobFacts } from "./review-link";

/**
 * What the server proves of a link's job, with the member's session (the rules of the jobs, their requests, the answers
 * and the send's targets: every reader of the affaire reads them), after the review's own access check. A job is read
 * against the list when its launch request sealed the affaire's list (`item_list_revision_id`, recorded at its
 * admission). Nothing here is a right: it only decides which screen shows what the member may already read.
 */

type Client = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 200;

function readFailure(error: { code?: string; message: string }): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, "Impossible de retrouver l’analyse de ce lien.");
}

const chunks = <T,>(values: readonly T[]) => Array.from({ length: Math.ceil(values.length / CHUNK) },
  (_, index) => values.slice(index * CHUNK, (index + 1) * CHUNK));

/** The jobs among these that were read against their affaire's list, as the member reads them (two reads per 200 jobs). */
export async function readTakeoffJobsReadingList(supabase: Client, tenantId: string, jobIds: readonly (string | null)[]) {
  const ids = [...new Set(jobIds.filter((id): id is string => typeof id === "string" && UUID.test(id)).map((id) => id.toLowerCase()))];
  const reading = new Set<string>();
  for (const part of chunks(ids)) {
    const { data: jobs, error } = await supabase.from("takeoff_jobs").select("id, launch_request_id")
      .eq("tenant_id", tenantId).in("id", part).not("launch_request_id", "is", null);
    if (error) readFailure(error);
    const requests = [...new Set((jobs ?? []).map((job) => job.launch_request_id!.toLowerCase()))];
    if (!requests.length) continue;
    const { data: lists, error: listError } = await supabase.from("takeoff_launch_requests").select("id")
      .eq("tenant_id", tenantId).in("id", requests).not("item_list_revision_id", "is", null);
    if (listError) readFailure(listError);
    const sealed = new Set((lists ?? []).map((request) => request.id.toLowerCase()));
    for (const job of jobs ?? []) if (sealed.has(job.launch_request_id!.toLowerCase())) reading.add(job.id.toLowerCase());
  }
  return reading;
}

/** Whether these launch requests sealed their affaire's list, as the member reads them. */
export async function readTakeoffRequestsReadingList(supabase: Client, tenantId: string, requestIds: readonly (string | null)[]) {
  const ids = [...new Set(requestIds.filter((id): id is string => typeof id === "string" && UUID.test(id)).map((id) => id.toLowerCase()))];
  const sealed = new Set<string>();
  for (const part of chunks(ids)) {
    const { data, error } = await supabase.from("takeoff_launch_requests").select("id")
      .eq("tenant_id", tenantId).in("id", part).not("item_list_revision_id", "is", null);
    if (error) readFailure(error);
    for (const request of data ?? []) sealed.add(request.id.toLowerCase());
  }
  return sealed;
}

/**
 * The facts of a review link's job, once the review's access check passed for this affaire, job and version: whether it
 * read the list, the plan it read (the logical identity its answers name, as the table names plans), and for an estimate
 * line of the link's version the item the send by item wrote it from (its live target), with whether this job answered
 * that item. A line that is not an identifier, or that no live target names, names no item.
 */
export async function readTakeoffReviewLinkFacts(input: { supabase: Client; tenantId: string; projectId: string; jobId: string;
  versionId: string | null; line: string | null }): Promise<TakeoffLinkJobFacts> {
  const { supabase, tenantId, projectId, jobId } = input;
  const reading = await readTakeoffJobsReadingList(supabase, tenantId, [jobId]);
  if (!reading.has(jobId.toLowerCase())) return { readsList: false };
  const { data: answers, error } = await supabase.from("takeoff_item_answers").select("plan_logical_id")
    .eq("tenant_id", tenantId).eq("project_id", projectId).eq("job_id", jobId).limit(1);
  if (error) readFailure(error);
  const planKey = answers?.[0]?.plan_logical_id?.toLowerCase() ?? null;
  if (!input.line || !UUID.test(input.line) || !input.versionId) return { readsList: true, planKey, line: null };
  const { data: target, error: targetError } = await supabase.from("takeoff_item_send_targets").select("item_id")
    .eq("tenant_id", tenantId).eq("project_id", projectId).eq("version_id", input.versionId)
    .eq("estimate_item_id", input.line.toLowerCase()).maybeSingle();
  if (targetError) readFailure(targetError);
  if (!target) return { readsList: true, planKey, line: null };
  const itemId = target.item_id.toLowerCase();
  const { data: answered, error: answeredError } = await supabase.from("takeoff_item_answers").select("id")
    .eq("tenant_id", tenantId).eq("project_id", projectId).eq("job_id", jobId).eq("item_id", itemId).limit(1);
  if (answeredError) readFailure(answeredError);
  return { readsList: true, planKey, line: { itemId, answered: Boolean(answered?.length) } };
}

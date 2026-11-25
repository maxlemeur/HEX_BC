import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { IN_FILTER_CHUNK_SIZE } from "@/lib/supabase/in-chunks";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { describeTakeoffTrackingStatus } from "@/lib/takeoff/job-list-labels";
import { isTakeoffSourceVisible, parseTakeoffRequestManifest, resolveTakeoffRequestUnitState } from "@/lib/takeoff/request-activity";
import { readTakeoffVisibleSources } from "@/lib/takeoff/source-visibility-server";
import type { TakeoffActivityCenterJobRow, TakeoffActivityPlan } from "@/lib/takeoff/types";

type Supabase = AuthenticatedTakeoffContext["supabase"];
type TrackingSource = {
  id: string;
  launch_request_id?: string | null;
  launch_unit_key?: string | null;
  source_file_name: string | null;
  analysis_completion_event_id?: string | null;
};
type TrackingJob = TrackingSource & {
  estimate_version_id: string | null;
  status: string;
  level: string;
  created_at: string;
  started_at?: string | null;
  analysis_outcome?: string | null;
  error_code?: string | null;
  next_retry_at?: string | null;
};
type ManifestRow = {
  id: string;
  format_version: number | null;
  order_kind: string | null;
  revision: string | null;
  asked_items: string[] | null;
  units: unknown;
  plans: unknown;
};
type PlanScope = { plans: TakeoffActivityPlan[]; key: string | null };
type PreviousAttempts = NonNullable<TakeoffActivityCenterJobRow["previousAttempts"]>;

export function takeoffTrackingNotStarted(job: TrackingJob) {
  return resolveTakeoffRequestUnitState({
    status: job.status, started_at: job.started_at ?? null,
    analysis_outcome: job.analysis_outcome ?? null, error_code: job.error_code ?? null,
  }) === "not_started";
}

/** Associate ends only with analyses visible through the member client, even where the shared end has wider readership. */
export async function readActivityTrackingSources(
  supabase: Supabase, tenantId: string, projectId: string, jobs: readonly TrackingSource[], eventIds: readonly string[],
) {
  const knownEvents = new Set(jobs.map((job) => job.analysis_completion_event_id));
  const extra = await readAllRowsInChunks(eventIds.filter((id) => !knownEvents.has(id)), (ids) =>
    supabase.from("takeoff_jobs")
      .select("id, launch_request_id, launch_unit_key, source_file_name, analysis_completion_event_id", { count: "exact" })
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("analysis_completion_event_id", ids));
  if (extra.error) throw mapSupabaseError(extra.error, "Impossible de lire les sources des analyses.");
  const sources = [...jobs, ...(extra.data ?? [])];
  const scopes = new Map<string, PlanScope>();
  const eventPlans = new Map<string, TakeoffActivityPlan[]>();
  const requestIds = sources.flatMap((job) => job.launch_request_id ? [job.launch_request_id] : []);
  const manifests = new Map<string, { manifest: ReturnType<typeof parseTakeoffRequestManifest>; orderKey: string | null }>();
  if (requestIds.length > 0) {
    // The sealed manifest is server-only. Its names and pages are filtered by precisely the plan activity's source rule.
    const service = createServiceRoleClient();
    const { data, error } = await readAllRowsInChunks(requestIds, (ids) => service.from("takeoff_launch_requests")
      .select("id, format_version:manifest->format_version, order_kind:manifest->order->>kind, revision:manifest->order->list->>revision_id, asked_items:manifest->order->list->asked_item_ids, units:manifest->units, plans:manifest->plans", { count: "exact" })
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("id", ids));
    if (error) throw mapSupabaseError(error, "Impossible de lire les fichiers des analyses.");
    for (const row of (data ?? []) as ManifestRow[]) {
      const orderKey = row.order_kind === "free_extraction" ? "free_extraction" :
        row.revision ? JSON.stringify([row.revision, row.asked_items]) : null;
      manifests.set(row.id, { manifest: parseTakeoffRequestManifest(row), orderKey });
    }
  }
  const sourceIds = [...new Set([...manifests.values()].flatMap(({ manifest }) => [...(manifest?.plans.values() ?? [])]
    .flatMap((plan) => [plan.planFileId, plan.logicalId, plan.documentId].filter((id): id is string => id !== null))))];
  const visible = { planFiles: new Set<string>(), documents: new Set<string>() };
  let allSourcesVisible = false;
  for (let offset = 0; offset < sourceIds.length; offset += IN_FILTER_CHUNK_SIZE) {
    const part = await readTakeoffVisibleSources({
      supabase, tenantId, projectId, ids: sourceIds.slice(offset, offset + IN_FILTER_CHUNK_SIZE),
    });
    if (part === "all") {
      allSourcesVisible = true;
      break;
    }
    for (const id of part.planFiles) visible.planFiles.add(id);
    for (const id of part.documents) visible.documents.add(id);
  }
  const sourceIsVisible = (plan: { planFileId: string | null; logicalId: string | null; documentId: string | null }) =>
    allSourcesVisible || isTakeoffSourceVisible(visible, plan.planFileId, plan.logicalId, plan.documentId);
  for (const job of sources) {
    const request = job.launch_request_id ? manifests.get(job.launch_request_id) : undefined;
    const manifest = request?.manifest;
    const unit = manifest?.units.find((entry) => entry.key === job.launch_unit_key);
    const entries = (unit?.plans ?? []).map((id) => manifest?.plans.get(id));
    const plans = job.launch_request_id
      ? entries.map((plan, index) => {
        if (plan && sourceIsVisible(plan)) {
          return { name: plan.name, pages: plan.pages };
        }
        return { name: `Plan ${entries.length === 1 ? unit?.ordinal ?? 1 : index + 1}`, pages: [] };
      })
      : job.source_file_name ? [{ name: job.source_file_name, pages: [] }] : [];
    const plan = entries.length === 1 ? entries[0] : undefined;
    const key = plan?.planFileId && request?.orderKey && sourceIsVisible(plan)
      ? JSON.stringify([plan.planFileId, plan.pages, request.orderKey]) : null;
    scopes.set(job.id, { plans, key });
    if (job.analysis_completion_event_id && plans.length > 0) {
      eventPlans.set(job.analysis_completion_event_id, plans);
    }
  }
  return { scopes, eventPlans };
}

/** Jobs arrive newest first. Only closed attempts of the same known scope can move below a newer row. */
export function groupActivityTrackingAttempts<T extends TrackingJob>(jobs: readonly T[], scopes: ReadonlyMap<string, PlanScope>) {
  const latest = new Map<string, T>();
  const previousAttempts = new Map<string, PreviousAttempts>();
  const rows = jobs.filter((job) => {
    const scope = scopes.get(job.id)?.key;
    if (!scope) return true;
    const key = JSON.stringify([scope, job.estimate_version_id, job.level]);
    const newer = latest.get(key);
    if (!newer) {
      latest.set(key, job);
      return true;
    }
    const read = job.status === "completed" || job.status === "applied";
    const closed = read || job.status === "canceled"
      || (job.status === "failed" && (!job.next_retry_at || job.analysis_outcome === "failure"));
    // An unfruitful relaunch does not replace an earlier usable result.
    if (!closed || (read && newer.status !== "completed" && newer.status !== "applied")) return true;
    const attempts = previousAttempts.get(newer.id) ?? [];
    attempts.push({
      jobId: job.id, createdAt: job.created_at,
      statusLabel: describeTakeoffTrackingStatus({
        status: job.status, fallback: "État non renseigné", errorCode: job.error_code,
        notStarted: takeoffTrackingNotStarted(job),
      }),
    });
    previousAttempts.set(newer.id, attempts);
    return false;
  });
  return { rows, previousAttempts };
}

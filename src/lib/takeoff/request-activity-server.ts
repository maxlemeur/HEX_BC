import "server-only";

import { createHash } from "node:crypto";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { readDossierChangeSinceAnalysis } from "@/lib/takeoff/launch-request-server";
import {
  describeTakeoffLaunchAction,
  resolveTakeoffOperatorState,
  toTakeoffOperatorStateInput,
  viewerLaunchAction,
  type TakeoffOperatorStateRow,
  type TakeoffResumeViewer,
} from "@/lib/takeoff/operator-state";
import {
  buildTakeoffRequestActivity,
  deriveTakeoffRequestUnits,
  parseTakeoffRequestManifest,
  takeoffRequestProgress,
  takeoffRequestRefreshInterval,
  type TakeoffRequestJobRow,
  type TakeoffRequestManifest,
  type TakeoffRequestRow,
  type TakeoffRequestUnitJobRow,
} from "@/lib/takeoff/request-activity";
import type {
  TakeoffRequestActivity,
  TakeoffRequestActivityResponse,
  TakeoffRequestActivityView,
} from "@/lib/takeoff/request-activity-contracts";
import { readTakeoffExecution, toTakeoffResumeViewer } from "@/lib/takeoff/resume-viewer-server";

export const TAKEOFF_REQUEST_HISTORY_DEFAULT_LIMIT = 5;
export const TAKEOFF_REQUEST_HISTORY_MAX_LIMIT = 20;
/** Bounds a read whose size the manifests already bound (20 plans a request, one page of requests); never reached. */
const MAX_JOBS_READ = 1_000;

/** The columns of a request its readers may read (migration 20261121170448: the grant to authenticated). */
const REQUEST_COLUMNS = "id, origin, intent, state, reason_code, reason_details, outcome, mandate_revision, units_expected, "
  + "created_at, admitted_at, closed_at";
/** What the resume policy reads, as the list and the detail read it: read by the server, never returned. */
const POLICY_COLUMNS = "status, processing_strategy, provider_batch_id, provider_batch_state, provider_reconcile_due_at, "
  + "provider_reconcile_lease_expires_at, error_code, retry_count, execution_provider, execution_host_id, analysis_outcome, "
  + "next_retry_at, completed_at, created_by";
const MEMBER_JOB_COLUMNS = `id, launch_request_id, plan_set_id, estimate_version_id, ${POLICY_COLUMNS}`;
/** An analysis without a request just put in its queue is followed as a reading: its Mac takes it within seconds. */
const JUST_QUEUED_MS = 60_000;
const UNIT_JOB_COLUMNS = "id, launch_request_id, launch_unit_key, status, started_at, next_retry_at, analysis_outcome, error_code, updated_at";

type Supabase = Awaited<ReturnType<typeof requireAffaireAccess>>["context"]["supabase"];
type Service = ReturnType<typeof createServiceRoleClient>;
type MemberJobRead = Omit<TakeoffRequestJobRow, "item_count">;

function readError(error: { code?: string; message: string }, message: string): never {
  throw toTakeoffError(mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message),
    { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
}

export type ReadTakeoffRequestActivityInput = {
  projectId: string;
  /**
   * current: the affaire's latest execution and whether an analysis without a request runs (what the page reads again
   * while something can change); history: a page of the older ones (read again only when the current one changed);
   * request: the request a link names (?request=); job: the request of an analysis (?job=, and its review).
   */
  view?: TakeoffRequestActivityView;
  requestId?: string | null;
  jobId?: string | null;
  offset?: number;
  limit?: number;
};

/**
 * The affaire's launch requests as its activity shows them, with a constant number of reads whatever the number of
 * plans or failures. Reading never writes and never spends. Requests and the member's actions are read under the
 * member's own access rules; the manifests and unit states of the requests the member read, by the server after the
 * affaire's read access, as the dispatcher's reading contract does. Never a Mac, an account, a lease or a provider's text.
 */
export async function readTakeoffRequestActivity(input: ReadTakeoffRequestActivityInput): Promise<TakeoffRequestActivityResponse> {
  const view = input.view ?? "current";
  const { context, project } = await requireAffaireAccess(input.projectId, "read");
  const { supabase, tenantId } = context;
  await assertTakeoffEnabled(tenantId, { supabase });
  // The member's Mac and connection, read once for every row (no SQL).
  const executionRead = readTakeoffExecution(context);
  const now = new Date();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? TAKEOFF_REQUEST_HISTORY_DEFAULT_LIMIT), 1), TAKEOFF_REQUEST_HISTORY_MAX_LIMIT);
  const offset = view === "history" ? Math.min(Math.max(Math.trunc(input.offset ?? 0), 0), 100_000) : 0;
  const requests = () => supabase.from("takeoff_launch_requests").select(REQUEST_COLUMNS as never)
    .eq("tenant_id", tenantId).eq("project_id", input.projectId);
  const rowsOf = ({ data, error }: { data: unknown; error: { code?: string; message: string } | null }) => {
    if (error) readError(error, "Impossible de lire le métré de l’affaire.");
    return (Array.isArray(data) ? data : data ? [data] : []) as TakeoffRequestRow[];
  };
  // The latest execution: an automatic start set aside by a relaunch never hides it.
  const readLatest = async () => rowsOf(await requests().neq("state", "superseded")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1))[0] ?? null;

  let current: TakeoffRequestRow | null = null;
  let history: TakeoffRequestRow[] = [];
  let historyHasOlder = false;
  if (view === "job") {
    const { data: job, error } = input.jobId
      ? await supabase.from("takeoff_jobs").select("launch_request_id")
        .eq("tenant_id", tenantId).eq("project_id", input.projectId).eq("id", input.jobId).maybeSingle()
      : { data: null, error: null };
    if (error) readError(error, "Impossible de lire l’analyse.");
    if (job?.launch_request_id) current = rowsOf(await requests().eq("id", job.launch_request_id).limit(1))[0] ?? null;
  } else if (view === "request") {
    if (input.requestId) current = rowsOf(await requests().eq("id", input.requestId).limit(1))[0] ?? null;
  } else if (view === "history") {
    // The current execution is not repeated in its history; one row beyond the page tells that an older page exists.
    const latest = await readLatest();
    let older = requests();
    if (latest) older = older.neq("id", latest.id);
    const rows = rowsOf(await older.order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + limit));
    history = rows.slice(0, limit);
    historyHasOlder = rows.length > limit;
  } else {
    current = await readLatest();
  }

  const listed = [...(current ? [current] : []), ...history];
  const admitted = listed.filter((request) => request.admitted_at !== null).map((request) => request.id);
  const service = createServiceRoleClient();
  // A request or an analysis a link names: the rest of the affaire is followed too (its latest execution, the analyses
  // launched without a request), so that what starts meanwhile is seen.
  const followsAffaire = view !== "history";
  const [unitSources, memberJobs, standalone, execution, latestElsewhere] = await Promise.all([
    readUnitSources(service, tenantId, input.projectId, admitted),
    readMemberJobs(supabase, service, tenantId, input.projectId, listed.map((request) => request.id)),
    followsAffaire ? readStandaloneJobsInFlight(supabase, tenantId, input.projectId) : Promise.resolve([]),
    executionRead,
    view === "request" || view === "job" ? readLatest() : Promise.resolve(null),
  ]);
  const elsewhere = latestElsewhere && latestElsewhere.id !== current?.id ? latestElsewhere : null;
  const viewer = toTakeoffResumeViewer(context, project, execution);
  const build = (request: TakeoffRequestRow, extra: { action?: TakeoffRequestActivity["action"]; dossierChanged?: TakeoffRequestActivity["dossierChanged"] } = {}) => {
    const manifest = unitSources.manifests.get(request.id) ?? null;
    // Until the dispatcher's reading contract is on main: the same shape, from the manifest and the jobs.
    const units = deriveTakeoffRequestUnits({ requestId: request.id, manifest, jobs: unitSources.jobs });
    return buildTakeoffRequestActivity({ request, units, manifest, jobs: memberJobs, viewer, now, ...extra });
  };

  let currentView = current ? build(current) : null;
  if (current && currentView && view !== "job") {
    const [action, dossierChanged] = await Promise.all([
      readLaunchAction(service, current, context.userId, viewer),
      // What was added, replaced or removed since its seal, once its plans are no longer read (the poll is then slow or over).
      current.admitted_at && !["running", "queued"].includes(takeoffRequestProgress(currentView) ?? "")
        ? readDossierChangeSinceAnalysis(service, tenantId, input.projectId, current.id)
        : Promise.resolve(null),
    ]);
    currentView = build(current, { action, dossierChanged });
  }

  const response: TakeoffRequestActivityResponse = {
    view,
    observedAt: now.toISOString(),
    live: false,
    signature: signatureOf([...listed, ...(elsewhere ? [elsewhere] : [])], unitSources.jobs, memberJobs, standalone),
    current: currentView,
    history: history.map((request) => build(request)),
    historyHasOlder,
    historyOffset: offset,
    standalone: summarizeStandalone(standalone, viewer, now),
    elsewhere: {
      // Admitted (its plans are read or wait), evaluated by its Mac, or held by a passing cause.
      waiting: elsewhere !== null && (elsewhere.state === "admitted"
        || viewerLaunchAction(null, false, elsewhere.state, elsewhere.reason_code) === "wait"),
    },
  };
  return { ...response, live: takeoffRequestRefreshInterval(response) > 0 };
}

/**
 * The manifests and unit jobs of the admitted requests the member read, by the server after the affaire's read access:
 * two reads for the page, whatever its number of requests.
 */
async function readUnitSources(service: Service, tenantId: string, projectId: string, requestIds: string[]) {
  const manifests = new Map<string, TakeoffRequestManifest | null>();
  if (requestIds.length === 0) return { manifests, jobs: [] as TakeoffRequestUnitJobRow[] };
  const [manifestRows, jobRows] = await Promise.all([
    service.from("takeoff_launch_requests")
      .select("id, format_version:manifest->format_version, units:manifest->units, plans:manifest->plans, coverage:manifest->coverage" as never)
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("id", requestIds),
    service.from("takeoff_jobs").select(UNIT_JOB_COLUMNS as never)
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("launch_request_id", requestIds).order("id").limit(MAX_JOBS_READ),
  ]);
  if (manifestRows.error) readError(manifestRows.error, "Impossible de lire le métré de l’affaire.");
  if (jobRows.error) readError(jobRows.error, "Impossible de lire les analyses du métré.");
  for (const row of (manifestRows.data ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>) {
    const { id, ...manifest } = row;
    manifests.set(id, parseTakeoffRequestManifest(manifest));
  }
  return { manifests, jobs: (jobRows.data ?? []) as unknown as TakeoffRequestUnitJobRow[] };
}

/**
 * The analyses of the listed requests the member reads (their own access rules), and the count of the lines of those
 * read: counted by the server in one statement for these jobs only, never under the per-row rule of the lines on every
 * read of the page.
 */
async function readMemberJobs(supabase: Supabase, service: Service, tenantId: string, projectId: string,
  requestIds: string[]): Promise<TakeoffRequestJobRow[]> {
  if (requestIds.length === 0) return [];
  const { data, error } = await supabase.from("takeoff_jobs").select(MEMBER_JOB_COLUMNS as never)
    .eq("tenant_id", tenantId).eq("project_id", projectId).in("launch_request_id", requestIds).order("id").limit(MAX_JOBS_READ);
  if (error) readError(error, "Impossible de lire les analyses du métré.");
  const jobs = (data ?? []) as unknown as MemberJobRead[];
  const read = jobs.filter((job) => job.status === "completed" || job.status === "applied").map((job) => job.id);
  const counts = new Map<string, number>();
  if (read.length > 0) {
    const { data: rows, error: countError } = await service.from("takeoff_jobs")
      .select("id, items:takeoff_items!takeoff_items_job_id_fkey(count)" as never)
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("id", read);
    if (countError) readError(countError, "Impossible de compter les lignes des analyses.");
    for (const row of (rows ?? []) as unknown as Array<{ id: string; items?: Array<{ count?: number | null }> | null }>) {
      counts.set(row.id, row.items?.[0]?.count ?? 0);
    }
  }
  return jobs.map((job) => ({ ...job, item_count: counts.get(job.id) ?? 0 }));
}

type StandaloneJob = TakeoffOperatorStateRow & { id: string; updated_at: string };

/** The affaire's analyses without a request that may still change by themselves: queued, running, or awaiting a retry. */
async function readStandaloneJobsInFlight(supabase: Supabase, tenantId: string, projectId: string): Promise<StandaloneJob[]> {
  const { data, error } = await supabase.from("takeoff_jobs").select(`id, updated_at, ${POLICY_COLUMNS}` as never)
    .eq("tenant_id", tenantId).eq("project_id", projectId).is("launch_request_id", null)
    .in("status", ["pending", "processing", "failed"]).or("status.neq.failed,next_retry_at.not.is.null")
    .order("id").limit(MAX_JOBS_READ);
  if (error) readError(error, "Impossible de lire les analyses de l’affaire.");
  return (data ?? []) as unknown as StandaloneJob[];
}

/**
 * Running (read now, or put in its queue less than a minute ago: a launch or a retry its Mac takes within seconds), or
 * waiting (queued for longer, or awaiting the retry its policy scheduled). A manual retry's delay is followed by the
 * list's own timer.
 */
function summarizeStandalone(jobs: StandaloneJob[], viewer: TakeoffResumeViewer, now: Date) {
  let running = 0;
  let waiting = 0;
  for (const job of jobs) {
    if (job.status === "processing" || (job.status === "pending" && now.getTime() - Date.parse(job.updated_at) < JUST_QUEUED_MS)) running += 1;
    else if (job.status === "pending"
      || resolveTakeoffOperatorState(toTakeoffOperatorStateInput(job, viewer, now)).resume.reason === "retry_scheduled") waiting += 1;
  }
  return { running, waiting };
}

/**
 * The gesture the database allows this member on a request before its admission (public.takeoff_launch_request_action),
 * shown by the same rule as the affaire's options. None once admitted, closed or set aside.
 */
async function readLaunchAction(service: Service, request: TakeoffRequestRow, actorId: string, viewer: TakeoffResumeViewer) {
  if (request.admitted_at || request.state === "closed" || request.state === "superseded") return null;
  const { data, error } = await service.rpc("takeoff_launch_request_action", { p_request_id: request.id, p_actor: actorId });
  if (error) readError(error, "Impossible de lire le métré de l’affaire.");
  const kind = viewerLaunchAction(data, Boolean(viewer.executionHostId), request.state, request.reason_code);
  return { kind, label: describeTakeoffLaunchAction(kind), mandateRevision: request.mandate_revision };
}

/**
 * Changes with every transition of a listed request or of an analysis of the affaire (a state, an end, a retry, a send),
 * never with the lease an analysis renews while it runs: the page reads its other lists again only then.
 */
function signatureOf(requests: TakeoffRequestRow[], unitJobs: TakeoffRequestUnitJobRow[], memberJobs: TakeoffRequestJobRow[],
  standalone: StandaloneJob[]) {
  const parts = [
    ...requests.map((request) => ["r", request.id, request.state, request.outcome, request.reason_code, request.mandate_revision,
      request.admitted_at, request.closed_at].join("|")),
    ...unitJobs.map((job) => ["u", job.id, job.status, job.started_at, job.next_retry_at, job.analysis_outcome, job.error_code].join("|")),
    ...memberJobs.map((job) => ["m", job.id, job.status, job.retry_count, job.estimate_version_id].join("|")),
    ...standalone.map((job) => ["s", job.id, job.status, job.next_retry_at, job.retry_count].join("|")),
  ].sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

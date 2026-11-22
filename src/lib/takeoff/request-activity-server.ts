import "server-only";

import { createHash } from "node:crypto";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/http/api-error";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { assertTakeoffEnabledForPolledRead } from "@/lib/takeoff/feature-flags";
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
import { readTakeoffVisibleSources } from "@/lib/takeoff/source-visibility-server";

export const TAKEOFF_REQUEST_HISTORY_DEFAULT_LIMIT = 5;
export const TAKEOFF_REQUEST_HISTORY_MAX_LIMIT = 20;
/** Bounds a read whose size the manifests already bound (20 plans a request, one page of requests); never reached. */
const MAX_JOBS_READ = 1_000;
/** The gesture before an admission is read again at the slow pace of the page, never on each fast read. */
const ACTION_REREAD_MS = 30_000;

/** The columns of a request its readers may read (migration 20261121170448: the grant to authenticated). */
const REQUEST_COLUMNS = "id, origin, intent, state, reason_code, reason_details, outcome, mandate_revision, units_expected, "
  + "created_at, admitted_at, closed_at";
/** What the resume policy reads, as the list and the detail read it: read by the server, never returned. */
const POLICY_COLUMNS = "status, processing_strategy, provider_batch_id, provider_batch_state, provider_reconcile_due_at, "
  + "provider_reconcile_lease_expires_at, error_code, retry_count, execution_provider, execution_host_id, analysis_outcome, "
  + "next_retry_at, completed_at, created_by";
const MEMBER_JOB_COLUMNS = `id, launch_request_id, plan_set_id, estimate_version_id, created_at, started_at, analysis_finished_at, ${POLICY_COLUMNS}`;
/** An analysis without a request just put in its queue is followed as a reading: its Mac takes it within seconds. */
const JUST_QUEUED_MS = 60_000;
const UNIT_JOB_COLUMNS = "id, launch_request_id, launch_unit_key, status, started_at, next_retry_at, analysis_outcome, error_code, updated_at";

type Supabase = Awaited<ReturnType<typeof requireAffaireAccess>>["context"]["supabase"];
type Service = ReturnType<typeof createServiceRoleClient>;
type MemberJobRead = Omit<TakeoffRequestJobRow, "item_count">;
type DatabaseError = { code?: string; message: string };

/**
 * A database error that says nothing about the member's rights and may not happen again: a statement or lock timeout,
 * a serialization failure or a deadlock, a lost connection or a server short of resources.
 */
export function isTransientDatabaseError(code: string | null | undefined) {
  if (!code) return false;
  return ["57014", "55P03", "40001", "40P01", "57P01", "57P02", "57P03", "53300", "53400", "53200"].includes(code)
    || code.startsWith("08") || code === "PGRST000" || code === "PGRST001" || code === "PGRST002" || code === "PGRST003";
}

/** A read the page may try again: never a refusal, never a database text. */
export function transientReadError() {
  return new TakeoffError({ status: 503, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true,
    message: "La lecture du métré est momentanément indisponible. Nouvelle tentative automatique." });
}

function readError(error: DatabaseError, message: string): never {
  if (isTransientDatabaseError(error.code)) throw transientReadError();
  throw toTakeoffError(mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message),
    { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
}

/**
 * The same for an error the access, the membership or the module check mapped already: a mapped transient code (its
 * public details carry the code) becomes a read to try again; anything else stays as it was (a refusal, a missing affaire).
 */
export function toRequestActivityReadError(error: unknown) {
  if (error instanceof ApiError && !(error instanceof TakeoffError) && error.status === 400) {
    const code = error.details && typeof error.details === "object" ? (error.details as { code?: unknown }).code : undefined;
    if (typeof code === "string" && isTransientDatabaseError(code)) return transientReadError();
  }
  return error;
}

/**
 * A 401 of the access check: a missing or refused session stays a refusal; a session lookup the Auth service did not
 * answer (its own retryable error, or a lookup that answers now) is a read to try again. The shared context reads it as
 * a 401 for every caller; this read owns its answer, from the same lookup.
 */
async function toSessionReadError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return error;
  const { user, error: authError } = await readAuthenticatedUser();
  return isAuthRetryableFetchError(authError) || (user && !authError) ? transientReadError() : error;
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
  /** The dossier position of the shown request at the page's last read: its difference is computed again only when it moved. */
  dossierSeen?: string | null;
  /** The gesture's key and when it was read (the server's time): read again only for another key or after 30 s. */
  actionSeen?: string | null;
  actionSeenAt?: string | null;
};

/**
 * The affaire's launch requests as its activity shows them, with a constant number of reads whatever the number of
 * plans or failures. Reading never writes and never spends. Requests and the member's actions are read under the
 * member's own access rules; the manifests and unit states of the requests the member read, by the server after the
 * affaire's read access, as the dispatcher's reading contract does. A plan's name and pages are shown only for a source
 * the member may read. Never a Mac, an account, a lease or a provider's text.
 */
export async function readTakeoffRequestActivity(input: ReadTakeoffRequestActivityInput): Promise<TakeoffRequestActivityResponse> {
  const view = input.view ?? "current";
  const { context, project } = await requireAffaireAccess(input.projectId, "read").catch(async (error: unknown) => {
    throw await toSessionReadError(error);
  });
  const { supabase, tenantId } = context;
  // A read of the module's flag that failed is a read to try again, never a module turned off.
  await assertTakeoffEnabledForPolledRead(tenantId, { supabase, failedRead: transientReadError });
  // The member's Mac and connection, read once for every row (no SQL, nothing written).
  const executionRead = readTakeoffExecution(context);
  const now = new Date();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? TAKEOFF_REQUEST_HISTORY_DEFAULT_LIMIT), 1), TAKEOFF_REQUEST_HISTORY_MAX_LIMIT);
  const offset = view === "history" ? Math.min(Math.max(Math.trunc(input.offset ?? 0), 0), 100_000) : 0;
  const requests = () => supabase.from("takeoff_launch_requests").select(REQUEST_COLUMNS as never)
    .eq("tenant_id", tenantId).eq("project_id", input.projectId);
  const rowsOf = ({ data, error }: { data: unknown; error: DatabaseError | null }) => {
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

  // A request or an analysis a link names: the affaire's latest execution is followed too, with its plans, and the
  // analyses launched without a request, so that what changes meanwhile is seen.
  const latestRead = view === "request" || view === "job" ? await readLatest() : null;
  const elsewhere = latestRead && latestRead.id !== current?.id ? latestRead : null;
  const listed = [...(current ? [current] : []), ...history];
  const admitted = [...listed, ...(elsewhere ? [elsewhere] : [])].filter((request) => request.admitted_at !== null)
    .map((request) => request.id);
  const service = createServiceRoleClient();
  const [unitSources, memberJobs, standalone, execution] = await Promise.all([
    readUnitSources(service, tenantId, input.projectId, admitted),
    readMemberJobs(supabase, service, tenantId, input.projectId, listed.map((request) => request.id)),
    view !== "history" ? readStandaloneJobsInFlight(supabase, tenantId, input.projectId) : Promise.resolve([]),
    executionRead,
  ]);
  const viewer = toTakeoffResumeViewer(context, project, execution);
  const unitsOf = (request: TakeoffRequestRow) =>
    // Until the dispatcher's reading contract is on main: the same shape, from the manifest and the jobs.
    deriveTakeoffRequestUnits({ requestId: request.id, manifest: unitSources.manifests.get(request.id) ?? null, jobs: unitSources.jobs });

  // The shown request's gesture before its admission (read again at the page's slow pace), and its dossier's changes
  // since its seal once its plans are no longer read (computed again only when the dossier moved).
  let action: TakeoffRequestActivity["action"] = null;
  let actionKey: string | null = null;
  let actionReused = false;
  let dossierChanged: TakeoffRequestActivity["dossierChanged"] = null;
  let dossierPosition: string | null = null;
  let dossierReused = false;
  if (current && view !== "job") {
    if (!current.admitted_at && current.state !== "closed" && current.state !== "superseded") {
      actionKey = `${current.id}:${current.mandate_revision}:${current.state}:${current.reason_code ?? ""}`;
      // A time later than the server's (the page's own clock, or any value it sent) is read again, never kept.
      const seenAt = input.actionSeenAt ? Date.parse(input.actionSeenAt) : Number.NaN;
      const age = now.getTime() - seenAt;
      actionReused = input.actionSeen === actionKey && Number.isFinite(age) && age >= 0 && age < ACTION_REREAD_MS;
      if (!actionReused) action = await readLaunchAction(service, current, context.userId, viewer);
    }
    const currentUnits = unitsOf(current);
    const progress = takeoffRequestProgress({ state: current.state as TakeoffRequestActivity["state"], reason: null,
      units: currentUnits ? { ...currentUnits, unknownCalls: unitSources.unknownCalls.get(current.id) ?? null } : null });
    if (current.admitted_at && progress !== "running" && progress !== "queued") {
      dossierPosition = `${current.id}:${await readDossierPosition(service, tenantId, input.projectId)}`;
      dossierReused = input.dossierSeen === dossierPosition;
      if (!dossierReused) dossierChanged = await readDossierChangeSinceAnalysis(context, input.projectId, current.id);
    }
  }

  // The sources the member may read, for every plan and piece this answer would name.
  const visible = await readTakeoffVisibleSources({ supabase, tenantId, projectId: input.projectId, ids: [
    ...listed.flatMap((request) => sourceIdsOf(unitSources.manifests.get(request.id) ?? null, request.reason_details)),
  ] });
  const build = (request: TakeoffRequestRow, extra: { action?: TakeoffRequestActivity["action"]; dossierChanged?: TakeoffRequestActivity["dossierChanged"] } = {}) =>
    buildTakeoffRequestActivity({ request, units: unitsOf(request), unknownCalls: unitSources.unknownCalls.get(request.id) ?? null,
      manifest: unitSources.manifests.get(request.id) ?? null,
      jobs: memberJobs, viewer, now, visible, ...extra });

  const currentView = current ? build(current, { action, dossierChanged }) : null;
  const elsewhereView = elsewhere ? build(elsewhere) : null;
  const elsewhereProgress = elsewhereView ? takeoffRequestProgress(elsewhereView) : null;
  const historyViews = history.map((request) => build(request));
  const response: TakeoffRequestActivityResponse = {
    view,
    observedAt: now.toISOString(),
    live: false,
    signature: signatureOf([...listed, ...(elsewhere ? [elsewhere] : [])], unitSources.jobs, memberJobs, standalone),
    current: currentView,
    history: historyViews,
    historyHasOlder,
    historyOffset: offset,
    standalone: summarizeStandalone(standalone, viewer, now),
    elsewhere: {
      running: elsewhereProgress === "running",
      waiting: elsewhereProgress === "queued" || elsewhereProgress === "waiting",
    },
    currentIsLatest: current !== null && (view === "current" || latestRead?.id === current.id),
    inFlightJobIds: [
      ...standalone.filter((job) => isStandaloneInFlight(job, viewer, now)).map((job) => job.id),
      ...[currentView, elsewhereView, ...historyViews].flatMap((request) => (request?.units?.units ?? [])
        .filter((unit) => unit.state === "queued" || unit.state === "running").map((unit) => unit.jobId)),
    ],
    reused: { dossierPosition, dossier: dossierReused, actionKey, action: actionReused },
  };
  return { ...response, live: takeoffRequestRefreshInterval(response) > 0 };
}

/** Every plan copy and dossier piece a request names: its plans, the plans its seal set aside, the pieces its reason names. */
function sourceIdsOf(manifest: TakeoffRequestManifest | null, reasonDetails: unknown) {
  const ids: Array<string | null> = [];
  for (const plan of manifest?.plans.values() ?? []) ids.push(plan.planFileId, plan.documentId, plan.logicalId);
  for (const entry of manifest?.omitted ?? []) ids.push(entry.id);
  const pieces = reasonDetails && typeof reasonDetails === "object" ? (reasonDetails as { pieces?: unknown }).pieces : null;
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    if (piece && typeof piece === "object" && typeof (piece as { id?: unknown }).id === "string") ids.push((piece as { id: string }).id);
  }
  return ids;
}

/**
 * Where the dossier of the affaire stands: its plan sets, the count and latest change of their plan files and of its
 * dossier pieces. Three small reads, compared with the page's last answer before the dossier's difference (which pages
 * through all of them) is computed again.
 */
async function readDossierPosition(service: Service, tenantId: string, projectId: string) {
  const [sets, documents] = await Promise.all([
    service.from("plan_sets").select("id, updated_at").eq("tenant_id", tenantId).eq("project_id", projectId).order("id"),
    service.from("affaire_intake_documents").select("updated_at", { count: "exact" }).eq("tenant_id", tenantId)
      .eq("project_id", projectId).order("updated_at", { ascending: false }).limit(1),
  ]);
  if (sets.error) readError(sets.error, "Impossible de lire le dossier de l’affaire.");
  if (documents.error) readError(documents.error, "Impossible de lire le dossier de l’affaire.");
  const setRows = (sets.data ?? []) as Array<{ id: string; updated_at: string }>;
  const files = setRows.length === 0 ? { data: [], count: 0, error: null } : await service.from("plan_files")
    .select("updated_at", { count: "exact" }).eq("tenant_id", tenantId).in("plan_set_id", setRows.map((set) => set.id))
    .order("updated_at", { ascending: false }).limit(1);
  if (files.error) readError(files.error, "Impossible de lire le dossier de l’affaire.");
  const parts = [
    setRows.map((set) => `${set.id}@${set.updated_at}`).join(","),
    `${files.count ?? 0}@${(files.data as Array<{ updated_at: string }> | null)?.[0]?.updated_at ?? ""}`,
    `${documents.count ?? 0}@${(documents.data as Array<{ updated_at: string }> | null)?.[0]?.updated_at ?? ""}`,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * The manifests and unit jobs of the admitted requests the member read, by the server after the affaire's read access:
 * two reads for the page, whatever its number of requests.
 */
async function readUnitSources(service: Service, tenantId: string, projectId: string, requestIds: string[]) {
  const manifests = new Map<string, TakeoffRequestManifest | null>();
  const unknownCalls = new Map<string, number>();
  if (requestIds.length === 0) return { manifests, jobs: [] as TakeoffRequestUnitJobRow[], unknownCalls };
  const [manifestRows, jobRows, unknownRows] = await Promise.all([
    service.from("takeoff_launch_requests")
      .select("id, format_version:manifest->format_version, units:manifest->units, plans:manifest->plans, coverage:manifest->coverage" as never)
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("id", requestIds),
    service.from("takeoff_jobs").select(UNIT_JOB_COLUMNS as never)
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("launch_request_id", requestIds).order("id").limit(MAX_JOBS_READ),
    // The calls whose consumption stayed unknown (each freezes its request's paid calls), for all the requests at once.
    service.rpc("read_takeoff_launch_unknown_calls", { p_tenant_id: tenantId, p_project_id: projectId, p_request_ids: requestIds }),
  ]);
  if (manifestRows.error) readError(manifestRows.error, "Impossible de lire le métré de l’affaire.");
  if (jobRows.error) readError(jobRows.error, "Impossible de lire les analyses du métré.");
  if (unknownRows.error) readError(unknownRows.error, "Impossible de lire la consommation du métré.");
  for (const row of (unknownRows.data ?? []) as Array<{ request_id: string; unknown_calls: number | string }>) {
    unknownCalls.set(row.request_id, Number(row.unknown_calls));
  }
  for (const row of (manifestRows.data ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>) {
    const { id, ...manifest } = row;
    manifests.set(id, parseTakeoffRequestManifest(manifest));
  }
  return { manifests, jobs: (jobRows.data ?? []) as unknown as TakeoffRequestUnitJobRow[], unknownCalls };
}

/**
 * The analyses of the listed requests the member reads (their own access rules), and the count of the lines of those
 * read that are retained (not excluded): counted by the server in one statement for these jobs only, never under the
 * per-row rule of the lines on every read of the page.
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
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("id", read).eq("items.is_excluded" as never, false as never);
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

function isStandaloneInFlight(job: StandaloneJob, viewer: TakeoffResumeViewer, now: Date) {
  return job.status === "processing" || job.status === "pending"
    || resolveTakeoffOperatorState(toTakeoffOperatorStateInput(job, viewer, now)).resume.reason === "retry_scheduled";
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
    else if (isStandaloneInFlight(job, viewer, now)) waiting += 1;
  }
  return { running, waiting };
}

/**
 * The gesture the database allows this member on a request before its admission (public.takeoff_launch_request_action),
 * shown by the same rule as the affaire's options. None once admitted, closed or set aside.
 */
async function readLaunchAction(service: Service, request: TakeoffRequestRow, actorId: string, viewer: TakeoffResumeViewer) {
  const { data, error } = await service.rpc("takeoff_launch_request_action", { p_request_id: request.id, p_actor: actorId });
  if (error) readError(error, "Impossible de lire le métré de l’affaire.");
  const kind = viewerLaunchAction(data, Boolean(viewer.executionHostId), request.state, request.reason_code);
  return { kind, label: describeTakeoffLaunchAction(kind), mandateRevision: request.mandate_revision };
}

/**
 * Changes with every transition of a shown request or of an analysis of the affaire (a state, an end, a retry, a send),
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

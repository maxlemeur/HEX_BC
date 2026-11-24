import "server-only";

import { createHash } from "node:crypto";

import { affaireOwnerFilter } from "@/lib/affaires/access-server";
import { analysisProgressPages } from "@/lib/affaires/analysis-progress-pages";
import type { AnalysisProgress, AnalysisProgressLine } from "@/lib/affaires/analysis-progress-contract";
import {
  AFFAIRE_INTAKE_ANALYSIS_STALE_MS,
  AFFAIRE_INTAKE_PROCESSING_LABEL,
  AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE,
  isAffaireIntakeAnalysisStale,
  isAffaireIntakeReanalysisPending,
} from "@/lib/affaires/intake";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { readFeatureEnabled } from "@/lib/feature-flags";
import { internalError, mapSupabaseError } from "@/lib/http/api-response";
import {
  describeAffaireTakeoffJob,
  describeAffaireTakeoffPlanProgress,
  describeAffaireTakeoffRequest,
  type AffaireTakeoffZoneJob,
} from "@/lib/takeoff/affaire-takeoff-zone";
import { hasScheduledLocalTakeoffRetry, TAKEOFF_COMPLETION_LABELS, toTakeoffNoticeOutcome } from "@/lib/takeoff/completion-outcome";
import { TAKEOFF_MODULE_ENABLED_FLAG_KEY } from "@/lib/takeoff/constants";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import { isTakeoffLaunchReason, TAKEOFF_LAUNCH_REQUEST_STATES, type TakeoffLaunchRequestState } from "@/lib/takeoff/launch-request";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { describeTakeoffRequestOrigin } from "@/lib/takeoff/request-activity";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure, resolveTakeoffVisibleJobStatus } from "@/lib/takeoff/visible-status";
import type { Database } from "@/types/database";

const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
const JOB_COLUMNS = "id, status, estimate_version_id, processing_strategy, provider_batch_state, error_code, created_at, completed_at, analysis_finished_at, analysis_completion_event_id, execution_provider, next_retry_at, plan_set_id, launch_unit_key, exceptions:takeoff_dpgf_review_decisions!takeoff_dpgf_review_decisions_takeoff_job_id_fkey(id)";
type Job = Pick<Database["public"]["Tables"]["takeoff_jobs"]["Row"],
  "id" | "status" | "estimate_version_id" | "processing_strategy" | "provider_batch_state" | "error_code" |
  "created_at" | "completed_at" | "analysis_finished_at" | "execution_provider" | "next_retry_at" |
  "plan_set_id" | "launch_unit_key"> & { exceptions: Array<{ id: string }> };
type Project = { id: string; name: string };
type ProgressGroup = { project: Project; lines: Array<{ line: AnalysisProgressLine; own: boolean; updatedAt: string }> };

function zoneJob(projectId: string, job: Job): AffaireTakeoffZoneJob {
  const retries = job.status === "failed" && hasScheduledLocalTakeoffRetry(job);
  const visible = resolveTakeoffVisibleJobStatus({
    status: retries ? "pending" : job.status,
    processingStrategy: job.processing_strategy,
    providerBatchState: job.provider_batch_state,
    exceptionCount: job.exceptions.length,
  });
  const reviewable = job.status === "completed" || job.status === "applied";
  return {
    id: job.id,
    name: null,
    status: visible.status,
    statusLabel: visible.label,
    failure: job.status === "failed" && !retries ? describeTakeoffJobFailure(job.error_code) : null,
    reviewHref: reviewable ? takeoffReviewHref({ projectId, jobId: job.id, versionId: job.estimate_version_id }) : null,
    createdAt: job.created_at,
    finishedAt: job.analysis_finished_at ?? job.completed_at,
  };
}

function jobState(job: AffaireTakeoffZoneJob): AnalysisProgressLine["state"] {
  if (job.status === "processing") return "reading";
  if (job.status === "queued" || job.status === "provider_pending") return "waiting";
  return "finished";
}

function isLaunchState(state: string): state is TakeoffLaunchRequestState {
  return (TAKEOFF_LAUNCH_REQUEST_STATES as readonly string[]).includes(state);
}

function pieceCount(count: number, singular: string, plural = singular) {
  return count === 1 ? `1 pièce ${singular}` : `${count} pièces ${plural}`;
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function unitPlanId(job: Job) {
  // A format-2 unit is keyed by its plan copy. Its job has no source_file_path.
  const key = job.launch_unit_key;
  if (!key?.startsWith("plan:")) return null;
  const id = key.slice(5);
  return UUID.test(id) ? id : null;
}

function singlePreparedPlan(sources: unknown) {
  if (!Array.isArray(sources)) return null;
  const plans = sources.filter((entry) => entry?.kind === "plan" && entry.active === true);
  const id = plans[0]?.document_id;
  return plans.length === 1 && typeof id === "string" && UUID.test(id) ? id : null;
}

function latestRows<Row extends { id: string; updated_at: string }>(live: Row[], ended: Row[]) {
  const rows = new Map(live.map((row) => [row.id, row]));
  for (const row of ended) {
    const prior = rows.get(row.id);
    if (!prior || Date.parse(row.updated_at) >= Date.parse(prior.updated_at)) rows.set(row.id, row);
  }
  return [...rows.values()];
}

function completionKey(...parts: Array<string | string[] | null>) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export async function readAffaireAnalysisProgress(cursor: string | undefined): Promise<AnalysisProgress> {
  const observedAt = new Date();
  const pages = analysisProgressPages(cursor);
  const { supabase, tenantId, userId, tenantRole } = await getAuthenticatedContext();
  const owner = affaireOwnerFilter({ userId, tenantRole }, "read");
  const now = observedAt.getTime();
  const cutoff = new Date(now - HISTORY_WINDOW_MS).toISOString();
  const staleBefore = new Date(now - AFFAIRE_INTAKE_ANALYSIS_STALE_MS).toISOString();
  const staleNoticeSince = new Date(now - HISTORY_WINDOW_MS - AFFAIRE_INTAKE_ANALYSIS_STALE_MS).toISOString();
  const reanalysisMarker = `{"${AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE}"}`;

  const readDocuments = (live: boolean) => {
    const query = supabase.from("affaire_intake_documents").select(
      "id, classification_status, classified_at, updated_at, created_at, issues, created_by, proposal_at:extracted_metadata->aiCategoryProposal->>analyzedAt, project:estimate_projects!affaire_intake_documents_project_id_fkey!inner(id,name)",
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).eq("project.is_archived", false)
      .eq("upload_status", "uploaded").is("deleted_at", null).is("deletion_started_at", null);
    // The two reads leave room for live work even when the completion page is full.
    const filters = live
      ? `classification_status.eq.queued,and(updated_at.gte.${staleBefore},or(classification_status.eq.processing,issues.cs.${reanalysisMarker}))`
      : `and(classification_status.in.(classified,ambiguous,failed),issues.not.cs.${reanalysisMarker},updated_at.gt.${cutoff}),and(updated_at.gte.${staleNoticeSince},updated_at.lt.${staleBefore},or(classification_status.eq.processing,issues.cs.${reanalysisMarker}))`;
    query.or(filters);
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const readRequests = (live: boolean) => {
    const query = supabase.from("takeoff_launch_requests").select(
      `id, origin, intent, state, reason_code, payer_id, confirmed_by, created_at, updated_at, admitted_at, closed_at, outcome, completion_event_id, units_expected, units_succeeded, units_failed, units_canceled, jobs:takeoff_jobs!takeoff_jobs_launch_request_fkey(${JOB_COLUMNS}), project:estimate_projects!takeoff_launch_requests_project_fkey!inner(id,name)`,
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).eq("project.is_archived", false)
      // The dispatcher admits at most 20 jobs per request. Each review needs only an existence witness.
      .limit(20, { referencedTable: "jobs" }).limit(1, { referencedTable: "jobs.exceptions" })
      .or(live ? "state.in.(evaluating,not_eligible,blocked,admitted)"
        : `and(state.eq.closed,closed_at.gt.${cutoff}),and(state.eq.superseded,updated_at.gt.${cutoff})`);
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const readJobs = (phase: "live" | "retry" | "ended") => {
    // An optional embed filters the affaire under its own authority without
    // making it the driving relation of the job scan. Only resolved affaires
    // are projected into the response.
    const query = supabase.from("takeoff_jobs").select(
      `${JOB_COLUMNS}, created_by, analysis_requested_by, updated_at, project:estimate_projects!takeoff_jobs_project_tenant_fkey(id,name)`,
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).eq("project.is_archived", false)
      .is("launch_request_id", null).limit(1, { referencedTable: "exceptions" });
    if (phase === "ended") {
      query.not("status", "in", "(pending,processing)")
        .or("status.neq.failed,execution_provider.neq.chatgpt_local,next_retry_at.is.null")
        .or(`analysis_finished_at.gt.${cutoff},and(analysis_finished_at.is.null,completed_at.gt.${cutoff}),and(analysis_finished_at.is.null,completed_at.is.null,updated_at.gt.${cutoff})`);
    } else if (phase === "retry") {
      query.eq("status", "failed").eq("execution_provider", "chatgpt_local").not("next_retry_at", "is", null);
    } else {
      // Creation, claim and manual retry leave completed_at unset. The null test
      // excludes finished rows before RLS evaluates their takeoff scope.
      query.is("completed_at", null).in("status", ["pending", "processing"]);
    }
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const enabled = takeoffModuleDefault() || readFeatureEnabled(tenantId, TAKEOFF_MODULE_ENABLED_FLAG_KEY, { supabase }).then((flag) => {
    if (flag.failed) throw internalError("Impossible de lire le suivi des analyses.");
    return flag.enabled;
  });
  const [liveDocuments, endedDocuments, takeoff] = await Promise.all([
    pages.read("documentLive", () => readDocuments(true)),
    pages.read("documentEnd", () => readDocuments(false)),
    Promise.resolve(enabled).then((takeoffEnabled) => takeoffEnabled ? Promise.all([
      pages.read("requestLive", () => readRequests(true)),
      pages.read("requestEnd", () => readRequests(false)),
      pages.read("jobLive", () => readJobs("live")),
      pages.read("jobRetry", () => readJobs("retry")),
      pages.read("jobEnd", () => readJobs("ended")),
    ]) : null),
  ]);
  const [liveRequests, endedRequests, liveJobs, retryJobs, endedJobs] = takeoff ?? [[], [], [], [], []];
  const requests = latestRows(liveRequests, endedRequests);
  const manualSingleUnit = requests.filter((row) => row.origin === "manual" && row.units_expected === 1);
  const groupedJobs = manualSingleUnit.flatMap(({ jobs }) => jobs[0]?.launch_unit_key === "grouped" ? [jobs[0].id] : []);
  const groupedPlans = new Map<string, string | null>();
  if (groupedJobs.length) {
    const { data, error } = await supabase.from("takeoff_jobs").select("id, sources:preparation_snapshot->preparation->sources")
      .eq("tenant_id", tenantId).in("id", groupedJobs).limit(32);
    if (error) throw mapSupabaseError(error, "Impossible de lire le périmètre de la relance.");
    for (const job of data ?? []) groupedPlans.set(job.id, singlePreparedPlan(job.sources));
  }
  const targeted = manualSingleUnit.flatMap((row) => {
    const job = row.jobs[0];
    const id = job && (unitPlanId(job) ?? groupedPlans.get(job.id));
    return id && job ? [[row.id, { id, setId: job.plan_set_id }] as const] : [];
  });
  const planIdByRequest = new Map(targeted);
  const planNames = new Map<string, { name: string; setId: string }>();
  if (targeted.length) {
    // Only the member's readable plan file can supply the label, never a job's copy of its name.
    const { data, error } = await supabase.from("plan_files").select("id, plan_set_id, file_name, metadata")
      .eq("tenant_id", tenantId).in("id", [...new Set(targeted.map(([, plan]) => plan.id))]).limit(32);
    if (error) throw mapSupabaseError(error, "Impossible de vérifier l’accès aux plans de l’affaire.");
    for (const file of data ?? []) {
      const metadata = file.metadata && typeof file.metadata === "object" && !Array.isArray(file.metadata) ? file.metadata : null;
      planNames.set(file.id, { setId: file.plan_set_id, name: getPlanFileDisplayName({ ...file, metadata }) });
    }
  }

  const groups = new Map<string, ProgressGroup>();
  function add(project: Project, line: AnalysisProgressLine, own: boolean) {
    const group = groups.get(project.id) ?? { project, lines: [] };
    group.lines.push({ line, own, updatedAt: line.updatedAt });
    groups.set(project.id, group);
  }

  type Dossier = {
    project: Project; reading: number; waiting: number; classified: number; failed: number; review: number;
    updatedAt: string; own: boolean; completionKeys: string[];
  };
  const dossiers = new Map<string, Dossier>();
  for (const row of latestRows(liveDocuments, endedDocuments)) {
    const facts = { classificationStatus: row.classification_status, classificationUpdatedAt: row.updated_at, issues: row.issues };
    const processing = row.classification_status === "processing" || isAffaireIntakeReanalysisPending(facts);
    const stale = Date.parse(row.updated_at) < Date.parse(staleBefore) && isAffaireIntakeAnalysisStale(facts);
    const bucket = stale ? "failed"
      : processing ? "reading"
      : row.classification_status === "queued" ? "waiting"
      : row.classification_status === "classified" ? "classified"
      : row.classification_status === "failed" ? "failed" : "review";
    const finished = bucket !== "reading" && bucket !== "waiting";
    const proposalAt = typeof row.proposal_at === "string" ? row.proposal_at : null;
    const classifiedAt = row.classified_at && Date.parse(row.classified_at) >= Date.parse(proposalAt ?? row.classified_at)
      ? row.classified_at : proposalAt;
    const resultTime = stale ? Date.parse(row.updated_at) + AFFAIRE_INTAKE_ANALYSIS_STALE_MS
      : Date.parse(finished && bucket !== "failed" ? classifiedAt ?? row.updated_at : row.updated_at);
    const updatedAt = new Date(Number.isFinite(resultTime) ? resultTime : Date.parse(row.updated_at)).toISOString();
    if (finished && updatedAt <= cutoff) continue;
    const id = `${row.project.id}:${finished ? "finished" : "live"}`;
    const dossier = dossiers.get(id) ?? {
      project: row.project, reading: 0, waiting: 0, classified: 0, failed: 0, review: 0, updatedAt, own: false,
      completionKeys: [],
    };
    dossier[bucket]++;
    if (finished) dossier.completionKeys.push(completionKey("dossier", row.id, bucket, classifiedAt, stale ? row.updated_at : null, row.issues));
    if (updatedAt > dossier.updatedAt) dossier.updatedAt = updatedAt;
    dossier.own ||= row.created_by === userId;
    dossiers.set(id, dossier);
  }

  for (const [id, dossier] of dossiers) {
    const { project, reading, waiting, classified, failed, review, updatedAt, own, completionKeys } = dossier;
    const counts = [
      reading && pieceCount(reading, "en cours"),
      waiting && pieceCount(waiting, "en attente"),
      classified && pieceCount(classified, "classée", "classées"),
      failed && pieceCount(failed, "en échec"),
      review && pieceCount(review, "à vérifier"),
    ].filter(Boolean);
    add(project, {
      id, kind: "dossier", state: reading ? "reading" : waiting ? "waiting" : "finished",
      status: reading || waiting ? AFFAIRE_INTAKE_PROCESSING_LABEL : counts.join(" · "),
      detail: reading || waiting ? counts.join(" · ") : null,
      updatedAt, href: `/dashboard/affaires/${project.id}?view=dossier`, completionKeys,
    }, own);
  }

  for (const row of requests) {
    if (!isLaunchState(row.state)) continue;
    const { project } = row;
    const jobs = row.jobs.map((job) => zoneJob(project.id, job));
    const units = { expected: row.units_expected, succeeded: row.units_succeeded, failed: row.units_failed, canceled: row.units_canceled };
    const reason = isTakeoffLaunchReason(row.reason_code) ? row.reason_code : null;
    const presentation = describeAffaireTakeoffRequest({
      state: row.state, reason, pieces: [], hasPayer: row.payer_id !== null,
      createdAt: row.created_at, admittedAt: row.admitted_at, closedAt: row.closed_at,
      outcome: toTakeoffNoticeOutcome(row.outcome), units, jobs,
    });
    const state = row.state === "closed" || row.state === "superseded" ? "finished" :
      jobs.some((job) => jobState(job) === "reading") ? "reading" : "waiting";
    const reviews = jobs.filter((job) => job.reviewHref);
    const reviewRequired = row.state === "closed" && row.outcome === "success" &&
      jobs.find((job) => job.status === "review_required");
    const plan = planIdByRequest.get(row.id);
    const name = plan && planNames.get(plan.id);
    const scope = row.origin !== "manual" ? null : plan
      ? `${describeTakeoffRequestOrigin(row)} — ${name?.setId === plan.setId && name ? name.name : "plan sélectionné"}`
      : describeTakeoffRequestOrigin(row);
    const planProgress = describeAffaireTakeoffPlanProgress(units);
    const updatedAt = new Date(row.closed_at ?? row.updated_at).toISOString();
    add(project, {
      id: row.id, kind: "takeoff", state,
      status: reviewRequired ? describeAffaireTakeoffJob(reviewRequired).status : presentation.status,
      detail: [scope, planProgress, presentation.message].filter(Boolean).join(" · ") || null,
      updatedAt,
      completionKeys: state === "finished" ? [completionKey("request", row.completion_event_id ?? row.id, updatedAt)] : [],
      href: (row.outcome === "success" && reviews.length === 1 && reviews[0].reviewHref)
        || `/dashboard/affaires/${project.id}/takeoff?request=${row.id}`,
    }, row.confirmed_by === userId || row.payer_id === userId);
  }

  const jobsByState = latestRows(latestRows(liveJobs, retryJobs), endedJobs);
  for (const row of jobsByState) {
    const project = row.project;
    if (!project) continue;
    const job = zoneJob(project.id, row);
    const state = jobState(job);
    const updatedAt = new Date(job.finishedAt ?? row.updated_at).toISOString();
    add(project, {
      id: job.id, kind: "takeoff", state,
      status: row.status === "canceled" ? TAKEOFF_COMPLETION_LABELS.canceled :
        job.status === "provider_pending" ? job.statusLabel : describeAffaireTakeoffJob(job).status,
      detail: job.failure,
      updatedAt,
      completionKeys: state === "finished" ? [completionKey("job", row.analysis_completion_event_id ?? job.id, updatedAt)] : [],
      href: job.reviewHref ?? `/dashboard/affaires/${project.id}/takeoff?job=${job.id}`,
    }, (row.analysis_requested_by ?? row.created_by) === userId);
  }

  const compare = (a: { own: boolean; updatedAt: string }, b: { own: boolean; updatedAt: string }) =>
    Number(b.own) - Number(a.own) || b.updatedAt.localeCompare(a.updatedAt);
  const affaires = [...groups.values()].map(({ project, lines }) => ({
    project, own: lines.some((line) => line.own),
    updatedAt: lines.reduce((latest, line) => line.updatedAt > latest ? line.updatedAt : latest, ""),
    lines: lines.sort(compare).map(({ line }) => line),
  })).sort(compare).map(({ project, lines }) => ({ ...project, lines }));
  return { viewer: { tenantId, userId }, observedAt: observedAt.toISOString(), nextCursor: pages.nextCursor(), affaires };
}

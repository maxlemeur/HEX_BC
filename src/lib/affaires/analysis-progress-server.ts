import "server-only";

import { affaireOwnerFilter } from "@/lib/affaires/access-server";
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
import { readAllRows } from "@/lib/supabase/read-all";
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
import { listJobsWithBlockingExceptions } from "@/lib/takeoff/review-exceptions-server";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure, resolveTakeoffVisibleJobStatus } from "@/lib/takeoff/visible-status";
import type { Database } from "@/types/database";

const FIRST_LOOK_BACK_MS = 24 * 60 * 60_000;
const JOB_COLUMNS = "id, status, estimate_version_id, processing_strategy, provider_batch_state, error_code, created_at, completed_at, analysis_finished_at, execution_provider, next_retry_at";
type Job = Pick<Database["public"]["Tables"]["takeoff_jobs"]["Row"],
  "id" | "status" | "estimate_version_id" | "processing_strategy" | "provider_batch_state" | "error_code" |
  "created_at" | "completed_at" | "analysis_finished_at" | "execution_provider" | "next_retry_at">;
type Project = { id: string; name: string };
type ProgressGroup = { project: Project; lines: Array<{ line: AnalysisProgressLine; own: boolean; updatedAt: string }> };

function zoneJob(projectId: string, job: Job, exceptions: ReadonlySet<string>): AffaireTakeoffZoneJob {
  const retries = job.status === "failed" && hasScheduledLocalTakeoffRetry(job);
  const visible = resolveTakeoffVisibleJobStatus({
    status: retries ? "pending" : job.status,
    processingStrategy: job.processing_strategy,
    providerBatchState: job.provider_batch_state,
    exceptionCount: exceptions.has(job.id) ? 1 : 0,
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

export async function readAffaireAnalysisProgress(since: string | undefined): Promise<AnalysisProgress> {
  // The watermark precedes the reads so a change concurrent with this snapshot stays eligible on the next read.
  const observedAt = new Date();
  const cutoff = new Date(since ? Math.min(Date.parse(since), observedAt.getTime()) : observedAt.getTime() - FIRST_LOOK_BACK_MS).toISOString();
  const { supabase, tenantId, userId, tenantRole } = await getAuthenticatedContext();
  const owner = affaireOwnerFilter({ userId, tenantRole }, "read");
  const now = observedAt.getTime();
  const staleBefore = new Date(now - AFFAIRE_INTAKE_ANALYSIS_STALE_MS).toISOString();
  const staleNoticeSince = new Date(Date.parse(cutoff) - AFFAIRE_INTAKE_ANALYSIS_STALE_MS).toISOString();

  // The inner joins enforce the affaire's read rule in addition to each table's own RLS.
  const readDocuments = () => {
    const query = supabase.from("affaire_intake_documents").select(
      "id, classification_status, updated_at, issues, created_by, project:estimate_projects!affaire_intake_documents_project_id_fkey!inner(id,name)",
      { count: "exact" }
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).eq("project.is_archived", false)
      .eq("upload_status", "uploaded").is("deleted_at", null).is("deletion_started_at", null)
      .or(`classification_status.eq.queued,updated_at.gt.${cutoff},and(updated_at.gte.${staleNoticeSince},or(classification_status.eq.processing,issues.cs.{"${AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE}"}))`);
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const readRequests = () => {
    const query = supabase.from("takeoff_launch_requests").select(
      `id, state, reason_code, payer_id, confirmed_by, created_at, updated_at, admitted_at, closed_at, outcome, units_expected, units_succeeded, units_failed, units_canceled, jobs:takeoff_jobs!takeoff_jobs_launch_request_fkey(${JOB_COLUMNS}), project:estimate_projects!takeoff_launch_requests_project_fkey!inner(id,name)`,
      { count: "exact" }
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).eq("project.is_archived", false)
      .or(`state.in.(evaluating,not_eligible,blocked,admitted),closed_at.gt.${cutoff},and(state.eq.superseded,updated_at.gt.${cutoff})`);
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const readJobs = () => {
    const query = supabase.from("takeoff_jobs").select(
      `${JOB_COLUMNS}, created_by, analysis_requested_by, updated_at, project:estimate_projects!takeoff_jobs_project_tenant_fkey!inner(id,name)`,
      { count: "exact" }
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).eq("project.is_archived", false)
      .is("launch_request_id", null)
      .or(`status.in.(pending,processing),and(status.eq.failed,execution_provider.eq.chatgpt_local,next_retry_at.not.is.null),analysis_finished_at.gt.${cutoff},and(analysis_finished_at.is.null,completed_at.gt.${cutoff}),and(analysis_finished_at.is.null,completed_at.is.null,updated_at.gt.${cutoff})`);
    return owner ? query.eq("project.user_id", owner) : query;
  };

  const enabled = takeoffModuleDefault() || readFeatureEnabled(tenantId, TAKEOFF_MODULE_ENABLED_FLAG_KEY, { supabase }).then((flag) => {
    // A partial snapshot would let the browser mark unseen métré completions as read.
    if (flag.failed) throw internalError("Impossible de lire le suivi des analyses.");
    return flag.enabled;
  });
  const [documents, takeoff] = await Promise.all([
    readAllRows(readDocuments),
    Promise.resolve(enabled).then((takeoffEnabled) => takeoffEnabled
      ? Promise.all([readAllRows(readRequests), readAllRows(readJobs)]) : null),
  ]);
  const [requests, jobs] = takeoff ?? [];
  for (const result of [documents, requests, jobs]) {
    if (result?.error) throw mapSupabaseError(result.error, "Impossible de lire le suivi des analyses.");
  }
  const readableJobs = [...(jobs?.data ?? []), ...(requests?.data ?? []).flatMap((request) => request.jobs)];
  const exceptions = await listJobsWithBlockingExceptions(supabase, tenantId,
    readableJobs.filter((job) => job.status === "completed" || job.status === "applied").map((job) => job.id));

  const groups = new Map<string, ProgressGroup>();
  function add(project: Project, line: AnalysisProgressLine, own: boolean) {
    const group = groups.get(project.id) ?? { project, lines: [] };
    group.lines.push({ line, own, updatedAt: line.updatedAt });
    groups.set(project.id, group);
  }

  type Dossier = { project: Project; reading: number; waiting: number; classified: number; failed: number; review: number; updatedAt: string; own: boolean };
  const dossiers = new Map<string, Dossier>();
  for (const row of documents.data ?? []) {
    const facts = { classificationStatus: row.classification_status, classificationUpdatedAt: row.updated_at, issues: row.issues };
    const processing = row.classification_status === "processing" || isAffaireIntakeReanalysisPending(facts);
    const stale = Date.parse(row.updated_at) < Date.parse(staleBefore) && isAffaireIntakeAnalysisStale(facts);
    const updatedAt = stale ? new Date(Date.parse(row.updated_at) + AFFAIRE_INTAKE_ANALYSIS_STALE_MS).toISOString() : new Date(row.updated_at).toISOString();
    const bucket = stale ? "failed"
      : processing ? "reading"
      : row.classification_status === "queued" ? "waiting"
      : row.classification_status === "classified" ? "classified"
      : row.classification_status === "failed" ? "failed" : "review";
    if (bucket !== "reading" && bucket !== "waiting" && updatedAt <= cutoff) continue;
    const dossier = dossiers.get(row.project.id) ?? {
      project: row.project, reading: 0, waiting: 0, classified: 0, failed: 0, review: 0, updatedAt, own: false,
    };
    dossier[bucket]++;
    if (updatedAt > dossier.updatedAt) dossier.updatedAt = updatedAt;
    dossier.own ||= row.created_by === userId;
    dossiers.set(row.project.id, dossier);
  }

  for (const dossier of dossiers.values()) {
    const { project, reading, waiting, classified, failed, review, updatedAt, own } = dossier;
    const counts = [
      reading && pieceCount(reading, "en cours"),
      waiting && pieceCount(waiting, "en attente"),
      classified && pieceCount(classified, "classée", "classées"),
      failed && pieceCount(failed, "en échec"),
      review && pieceCount(review, "à vérifier"),
    ].filter(Boolean);
    add(project, {
      id: project.id, kind: "dossier", state: reading ? "reading" : waiting ? "waiting" : "finished",
      // Without a live classification the counts themselves describe the result.
      status: reading || waiting ? AFFAIRE_INTAKE_PROCESSING_LABEL : counts.join(" · "),
      detail: reading || waiting ? counts.join(" · ") : null,
      updatedAt, href: `/dashboard/affaires/${project.id}?view=dossier`,
    }, own);
  }

  for (const row of requests?.data ?? []) {
    if (!isLaunchState(row.state)) continue;
    const { project } = row;
    const jobs = row.jobs.map((job) => zoneJob(project.id, job, exceptions));
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
    const planProgress = describeAffaireTakeoffPlanProgress(units);
    add(project, {
      id: row.id, kind: "takeoff", state,
      status: reviewRequired ? describeAffaireTakeoffJob(reviewRequired).status : presentation.status,
      detail: [planProgress, presentation.message].filter(Boolean).join(" · ") || null,
      updatedAt: new Date(row.closed_at ?? row.updated_at).toISOString(),
      href: (row.outcome === "success" && reviews.length === 1 && reviews[0].reviewHref)
        || `/dashboard/affaires/${project.id}/takeoff?request=${row.id}`,
    }, row.confirmed_by === userId || row.payer_id === userId);
  }

  for (const row of jobs?.data ?? []) {
    const job = zoneJob(row.project.id, row, exceptions);
    add(row.project, {
      id: job.id, kind: "takeoff", state: jobState(job),
      status: row.status === "canceled" ? TAKEOFF_COMPLETION_LABELS.canceled :
        job.status === "provider_pending" ? job.statusLabel : describeAffaireTakeoffJob(job).status,
      detail: job.failure,
      updatedAt: new Date(job.finishedAt ?? row.updated_at).toISOString(),
      href: job.reviewHref ?? `/dashboard/affaires/${row.project.id}/takeoff?job=${job.id}`,
    }, (row.analysis_requested_by ?? row.created_by) === userId);
  }

  const compare = (a: { own: boolean; updatedAt: string }, b: { own: boolean; updatedAt: string }) =>
    Number(b.own) - Number(a.own) || b.updatedAt.localeCompare(a.updatedAt);
  const affaires = [...groups.values()].map(({ project, lines }) => ({
    project, own: lines.some((line) => line.own),
    updatedAt: lines.reduce((latest, line) => line.updatedAt > latest ? line.updatedAt : latest, ""),
    lines: lines.sort(compare).map(({ line }) => line),
  })).sort(compare).map(({ project, lines }) => ({ ...project, lines }));
  return { viewer: { tenantId, userId }, observedAt: observedAt.toISOString(), affaires };
}

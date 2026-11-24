import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { resolveActivityCenterLotLabel } from "@/lib/takeoff/activity-center-shared";
import {
  applyTakeoffJobsListFilters,
  countTakeoffItemsByJobId,
  resolveVersionIdsForProject,
  type AuthenticatedTakeoffContext,
} from "@/lib/takeoff/job-read-server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import type {
  TakeoffActivityCenterResponse,
  TakeoffActivityCenterJobRow,
  TakeoffActivityCenterCounters,
  TakeoffActivityCenterConfidenceLabel,
  TakeoffDispatchOutcome,
  TakeoffDispatchStatus,
} from "@/lib/takeoff/types";
import { toTakeoffAnalysisOutcome } from "@/lib/takeoff/completion-outcome";
import { resolveTakeoffOperatorState, toTakeoffOperatorStateInput } from "@/lib/takeoff/operator-state";
import { readTakeoffExecution, toTakeoffResumeViewer } from "@/lib/takeoff/resume-viewer-server";
import { resolveTakeoffVisibleJobStatus, takeoffCompletionFailureReason } from "@/lib/takeoff/visible-status";
import { listJobsWithBlockingExceptions } from "@/lib/takeoff/review-exceptions-server";
import { getBusinessLevelLabel, getConfidenceLabel } from "@/lib/takeoff/job-list-labels";
import { groupActivityTrackingAttempts, readActivityTrackingSources, takeoffTrackingNotStarted } from "@/lib/takeoff/activity-tracking-server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const JOBS_BATCH_SIZE = 1000;

type ListActivityCenterJobsInput = {
  project_id: string;
  versionId?: string | null;
  lot?: string | null;
  planSetId?: string | null;
  status?: string | null;
  level?: string | null;
  period?: string | null;
  /** A failure link names its job: only that job is listed, with its shared end. */
  jobId?: string | null;
  limit?: number;
  offset?: number;
  /** The page of the affaire's shared ends, independent of the page of jobs. */
  completionsOffset?: number;
  tracking?: boolean;
};

type SupabaseClient = AuthenticatedTakeoffContext["supabase"];

type JobRow = {
  id: string;
  launch_request_id?: string | null;
  launch_unit_key?: string | null;
  estimate_version_id: string | null;
  plan_set_id: string | null;
  source_file_name: string | null;
  source_file_type: string | null;
  level: string;
  status: string;
  analysis_outcome?: string | null;
  analysis_finished_at?: string | null;
  analysis_completion_event_id?: string | null;
  execution_provider?: string | null;
  execution_host_id?: string | null;
  created_by?: string | null;
  completed_at?: string | null;
  started_at?: string | null;
  model?: string | null;
  thinking_level?: string | null;
  error_code?: string | null;
  next_retry_at?: string | null;
  processing_strategy: string | null;
  provider_batch_id: string | null;
  provider_batch_state: string | null;
  provider_batch_updated_at: string | null;
  provider_reconcile_due_at: string | null;
  provider_reconcile_lease_expires_at: string | null;
  created_at: string;
  retry_count: number;
  dispatch_status: TakeoffDispatchStatus | null;
  dispatch_outcome: TakeoffDispatchOutcome | null;
  dispatch_correlation_id: string | null;
  dispatch_updated_at: string | null;
};

type ResolvedJobSource = {
  planSetId: string;
  planSetLabel: string;
  lotLabel: string | null;
};

type PlanSourceCandidate = ResolvedJobSource & {
  estimateVersionId: string | null;
  fileCreatedAt: string;
  planSetCreatedAt: string;
};

type PlanSources = {
  byPlanSetId: Map<string, ResolvedJobSource>;
  // Rapprochement par nom de fichier, pour les jobs sans plan_set_id seulement.
  candidatesByFileName: Map<string, PlanSourceCandidate[]>;
};

function toNormalizedSourceFileKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLocaleLowerCase("fr-FR");
  return normalized.length > 0 ? normalized : null;
}

function comparePlanSourceCandidates(
  left: PlanSourceCandidate,
  right: PlanSourceCandidate,
  estimateVersionId: string | null
) {
  const leftRank =
    left.estimateVersionId === estimateVersionId
      ? 0
      : left.estimateVersionId === null
        ? 1
        : 2;
  const rightRank =
    right.estimateVersionId === estimateVersionId
      ? 0
      : right.estimateVersionId === null
        ? 1
        : 2;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const fileDateComparison = right.fileCreatedAt.localeCompare(left.fileCreatedAt);
  if (fileDateComparison !== 0) {
    return fileDateComparison;
  }

  return right.planSetCreatedAt.localeCompare(left.planSetCreatedAt);
}

async function listMatchingJobs(
  supabase: SupabaseClient,
  tenantId: string,
  filterOpts: {
    projectId: string;
    versionId?: string | null;
    level?: string | null;
    period?: string | null;
    tracking?: boolean;
  }
): Promise<JobRow[]> {
  const jobs: JobRow[] = [];
  let offset = 0;

  while (true) {
    const end = offset + JOBS_BATCH_SIZE - 1;
    const query = applyTakeoffJobsListFilters(
      supabase
        .from("takeoff_jobs" as never)
        .select(
          ("id, estimate_version_id, plan_set_id, launch_request_id, source_file_name, source_file_type, level, status, analysis_outcome, analysis_finished_at, analysis_completion_event_id, execution_provider, execution_host_id, created_by, completed_at, error_code, next_retry_at, processing_strategy, provider_batch_id, provider_batch_state, provider_batch_updated_at, provider_reconcile_due_at, provider_reconcile_lease_expires_at, created_at, retry_count, dispatch_status, dispatch_outcome, dispatch_correlation_id, dispatch_updated_at"
            + (filterOpts.tracking ? ", launch_unit_key, started_at, model, thinking_level" : "")) as never
        )
        .eq("tenant_id" as never, tenantId as never),
      {
        project_id: filterOpts.projectId,
        estimate_version_id: filterOpts.versionId,
        level: filterOpts.level,
        period: filterOpts.period,
      }
    );

    const { data, error } = await (query as ReturnType<typeof supabase.from>)
      .order("created_at" as never, { ascending: false })
      .order("id" as never, { ascending: false })
      .range(offset as never, end as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de charger les jobs du centre d'activité."),
        { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false }
      );
    }

    const rows = (data ?? []) as JobRow[];
    if (rows.length === 0) {
      break;
    }

    jobs.push(...rows);

    if (rows.length < JOBS_BATCH_SIZE) {
      break;
    }

    offset += rows.length;
  }

  return jobs;
}

async function resolvePlanSourceCandidatesForProject(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string
): Promise<PlanSources> {
  const { data: planSetsData, error: planSetsError } = await supabase
    .from("plan_sets" as never)
    .select("id, name, metadata, estimate_version_id, created_at" as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("project_id" as never, projectId as never);

  if (planSetsError) {
    throw toTakeoffError(
      mapSupabaseError(planSetsError, "Impossible de charger les jeux de plans."),
      { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false }
    );
  }

  const planSets = (planSetsData ?? []) as Array<{
    id: string;
    name: string;
    metadata: Record<string, unknown> | null;
    estimate_version_id: string | null;
    created_at: string;
  }>;

  if (planSets.length === 0) {
    return { byPlanSetId: new Map(), candidatesByFileName: new Map() };
  }

  const planSetById = new Map(planSets.map((planSet) => [planSet.id, planSet]));
  const byPlanSetId = new Map<string, ResolvedJobSource>(
    planSets.map((planSet) => [
      planSet.id,
      {
        planSetId: planSet.id,
        planSetLabel: planSet.name,
        lotLabel: resolveActivityCenterLotLabel({
          name: planSet.name,
          metadata: planSet.metadata,
        }),
      },
    ])
  );
  const { data: planFilesData, error: planFilesError } = await supabase
    .from("plan_files" as never)
    .select("plan_set_id, file_name, created_at" as never)
    .eq("tenant_id" as never, tenantId as never)
    .in(
      "plan_set_id" as never,
      planSets.map((planSet) => planSet.id) as never
    );

  if (planFilesError) {
    throw toTakeoffError(
      mapSupabaseError(planFilesError, "Impossible de charger les fichiers de plans."),
      { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false }
    );
  }

  const candidatesByFileName = new Map<string, PlanSourceCandidate[]>();

  for (const planFile of (planFilesData ?? []) as Array<{
    plan_set_id: string;
    file_name: string | null;
    created_at: string;
  }>) {
    const fileKey = toNormalizedSourceFileKey(planFile.file_name);
    if (!fileKey) {
      continue;
    }

    const planSet = planSetById.get(planFile.plan_set_id);
    if (!planSet) {
      continue;
    }

    const candidates = candidatesByFileName.get(fileKey) ?? [];
    candidates.push({
      planSetId: planSet.id,
      planSetLabel: planSet.name,
      lotLabel: resolveActivityCenterLotLabel({
        name: planSet.name,
        metadata: planSet.metadata,
      }),
      estimateVersionId: planSet.estimate_version_id,
      fileCreatedAt: planFile.created_at,
      planSetCreatedAt: planSet.created_at,
    });
    candidatesByFileName.set(fileKey, candidates);
  }

  return { byPlanSetId, candidatesByFileName };
}

function resolveJobSource(
  input: {
    planSources: PlanSources;
    jobPlanSetId: string | null;
    sourceFileName: string | null;
    estimateVersionId: string | null;
    lot?: string | null;
    planSetId?: string | null;
  }
): ResolvedJobSource | null {
  // Un job de jeu de plans porte son jeu : son nom (libellé d'origine depuis M1b) n'est jamais
  // comparé au nom nettoyé des fichiers, où « Plan R+1.pdf » et « Plan R-1.pdf » se confondent.
  if (input.jobPlanSetId) {
    const source = input.planSources.byPlanSetId.get(input.jobPlanSetId) ?? null;
    if (!source) return null;
    if (input.planSetId && source.planSetId !== input.planSetId) return null;
    if (input.lot && source.lotLabel !== input.lot) return null;
    return source;
  }

  const fileKey = toNormalizedSourceFileKey(input.sourceFileName);
  if (!fileKey) {
    return null;
  }

  const candidates = input.planSources.candidatesByFileName.get(fileKey) ?? [];
  if (candidates.length === 0) {
    return null;
  }

  const matchingCandidates = candidates.filter((candidate) => {
    if (input.planSetId && candidate.planSetId !== input.planSetId) {
      return false;
    }

    if (input.lot && candidate.lotLabel !== input.lot) {
      return false;
    }

    return true;
  });

  const resolvedCandidates =
    input.planSetId || input.lot ? matchingCandidates : candidates;
  if (resolvedCandidates.length === 0) {
    return null;
  }

  const [bestCandidate] = [...resolvedCandidates].sort((left, right) =>
    comparePlanSourceCandidates(left, right, input.estimateVersionId)
  );

  return bestCandidate
    ? {
        planSetId: bestCandidate.planSetId,
        planSetLabel: bestCandidate.planSetLabel,
        lotLabel: bestCandidate.lotLabel,
      }
    : null;
}

type EnrichmentResult = {
  confidence: Map<string, number | null>;
  exceptions: Map<string, number>;
  coverage: Map<string, number | null>;
  carryOver: Map<string, string | null>;
};

async function batchEnrich(
  supabase: SupabaseClient,
  tenantId: string,
  jobs: Array<{ id: string; estimate_version_id: string | null }>,
  tracking: boolean,
): Promise<EnrichmentResult> {
  if (jobs.length === 0) {
    return {
      confidence: new Map(),
      exceptions: new Map(),
      coverage: new Map(),
      carryOver: new Map(),
    };
  }

  const jobIds = jobs.map((j) => j.id);

  const [confidenceRows, exceptionRows, linkRows, carryOverRows, totalItemRows] =
    await Promise.all([
      (async () => {
        const { data, error } = await readAllRowsInChunks(jobIds, (pageIds) => supabase
          .from("takeoff_items" as never)
          .select("job_id, confidence, id" as never, { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .in("job_id" as never, pageIds as never));
        if (error) {
          throw toTakeoffError(
            mapSupabaseError(error, "Impossible de calculer la confiance."),
            { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false }
          );
        }
        return (data ?? []) as Array<{ job_id: string; confidence: number | null }>;
      })(),

      // 2. Exceptions: count review decisions per job (each decision = a reviewed line)
      (async () => {
        const { data, error } = await readAllRowsInChunks(jobIds, (pageIds) => supabase
          .from("takeoff_dpgf_review_decisions" as never)
          .select("takeoff_job_id, id" as never, { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .in("takeoff_job_id" as never, pageIds as never));
        if (error) {
          // Table may not exist yet in dev — degrade gracefully for enrichment
          return [] as Array<{ takeoff_job_id: string }>;
        }
        return (data ?? []) as Array<{ takeoff_job_id: string }>;
      })(),

      (async () => {
        const { data, error } = await readAllRowsInChunks(jobIds, (pageIds) => supabase
          .from("takeoff_dpgf_links" as never)
          .select("takeoff_job_id, version_id, estimate_item_id, id" as never, { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .in("takeoff_job_id" as never, pageIds as never));
        if (error) {
          return [] as Array<{
            takeoff_job_id: string;
            version_id: string;
            estimate_item_id: string;
          }>;
        }
        return (data ?? []) as Array<{
          takeoff_job_id: string;
          version_id: string;
          estimate_item_id: string;
        }>;
      })(),

      (async () => {
        const { data, error } = await readAllRowsInChunks(jobIds, (pageIds) => supabase
          .from("takeoff_version_links" as never)
          .select("takeoff_job_id, linked_from_version_id, id" as never, { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .in("takeoff_job_id" as never, pageIds as never));
        if (error) {
          return [] as Array<{
            takeoff_job_id: string;
            linked_from_version_id: string | null;
          }>;
        }
        return (data ?? []) as Array<{
          takeoff_job_id: string;
          linked_from_version_id: string | null;
        }>;
      })(),

      (async () => {
        const versionIds = [...new Set(jobs.flatMap((job) => job.estimate_version_id ? [job.estimate_version_id] : []))];
        const { data, error } = await readAllRowsInChunks(versionIds, (pageIds) => {
          const lines = supabase.from("estimate_items" as never)
            .select("id, version_id" as never, { count: "exact" })
            .eq("tenant_id" as never, tenantId as never)
            .eq("item_type" as never, "line" as never)
            .in("version_id" as never, pageIds as never);
          // The tracking view only names the coverage of imported DPGF lines (as in hasTakeoffDpgfTargetLines).
          return tracking ? lines.eq("source_provider" as never, "dpgf" as never) : lines;
        });
        if (error) {
          return [] as unknown as Array<{ id: string; version_id: string }>;
        }
        return (data ?? []) as unknown as Array<{
          id: string;
          version_id: string;
        }>;
      })(),
    ]);

  const confidenceByJob = new Map<string, number[]>();
  for (const row of confidenceRows) {
    if (row.confidence !== null && Number.isFinite(row.confidence)) {
      const arr = confidenceByJob.get(row.job_id) ?? [];
      arr.push(row.confidence);
      confidenceByJob.set(row.job_id, arr);
    }
  }
  const confidence = new Map<string, number | null>();
  for (const jobId of jobIds) {
    const values = confidenceByJob.get(jobId);
    confidence.set(
      jobId,
      values && values.length > 0
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : null
    );
  }

  const exceptions = new Map<string, number>();
  for (const jobId of jobIds) exceptions.set(jobId, 0);
  for (const row of exceptionRows) {
    exceptions.set(row.takeoff_job_id, (exceptions.get(row.takeoff_job_id) ?? 0) + 1);
  }

  // Build coverage map: unique linked DPGF lines / unique target DPGF lines.
  const lineIdsByVersion = new Map<string, Set<string>>();
  for (const row of totalItemRows) {
    const lineIds = lineIdsByVersion.get(row.version_id) ?? new Set<string>();
    lineIds.add(row.id);
    lineIdsByVersion.set(row.version_id, lineIds);
  }

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const linkedLineIdsByJob = new Map<string, Set<string>>();
  for (const row of linkRows) {
    const job = jobById.get(row.takeoff_job_id);
    const targetLineIds = lineIdsByVersion.get(row.version_id);
    if (
      !job ||
      job.estimate_version_id !== row.version_id ||
      !targetLineIds?.has(row.estimate_item_id)
    ) {
      continue;
    }

    const linkedLineIds =
      linkedLineIdsByJob.get(row.takeoff_job_id) ?? new Set<string>();
    linkedLineIds.add(row.estimate_item_id);
    linkedLineIdsByJob.set(row.takeoff_job_id, linkedLineIds);
  }

  const coverage = new Map<string, number | null>();
  for (const job of jobs) {
    const total = job.estimate_version_id ? lineIdsByVersion.get(job.estimate_version_id)?.size ?? 0 : 0;
    const linked = linkedLineIdsByJob.get(job.id)?.size ?? 0;
    coverage.set(
      job.id,
      total > 0 ? Math.min(100, Math.round((linked / total) * 100)) : null
    );
  }

  // Build carry-over map: first linked version per job
  const carryOver = new Map<string, string | null>();
  for (const jobId of jobIds) carryOver.set(jobId, null);
  for (const row of carryOverRows) {
    if (!carryOver.get(row.takeoff_job_id)) {
      carryOver.set(row.takeoff_job_id, row.linked_from_version_id);
    }
  }

  return { confidence, exceptions, coverage, carryOver };
}

export async function listActivityCenterJobs(
  input: ListActivityCenterJobsInput
): Promise<TakeoffActivityCenterResponse> {
  const { context, project } = await requireAffaireAccess(input.project_id, "read");
  const { supabase, tenantId } = context;
  await assertTakeoffEnabled(tenantId, { supabase });
  // The member's rights on this affaire and the Mac of this request, read once: every row is decided from them.
  const resumeViewer = readTakeoffExecution(context).then((execution) => toTakeoffResumeViewer(context, project, execution));

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(input.offset ?? 0, 0);

  const jobId = input.jobId ?? null;
  const completionsOffset = Math.max(input.completionsOffset ?? 0, 0);

  // The shared ends follow the affaire's read rule, also for a reader whom a job's own rule hides it from. One row
  // beyond the page tells that an older page exists.
  const [versions, completionResult] = await Promise.all([
    resolveVersionIdsForProject({ supabase, tenantId, projectId: input.project_id }),
    supabase.rpc("list_affaire_takeoff_completions" as never, {
      p_project_id: input.project_id,
      p_limit: Math.trunc(limit) + 1,
      p_offset: jobId ? 0 : Math.min(Math.trunc(completionsOffset), 2_147_483_647),
      p_job_id: jobId,
    } as never),
  ]);
  if (completionResult.error) throw mapSupabaseError(completionResult.error, "Impossible de charger les fins d’analyse.");
  const completionRows = (completionResult.data ?? []) as Array<{
    event_id: string; outcome: string; finished_at: string; reason_code?: string | null;
  }>;
  const analysisCompletions = completionRows.slice(0, limit).flatMap((event) => {
    const outcome = toTakeoffAnalysisOutcome(event.outcome);
    return outcome ? [{
      eventId: event.event_id, outcome, finishedAt: event.finished_at,
      failureReason: outcome === "failure" ? takeoffCompletionFailureReason(event.reason_code) : null,
    }] : [];
  });
  const analysisCompletionsHasOlder = completionRows.length > limit;
  const versionNumberMap = new Map(versions.map((v) => [v.id, v.version_number]));

  const baseFilterOpts = {
    projectId: input.project_id,
    versionId: input.versionId,
    level: input.level,
    period: input.period,
    tracking: input.tracking,
  };

  // 3. Resolve all matching rows first so source filters and counters stay global.
  const [allRows, planSources] = await Promise.all([
    listMatchingJobs(supabase, tenantId, baseFilterOpts),
    resolvePlanSourceCandidatesForProject(supabase, tenantId, input.project_id),
  ]);

  const resolvedSourceByJobId = new Map<string, ResolvedJobSource | null>(
    allRows.map((row) => [
      row.id,
      resolveJobSource({
        planSources,
        jobPlanSetId: row.plan_set_id ?? null,
        sourceFileName: row.source_file_name,
        estimateVersionId: row.estimate_version_id,
        lot: input.lot,
        planSetId: input.planSetId,
      }),
    ])
  );

  const sourceFilteredRows =
    input.lot || input.planSetId
      ? allRows.filter((row) => resolvedSourceByJobId.get(row.id) !== null)
      : allRows;

  const blockingExceptionJobIds = await listJobsWithBlockingExceptions(
    supabase,
    tenantId,
    sourceFilteredRows
      .filter((row) => row.status === "completed" || row.status === "applied")
      .map((row) => row.id)
  );
  const visibleStatusByJobId = new Map(
    sourceFilteredRows.map((row) => [
      row.id,
      resolveTakeoffVisibleJobStatus({
        status: row.status,
        processingStrategy:
          row.processing_strategy === "sync" || row.processing_strategy === "batch"
            ? row.processing_strategy
            : null,
        providerBatchState:
          row.provider_batch_state === "submitted" ||
          row.provider_batch_state === "pending" ||
          row.provider_batch_state === "running" ||
          row.provider_batch_state === "succeeded" ||
          row.provider_batch_state === "failed" ||
          row.provider_batch_state === "cancelled" ||
          row.provider_batch_state === "expired" ||
          row.provider_batch_state === "unknown"
            ? row.provider_batch_state
            : null,
        exceptionCount: blockingExceptionJobIds.has(row.id) ? 1 : 0,
      }),
    ])
  );
  const technicalCount = sourceFilteredRows.filter((row) => {
    const visibleStatus = visibleStatusByJobId.get(row.id);
    return (
      visibleStatus?.status === "queued" ||
      visibleStatus?.status === "processing" ||
      visibleStatus?.status === "provider_pending"
    );
  }).length;
  const usableCount = sourceFilteredRows.filter((row) => {
    const visibleStatus = visibleStatusByJobId.get(row.id);
    return (
      visibleStatus?.status === "completed" ||
      visibleStatus?.status === "review_required"
    );
  }).length;
  const blockingExceptionsCount = blockingExceptionJobIds.size;

  const statusFilteredRows = input.status
    ? sourceFilteredRows.filter(
        (row) => visibleStatusByJobId.get(row.id)?.status === input.status
      )
    : sourceFilteredRows;
  // Like the status, the named job narrows the list and not the counters.
  const listedRows = jobId ? statusFilteredRows.filter((row) => row.id === jobId) : statusFilteredRows;
  const tracking = input.tracking ? await readActivityTrackingSources(
    supabase, tenantId, input.project_id, listedRows, analysisCompletions.map((event) => event.eventId)
  ) : null;
  const groups = tracking && !jobId ? groupActivityTrackingAttempts(listedRows, tracking.scopes) : null;
  const displayRows = groups?.rows ?? listedRows;
  const pageOffset = jobId ? 0 : offset;
  const pagedRows = displayRows.slice(pageOffset, pageOffset + limit);
  const total = displayRows.length;
  const jobIds = pagedRows.map((row) => row.id);

  // 5. Batch-enrich completed/applied jobs for the current page only. The lines of every row of the page are counted by
  // one statement: the list makes no request per analysis.
  const enrichableJobs = pagedRows.filter(
    (r) => r.status === "completed" || r.status === "applied"
  );

  const [
    { confidence: confidenceMap, exceptions: exceptionMap, coverage: coverageMap, carryOver: carryOverMap },
    itemCountMap,
  ] = await Promise.all([
    batchEnrich(supabase, tenantId, enrichableJobs, input.tracking === true),
    countTakeoffItemsByJobId({ supabase, tenantId, jobIds }),
  ]);

  const viewer = await resumeViewer;
  const decidedAt = new Date();

  const counters: TakeoffActivityCenterCounters = {
    technicalJobs: technicalCount,
    usableJobs: usableCount,
    blockingExceptionsJobs: blockingExceptionsCount,
  };

  const jobs: TakeoffActivityCenterJobRow[] = pagedRows.map((row) => {
    const versionNumber = row.estimate_version_id ? versionNumberMap.get(row.estimate_version_id) : undefined;
    const isEnrichable = row.status === "completed" || row.status === "applied";
    const avgConfidence = isEnrichable
      ? (confidenceMap.get(row.id) ?? null)
      : null;
    const resolvedSource = resolvedSourceByJobId.get(row.id) ?? null;
    const visibleStatus =
      visibleStatusByJobId.get(row.id) ??
      resolveTakeoffVisibleJobStatus({
        status: row.status,
        processingStrategy:
          row.processing_strategy === "sync" || row.processing_strategy === "batch"
            ? row.processing_strategy
            : null,
        providerBatchState:
          row.provider_batch_state === "submitted" ||
          row.provider_batch_state === "pending" ||
          row.provider_batch_state === "running" ||
          row.provider_batch_state === "succeeded" ||
          row.provider_batch_state === "failed" ||
          row.provider_batch_state === "cancelled" ||
          row.provider_batch_state === "expired" ||
          row.provider_batch_state === "unknown"
            ? row.provider_batch_state
            : null,
        exceptionCount: isEnrichable ? (exceptionMap.get(row.id) ?? 0) : null,
      });
    // The same policy as the job's detail and the retry command, from this row alone: no read per analysis.
    const operatorState = resolveTakeoffOperatorState(toTakeoffOperatorStateInput(row, viewer, decidedAt));

    const outcome = toTakeoffAnalysisOutcome(row.analysis_outcome);
    const analysisCompletion = outcome && row.analysis_finished_at
      ? { eventId: row.analysis_completion_event_id ?? null, outcome, finishedAt: row.analysis_finished_at }
      : null;

    return {
      jobId: row.id,
      launchRequestId: row.launch_request_id ?? null,
      analysisCompletion,
      estimateVersionId: row.estimate_version_id,
      versionLabel: versionNumber != null ? `V${versionNumber}` : row.estimate_version_id ?? "Sans devis",
      lotLabel: resolvedSource?.lotLabel ?? null,
      planSetLabel: resolvedSource?.planSetLabel ?? null,
      levelLabel: getBusinessLevelLabel(row.level) as TakeoffActivityCenterJobRow["levelLabel"],
      processingStrategy:
        row.processing_strategy === "sync" || row.processing_strategy === "batch"
          ? row.processing_strategy
          : null,
      providerBatchState:
        row.provider_batch_state === "submitted" ||
        row.provider_batch_state === "pending" ||
        row.provider_batch_state === "running" ||
        row.provider_batch_state === "succeeded" ||
        row.provider_batch_state === "failed" ||
        row.provider_batch_state === "cancelled" ||
        row.provider_batch_state === "expired" ||
        row.provider_batch_state === "unknown"
          ? row.provider_batch_state
          : null,
      providerBatchUpdatedAt: row.provider_batch_updated_at ?? null,
      providerReconcileDueAt: row.provider_reconcile_due_at ?? null,
      providerReconcileLeaseExpiresAt:
        row.provider_reconcile_lease_expires_at ?? null,
      statusLabel: visibleStatus.label,
      statusRaw: visibleStatus.status,
      technicalStatusRaw: row.status,
      operatorState: operatorState.state,
      operatorStateLabel: operatorState.label,
      canCancel: operatorState.canCancel,
      canResubmit: operatorState.canResubmit,
      resume: operatorState.resume,
      errorCode: row.error_code ?? null,
      nextRetryAt: row.next_retry_at ?? null,
      itemCount: itemCountMap.get(row.id) ?? 0,
      coveragePercent: isEnrichable ? (coverageMap.get(row.id) ?? null) : null,
      exceptionCount: isEnrichable ? (exceptionMap.get(row.id) ?? 0) : 0,
      confidenceLabel: getConfidenceLabel(avgConfidence) as TakeoffActivityCenterConfidenceLabel,
      appliedCount: row.status === "applied" ? 1 : 0,
      createdAt: row.created_at,
      carriedOverFrom: isEnrichable ? (carryOverMap.get(row.id) ?? null) : null,
      neverApplied: row.status === "completed",
      retryCount: row.retry_count,
      dispatchStatus: row.dispatch_status ?? null,
      dispatchOutcome: row.dispatch_outcome ?? null,
      dispatchCorrelationId: row.dispatch_correlation_id ?? null,
      dispatchUpdatedAt: row.dispatch_updated_at ?? null,
      ...(tracking && {
        plans: tracking.scopes.get(row.id)?.plans ?? [],
        notStarted: takeoffTrackingNotStarted(row),
        model: row.model ?? null,
        reasoningEffort: row.thinking_level ?? null,
        previousAttempts: groups?.previousAttempts.get(row.id) ?? [],
      }),
    };
  });

  return {
    counters,
    jobs,
    analysisCompletions: tracking ? analysisCompletions.map((event) => ({
      ...event, plans: tracking.eventPlans.get(event.eventId) ?? [],
    })) : analysisCompletions,
    analysisCompletionsHasOlder,
    pagination: { limit, offset: pageOffset, total },
  };
}

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { resolveActivityCenterLotLabel } from "@/lib/takeoff/activity-center-shared";
import {
  getBusinessLevelLabel,
  getConfidenceLabel,
} from "@/components/takeoff/takeoff-job-list-shared";
import type {
  TakeoffActivityCenterResponse,
  TakeoffActivityCenterJobRow,
  TakeoffActivityCenterCounters,
  TakeoffActivityCenterConfidenceLabel,
} from "@/lib/takeoff/types";
import { resolveTakeoffVisibleJobStatus } from "@/lib/takeoff/visible-status";

/* ─── Constants ─── */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VERSIONS_BATCH_SIZE = 1000;
const JOBS_BATCH_SIZE = 1000;

const TAKEOFF_JOB_LIST_PERIOD_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/* ─── Input type ─── */

type ListActivityCenterJobsInput = {
  project_id: string;
  versionId?: string | null;
  lot?: string | null;
  planSetId?: string | null;
  status?: string | null;
  level?: string | null;
  period?: string | null;
  limit?: number;
  offset?: number;
};

/* ─── Helpers ─── */

type SupabaseClient = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

type JobRow = {
  id: string;
  estimate_version_id: string;
  source_file_name: string | null;
  source_file_type: string | null;
  level: string;
  status: string;
  processing_strategy: string | null;
  provider_batch_state: string | null;
  provider_batch_updated_at: string | null;
  created_at: string;
  retry_count: number;
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

async function resolveVersionIdsForProject(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string
): Promise<Array<{ id: string; version_number: number }>> {
  const versions: Array<{ id: string; version_number: number }> = [];
  let offset = 0;

  while (true) {
    const end = offset + VERSIONS_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("estimate_versions")
      .select("id, version_number")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("version_number", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, end);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de resoudre les versions du projet."),
        { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false }
      );
    }

    const rows = (data ?? []) as Array<{ id: string; version_number: number }>;
    if (rows.length === 0) break;

    versions.push(...rows);
    offset += rows.length;
  }

  return versions;
}

function resolvePeriodStart(period: string | null | undefined): string | null {
  if (!period) return null;
  const days = TAKEOFF_JOB_LIST_PERIOD_DAYS[period];
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function toNormalizedSourceFileKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLocaleLowerCase("fr-FR");
  return normalized.length > 0 ? normalized : null;
}

type FilterableQuery = {
  eq: (col: string, val: string) => FilterableQuery;
  gte: (col: string, val: string) => FilterableQuery;
  in: (col: string, vals: string[]) => FilterableQuery;
};

function applyFilters<T extends FilterableQuery>(
  query: T,
  opts: {
    versionIds?: string[];
    versionId?: string | null;
    status?: string | null;
    level?: string | null;
    period?: string | null;
  }
): T {
  let q = query;

  if (opts.versionIds && opts.versionIds.length > 0) {
    q = q.in("estimate_version_id", opts.versionIds) as T;
  } else if (opts.versionId) {
    q = q.eq("estimate_version_id", opts.versionId) as T;
  }

  if (opts.status) {
    q = q.eq("status", opts.status) as T;
  }

  if (opts.level) {
    q = q.eq("level", opts.level) as T;
  }

  const periodStart = resolvePeriodStart(opts.period);
  if (periodStart) {
    q = q.gte("created_at", periodStart) as T;
  }

  return q;
}

function comparePlanSourceCandidates(
  left: PlanSourceCandidate,
  right: PlanSourceCandidate,
  estimateVersionId: string
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
    versionIds: string[];
    level?: string | null;
    period?: string | null;
  }
): Promise<JobRow[]> {
  const jobs: JobRow[] = [];
  let offset = 0;

  while (true) {
    const end = offset + JOBS_BATCH_SIZE - 1;
    const query = applyFilters(
      supabase
        .from("takeoff_jobs" as never)
        .select(
          "id, estimate_version_id, source_file_name, source_file_type, level, status, processing_strategy, provider_batch_state, provider_batch_updated_at, created_at, retry_count" as never
        )
        .eq("tenant_id" as never, tenantId as never),
      filterOpts
    );

    const { data, error } = await (query as ReturnType<typeof supabase.from>)
      .order("created_at" as never, { ascending: false })
      .order("id" as never, { ascending: false })
      .range(offset as never, end as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de charger les jobs du centre d'activite."),
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
): Promise<Map<string, PlanSourceCandidate[]>> {
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
    return new Map();
  }

  const planSetById = new Map(planSets.map((planSet) => [planSet.id, planSet]));
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

  return candidatesByFileName;
}

function resolveJobSource(
  input: {
    candidatesByFileName: Map<string, PlanSourceCandidate[]>;
    sourceFileName: string | null;
    estimateVersionId: string;
    lot?: string | null;
    planSetId?: string | null;
  }
): ResolvedJobSource | null {
  const fileKey = toNormalizedSourceFileKey(input.sourceFileName);
  if (!fileKey) {
    return null;
  }

  const candidates = input.candidatesByFileName.get(fileKey) ?? [];
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

async function listJobsWithBlockingExceptions(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[]
): Promise<Set<string>> {
  if (jobIds.length === 0) {
    return new Set();
  }

  const jobsWithExceptions = new Set<string>();

  for (let start = 0; start < jobIds.length; start += JOBS_BATCH_SIZE) {
    const batch = jobIds.slice(start, start + JOBS_BATCH_SIZE);
    const { data, error } = await supabase
      .from("takeoff_dpgf_review_decisions" as never)
      .select("takeoff_job_id" as never)
      .eq("tenant_id" as never, tenantId as never)
      .in("takeoff_job_id" as never, batch as never);

    if (error) {
      return new Set();
    }

    for (const row of (data ?? []) as Array<{ takeoff_job_id: string }>) {
      jobsWithExceptions.add(row.takeoff_job_id);
    }
  }

  return jobsWithExceptions;
}

async function countItemsByJobId(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[]
): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();

  const entries = await Promise.all(
    jobIds.map(async (jobId) => {
      const { count, error } = await supabase
        .from("takeoff_items" as never)
        .select("id" as never, { count: "exact", head: true })
        .eq("tenant_id" as never, tenantId as never)
        .eq("job_id" as never, jobId as never);

      if (error) {
        throw toTakeoffError(
          mapSupabaseError(error, "Impossible de compter les items du job takeoff."),
          { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId }
        );
      }

      return [jobId, count ?? 0] as const;
    })
  );

  return new Map(entries);
}

/* ─── Batched enrichment helpers ─── */

type EnrichmentResult = {
  confidence: Map<string, number | null>;
  exceptions: Map<string, number>;
  coverage: Map<string, number>;
  carryOver: Map<string, string | null>;
};

async function batchEnrich(
  supabase: SupabaseClient,
  tenantId: string,
  jobs: Array<{ id: string; estimate_version_id: string }>
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

  // Run all batched queries in parallel
  const [confidenceRows, exceptionRows, linkRows, carryOverRows, totalItemRows] =
    await Promise.all([
      // 1. Confidence: fetch all items with confidence for all enrichable jobs
      (async () => {
        const { data, error } = await supabase
          .from("takeoff_items" as never)
          .select("job_id, confidence" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("job_id" as never, jobIds as never);
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
        const { data, error } = await supabase
          .from("takeoff_dpgf_review_decisions" as never)
          .select("takeoff_job_id" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("takeoff_job_id" as never, jobIds as never);
        if (error) {
          // Table may not exist yet in dev — degrade gracefully for enrichment
          return [] as Array<{ takeoff_job_id: string }>;
        }
        return (data ?? []) as Array<{ takeoff_job_id: string }>;
      })(),

      // 3. Coverage: count linked DPGF lines per job
      (async () => {
        const { data, error } = await supabase
          .from("takeoff_dpgf_links" as never)
          .select("takeoff_job_id, version_id" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("takeoff_job_id" as never, jobIds as never);
        if (error) return [] as Array<{ takeoff_job_id: string; version_id: string }>;
        return (data ?? []) as Array<{ takeoff_job_id: string; version_id: string }>;
      })(),

      // 4. Carry-over: check version links
      (async () => {
        const { data, error } = await supabase
          .from("takeoff_version_links" as never)
          .select("takeoff_job_id, linked_from_version_id" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("takeoff_job_id" as never, jobIds as never);
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

      // 5. Total estimate items per version (for coverage denominator)
      (async () => {
        const versionIds = [...new Set(jobs.map((j) => j.estimate_version_id))];
        const { data, error } = await supabase
          .from("estimate_items" as never)
          .select("estimate_version_id" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("estimate_version_id" as never, versionIds as never);
        if (error) return [] as unknown as Array<{ estimate_version_id: string }>;
        return (data ?? []) as unknown as Array<{ estimate_version_id: string }>;
      })(),
    ]);

  // Build confidence map: average per job
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

  // Build exceptions map: count per job
  const exceptions = new Map<string, number>();
  for (const jobId of jobIds) exceptions.set(jobId, 0);
  for (const row of exceptionRows) {
    exceptions.set(row.takeoff_job_id, (exceptions.get(row.takeoff_job_id) ?? 0) + 1);
  }

  // Build coverage map: linked/total per job
  const linkCountByJob = new Map<string, number>();
  for (const row of linkRows) {
    linkCountByJob.set(row.takeoff_job_id, (linkCountByJob.get(row.takeoff_job_id) ?? 0) + 1);
  }
  const totalItemsByVersion = new Map<string, number>();
  for (const row of totalItemRows) {
    totalItemsByVersion.set(
      row.estimate_version_id,
      (totalItemsByVersion.get(row.estimate_version_id) ?? 0) + 1
    );
  }
  const coverage = new Map<string, number>();
  for (const job of jobs) {
    const linked = linkCountByJob.get(job.id) ?? 0;
    const total = totalItemsByVersion.get(job.estimate_version_id) ?? 0;
    coverage.set(job.id, total > 0 ? Math.min(100, Math.round((linked / total) * 100)) : 0);
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

/* ─── Main function ─── */

export async function listActivityCenterJobs(
  input: ListActivityCenterJobsInput
): Promise<TakeoffActivityCenterResponse> {
  const { supabase, tenantId } = await getAuthenticatedContext();
  await assertTakeoffEnabled(tenantId, { supabase });

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(input.offset ?? 0, 0);

  // 1. Resolve version IDs for the project
  const versions = await resolveVersionIdsForProject(
    supabase,
    tenantId,
    input.project_id
  );
  const versionIds = versions.map((v) => v.id);
  const versionNumberMap = new Map(versions.map((v) => [v.id, v.version_number]));

  if (versionIds.length === 0) {
    return {
      counters: { technicalJobs: 0, usableJobs: 0, blockingExceptionsJobs: 0 },
      jobs: [],
      pagination: { limit, offset, total: 0 },
    };
  }

  // 2. Determine effective version filter
  const effectiveVersionIds =
    input.versionId && versionIds.includes(input.versionId)
      ? [input.versionId]
      : versionIds;

  const baseFilterOpts = {
    versionIds: effectiveVersionIds,
    level: input.level,
    period: input.period,
  };

  // 3. Resolve all matching rows first so source filters and counters stay global.
  const [allRows, planSourceCandidatesByFileName] = await Promise.all([
    listMatchingJobs(supabase, tenantId, baseFilterOpts),
    resolvePlanSourceCandidatesForProject(supabase, tenantId, input.project_id),
  ]);

  const resolvedSourceByJobId = new Map<string, ResolvedJobSource | null>(
    allRows.map((row) => [
      row.id,
      resolveJobSource({
        candidatesByFileName: planSourceCandidatesByFileName,
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
  const pagedRows = statusFilteredRows.slice(offset, offset + limit);
  const total = statusFilteredRows.length;
  const jobIds = pagedRows.map((row) => row.id);

  // 4. Item counts
  const itemCountMap = await countItemsByJobId(supabase, tenantId, jobIds);

  // 5. Batch-enrich completed/applied jobs for the current page only.
  const enrichableJobs = pagedRows.filter(
    (r) => r.status === "completed" || r.status === "applied"
  );

  const { confidence: confidenceMap, exceptions: exceptionMap, coverage: coverageMap, carryOver: carryOverMap } =
    await batchEnrich(supabase, tenantId, enrichableJobs);

  const counters: TakeoffActivityCenterCounters = {
    technicalJobs: technicalCount,
    usableJobs: usableCount,
    blockingExceptionsJobs: blockingExceptionsCount,
  };

  // 7. Map rows to response
  const jobs: TakeoffActivityCenterJobRow[] = pagedRows.map((row) => {
    const versionNumber = versionNumberMap.get(row.estimate_version_id);
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

    return {
      jobId: row.id,
      estimateVersionId: row.estimate_version_id,
      versionLabel: versionNumber != null ? `V${versionNumber}` : row.estimate_version_id,
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
      statusLabel: visibleStatus.label,
      statusRaw: visibleStatus.status,
      technicalStatusRaw: row.status,
      itemCount: itemCountMap.get(row.id) ?? 0,
      coveragePercent: isEnrichable ? (coverageMap.get(row.id) ?? 0) : 0,
      exceptionCount: isEnrichable ? (exceptionMap.get(row.id) ?? 0) : 0,
      confidenceLabel: getConfidenceLabel(avgConfidence) as TakeoffActivityCenterConfidenceLabel,
      appliedCount: row.status === "applied" ? 1 : 0,
      createdAt: row.created_at,
      carriedOverFrom: isEnrichable ? (carryOverMap.get(row.id) ?? null) : null,
      neverApplied: row.status === "completed",
      retryCount: row.retry_count,
    };
  });

  return {
    counters,
    jobs,
    pagination: { limit, offset, total },
  };
}

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  getBusinessLevelLabel,
  getBusinessStatusLabel,
  getConfidenceLabel,
} from "@/components/takeoff/takeoff-job-list-shared";
import type {
  TakeoffActivityCenterResponse,
  TakeoffActivityCenterJobRow,
  TakeoffActivityCenterCounters,
  TakeoffActivityCenterConfidenceLabel,
} from "@/lib/takeoff/types";

/* ─── Constants ─── */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VERSIONS_BATCH_SIZE = 1000;

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
  const rangeEnd = offset + limit - 1;

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

  const filterOpts = {
    versionIds: effectiveVersionIds,
    status: input.status,
    level: input.level,
    period: input.period,
  };

  // 3. Query jobs for the current page
  const jobsQuery = applyFilters(
    supabase
      .from("takeoff_jobs" as never)
      .select(
        "id, estimate_version_id, source_file_name, source_file_type, level, status, created_at, retry_count" as never,
        { count: "exact" }
      )
      .eq("tenant_id" as never, tenantId as never),
    filterOpts
  );

  const { data, count, error } = await (jobsQuery as ReturnType<typeof supabase.from>)
    .order("created_at" as never, { ascending: false })
    .range(offset as never, rangeEnd as never);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les jobs du centre d'activite."),
      { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false }
    );
  }

  type JobRow = {
    id: string;
    estimate_version_id: string;
    source_file_name: string | null;
    source_file_type: string | null;
    level: string;
    status: string;
    created_at: string;
    retry_count: number;
  };

  const rows = (data ?? []) as JobRow[];
  const total = count ?? 0;
  const jobIds = rows.map((r) => r.id);

  // 4. Item counts
  const itemCountMap = await countItemsByJobId(supabase, tenantId, jobIds);

  // 5. Batch-enrich completed/applied jobs (single pass, not N+1)
  const enrichableJobs = rows.filter(
    (r) => r.status === "completed" || r.status === "applied"
  );

  const { confidence: confidenceMap, exceptions: exceptionMap, coverage: coverageMap, carryOver: carryOverMap } =
    await batchEnrich(supabase, tenantId, enrichableJobs);

  // 6. Build counters across ALL matching jobs (not just current page)
  const counterFilterOpts = {
    versionIds: effectiveVersionIds,
    level: input.level,
    period: input.period,
  };

  const [technicalCount, usableCount] = await Promise.all([
    (async () => {
      const { count: c, error: e } = await applyFilters(
        supabase
          .from("takeoff_jobs" as never)
          .select("id" as never, { count: "exact", head: true })
          .eq("tenant_id" as never, tenantId as never),
        { ...counterFilterOpts, status: null }
      )
        .in("status" as never, ["pending", "processing"] as never);

      if (e) return 0;
      return c ?? 0;
    })(),
    (async () => {
      const { count: c, error: e } = await applyFilters(
        supabase
          .from("takeoff_jobs" as never)
          .select("id" as never, { count: "exact", head: true })
          .eq("tenant_id" as never, tenantId as never),
        { ...counterFilterOpts, status: null }
      )
        .in("status" as never, ["completed", "applied"] as never);

      if (e) return 0;
      return c ?? 0;
    })(),
  ]);

  // Count blocking exceptions from enrichment data
  let blockingExceptionsCount = 0;
  for (const job of enrichableJobs) {
    if ((exceptionMap.get(job.id) ?? 0) > 0) {
      blockingExceptionsCount++;
    }
  }

  const counters: TakeoffActivityCenterCounters = {
    technicalJobs: technicalCount,
    usableJobs: usableCount,
    blockingExceptionsJobs: blockingExceptionsCount,
  };

  // 7. Map rows to response
  const jobs: TakeoffActivityCenterJobRow[] = rows.map((row) => {
    const versionNumber = versionNumberMap.get(row.estimate_version_id);
    const isEnrichable = row.status === "completed" || row.status === "applied";
    const avgConfidence = isEnrichable
      ? (confidenceMap.get(row.id) ?? null)
      : null;

    return {
      jobId: row.id,
      estimateVersionId: row.estimate_version_id,
      versionLabel: versionNumber != null ? `V${versionNumber}` : row.estimate_version_id,
      lotLabel: null,
      planSetLabel: null,
      levelLabel: getBusinessLevelLabel(row.level) as TakeoffActivityCenterJobRow["levelLabel"],
      statusLabel: getBusinessStatusLabel(row.status),
      statusRaw: row.status,
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

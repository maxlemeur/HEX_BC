import { badRequest } from "@/lib/estimates/errors";
import {
  TAKEOFF_LEVELS,
  TAKEOFF_METRICS_PERIODS,
  type TakeoffLevel,
  type TakeoffMetricsCostByLevel,
  type TakeoffMetricsErrorEntry,
  type TakeoffMetricsKpis,
  type TakeoffMetricsPeriod,
  type TakeoffMetricsRecentJob,
  type TakeoffMetricsReliability,
  type TakeoffMetricsStatsPayload,
  type TakeoffMetricsTokenBreakdown,
  type TakeoffMetricsTrendPoint,
} from "@/lib/takeoff/types";

const PERIOD_TO_DAYS: Record<TakeoffMetricsPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

type LevelAccumulator = {
  totalCostCents: number;
  totalTokens: number;
  jobCount: number;
  failedCount: number;
  durationTotalMs: number;
  durationCount: number;
  itemCount: number;
};

export type TakeoffMetricsJobRow = {
  id: string;
  status: string;
  level: string;
  model: string | null;
  duration_ms: number | null;
  cost_cents: number | null;
  retry_count: number;
  error_code: string | null;
  created_at: string;
};

export type TakeoffMetricsRunMetricRow = {
  job_id: string;
  input_tokens: number | null;
  reasoning_tokens: number | null;
  output_tokens: number | null;
  timed_out: boolean;
  budget_exceeded: boolean;
};

export type TakeoffMetricsResultRow = {
  job_id: string;
  confidence: number | null;
};

export type TakeoffMetricsItemRow = {
  job_id: string;
};

export type ParsedTakeoffMetricsQuery = {
  period: TakeoffMetricsPeriod;
  level: TakeoffLevel | null;
  days: number;
  cutoff: string;
};

export type BuildTakeoffMetricsStatsPayloadInput = {
  period: TakeoffMetricsPeriod;
  jobs: TakeoffMetricsJobRow[];
  runMetrics: TakeoffMetricsRunMetricRow[];
  results: TakeoffMetricsResultRow[];
  items: TakeoffMetricsItemRow[];
  now?: Date;
};

export function parseTakeoffMetricsQuery(
  searchParams: URLSearchParams,
  now = new Date()
): ParsedTakeoffMetricsQuery {
  const requestedPeriod = searchParams.get("period");
  const period = (TAKEOFF_METRICS_PERIODS as readonly string[]).includes(
    requestedPeriod ?? ""
  )
    ? (requestedPeriod as TakeoffMetricsPeriod)
    : "30d";

  const requestedLevel = searchParams.get("level")?.trim();
  let level: TakeoffLevel | null = null;
  if (requestedLevel && requestedLevel.length > 0) {
    if (!(TAKEOFF_LEVELS as readonly string[]).includes(requestedLevel)) {
      throw badRequest(
        "Parametre level invalide. Valeurs autorisees: A, B, C.",
        { level: requestedLevel },
        "BAD_REQUEST"
      );
    }
    level = requestedLevel as TakeoffLevel;
  }

  const days = PERIOD_TO_DAYS[period];
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return {
    period,
    level,
    days,
    cutoff: cutoffDate.toISOString(),
  };
}

function buildTrendBuckets(
  period: TakeoffMetricsPeriod,
  days: number,
  now: Date
): TakeoffMetricsTrendPoint[] {
  if (period === "7d") {
    return Array.from({ length: days }, (_, index) => {
      const day = new Date(now);
      day.setDate(day.getDate() - (days - 1 - index));
      const key = day.toISOString().slice(0, 10);
      const label = day.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
      });
      return { key, label, createdCount: 0, failedCount: 0 };
    });
  }

  const weekCount = Math.ceil(days / 7);
  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (weekCount - 1 - index) * 7);
    const key = weekStart.toISOString().slice(0, 10);
    const label = weekStart.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
    return { key, label, createdCount: 0, failedCount: 0 };
  });
}

function toBucketKey(
  dateStr: string,
  period: TakeoffMetricsPeriod,
  buckets: TakeoffMetricsTrendPoint[]
): string | null {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (period === "7d") {
    return parsed.toISOString().slice(0, 10);
  }

  const dateKey = parsed.toISOString().slice(0, 10);
  let matchedKey: string | null = null;
  for (const bucket of buckets) {
    if (bucket.key <= dateKey) {
      matchedKey = bucket.key;
    }
  }

  return matchedKey;
}

export function buildTakeoffMetricsStatsPayload(
  input: BuildTakeoffMetricsStatsPayloadInput
): TakeoffMetricsStatsPayload {
  const now = input.now ?? new Date();
  const { period, jobs } = input;
  const days = PERIOD_TO_DAYS[period];

  const jobById = new Map(jobs.map((job) => [job.id, job] as const));

  const runMetrics = input.runMetrics.filter((metric) => jobById.has(metric.job_id));
  const results = input.results.filter((result) => jobById.has(result.job_id));
  const items = input.items.filter((item) => jobById.has(item.job_id));

  const itemCountByJob = new Map<string, number>();
  for (const item of items) {
    itemCountByJob.set(item.job_id, (itemCountByJob.get(item.job_id) ?? 0) + 1);
  }

  const confidenceByJobId = new Map<string, number>();
  for (const result of results) {
    if (result.confidence != null) {
      confidenceByJobId.set(result.job_id, result.confidence);
    }
  }

  // KPIs
  let completedJobs = 0;
  let failedJobs = 0;
  let canceledJobs = 0;
  let appliedJobs = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  let totalCostCents = 0;

  for (const job of jobs) {
    if (job.status === "completed" || job.status === "applied") {
      completedJobs += 1;
      if (job.status === "applied") {
        appliedJobs += 1;
      }
      if (job.duration_ms != null) {
        totalDurationMs += job.duration_ms;
        durationCount += 1;
      }
    } else if (job.status === "failed") {
      failedJobs += 1;
    } else if (job.status === "canceled") {
      canceledJobs += 1;
    }

    if (job.cost_cents != null) {
      totalCostCents += job.cost_cents;
    }
  }

  const totalJobs = jobs.length;
  const terminalJobs = completedJobs + failedJobs + canceledJobs;
  const successRate =
    terminalJobs > 0
      ? Number(((completedJobs / terminalJobs) * 100).toFixed(1))
      : 0;
  const avgDurationMs =
    durationCount > 0 ? Math.round(totalDurationMs / durationCount) : 0;
  const avgCostCentsPerJob =
    totalJobs > 0 ? Math.round(totalCostCents / totalJobs) : 0;
  const avgItemsPerJob =
    totalJobs > 0
      ? Number(
          (
            Array.from(itemCountByJob.values()).reduce(
              (sum, count) => sum + count,
              0
            ) / totalJobs
          ).toFixed(2)
        )
      : 0;

  const confidenceValues = Array.from(confidenceByJobId.values());
  const avgConfidence =
    confidenceValues.length > 0
      ? Number(
          (
            confidenceValues.reduce((sum, confidence) => sum + confidence, 0) /
            confidenceValues.length
          ).toFixed(3)
        )
      : 0;

  const kpis: TakeoffMetricsKpis = {
    totalJobs,
    completedJobs,
    failedJobs,
    canceledJobs,
    appliedJobs,
    successRate,
    avgDurationMs,
    totalCostCents,
    avgCostCentsPerJob,
    avgConfidence,
    avgItemsPerJob,
  };

  // Trend
  const trendBuckets = buildTrendBuckets(period, days, now);
  const trendMap = new Map(trendBuckets.map((bucket) => [bucket.key, bucket]));
  for (const job of jobs) {
    const bucketKey = toBucketKey(job.created_at, period, trendBuckets);
    if (!bucketKey) {
      continue;
    }
    const bucket = trendMap.get(bucketKey);
    if (!bucket) {
      continue;
    }
    bucket.createdCount += 1;
    if (job.status === "failed") {
      bucket.failedCount += 1;
    }
  }

  // Cost and reliability by level
  const byLevel = new Map<string, LevelAccumulator>();
  for (const job of jobs) {
    const levelKey = job.level || "?";
    const entry = byLevel.get(levelKey) ?? {
      totalCostCents: 0,
      totalTokens: 0,
      jobCount: 0,
      failedCount: 0,
      durationTotalMs: 0,
      durationCount: 0,
      itemCount: 0,
    };

    entry.jobCount += 1;
    entry.itemCount += itemCountByJob.get(job.id) ?? 0;
    if (job.status === "failed") {
      entry.failedCount += 1;
    }
    if (job.cost_cents != null) {
      entry.totalCostCents += job.cost_cents;
    }
    if (job.duration_ms != null) {
      entry.durationTotalMs += job.duration_ms;
      entry.durationCount += 1;
    }

    byLevel.set(levelKey, entry);
  }

  for (const metric of runMetrics) {
    const job = jobById.get(metric.job_id);
    if (!job) {
      continue;
    }
    const levelKey = job.level || "?";
    const entry = byLevel.get(levelKey);
    if (!entry) {
      continue;
    }
    entry.totalTokens +=
      (metric.input_tokens ?? 0) +
      (metric.reasoning_tokens ?? 0) +
      (metric.output_tokens ?? 0);
  }

  const costByLevel: TakeoffMetricsCostByLevel[] = Array.from(byLevel.entries())
    .map(([level, data]) => ({
      level,
      totalCostCents: data.totalCostCents,
      totalTokens: data.totalTokens,
      jobCount: data.jobCount,
      failedCount: data.failedCount,
      avgDurationMs:
        data.durationCount > 0
          ? Math.round(data.durationTotalMs / data.durationCount)
          : 0,
      failureRate:
        data.jobCount > 0
          ? Number(((data.failedCount / data.jobCount) * 100).toFixed(1))
          : 0,
      avgItemsPerJob:
        data.jobCount > 0
          ? Number((data.itemCount / data.jobCount).toFixed(2))
          : 0,
    }))
    .sort((a, b) => a.level.localeCompare(b.level));

  // Token breakdown
  let inputTokens = 0;
  let reasoningTokens = 0;
  let outputTokens = 0;
  for (const metric of runMetrics) {
    inputTokens += metric.input_tokens ?? 0;
    reasoningTokens += metric.reasoning_tokens ?? 0;
    outputTokens += metric.output_tokens ?? 0;
  }
  const tokenBreakdown: TakeoffMetricsTokenBreakdown = {
    inputTokens,
    reasoningTokens,
    outputTokens,
  };

  // Top errors
  const errorsByCode = new Map<string, { count: number; lastOccurrence: string }>();
  for (const job of jobs) {
    if (job.status !== "failed" || !job.error_code) {
      continue;
    }
    const existing = errorsByCode.get(job.error_code);
    if (!existing) {
      errorsByCode.set(job.error_code, {
        count: 1,
        lastOccurrence: job.created_at,
      });
      continue;
    }
    existing.count += 1;
    if (job.created_at > existing.lastOccurrence) {
      existing.lastOccurrence = job.created_at;
    }
  }
  const topErrors: TakeoffMetricsErrorEntry[] = Array.from(errorsByCode.entries())
    .map(([errorCode, data]) => ({
      errorCode,
      count: data.count,
      lastOccurrence: data.lastOccurrence,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Reliability
  let timedOutCount = 0;
  let budgetExceededCount = 0;
  for (const metric of runMetrics) {
    if (metric.timed_out) {
      timedOutCount += 1;
    }
    if (metric.budget_exceeded) {
      budgetExceededCount += 1;
    }
  }

  let retriedJobs = 0;
  let retriedThenCompleted = 0;
  for (const job of jobs) {
    if (job.retry_count <= 0) {
      continue;
    }
    retriedJobs += 1;
    if (job.status === "completed" || job.status === "applied") {
      retriedThenCompleted += 1;
    }
  }

  const reliability: TakeoffMetricsReliability = {
    timedOutCount,
    budgetExceededCount,
    totalRunMetrics: runMetrics.length,
    retriedJobs,
    retriedThenCompleted,
    retrySuccessRate:
      retriedJobs > 0
        ? Number(((retriedThenCompleted / retriedJobs) * 100).toFixed(1))
        : 0,
  };

  // Recent jobs
  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const recentJobs: TakeoffMetricsRecentJob[] = sortedJobs
    .slice(0, 15)
    .map((job) => ({
      id: job.id,
      status: job.status,
      level: job.level,
      model: job.model,
      durationMs: job.duration_ms,
      costCents: job.cost_cents,
      confidence: confidenceByJobId.get(job.id) ?? null,
      errorCode: job.error_code,
      createdAt: job.created_at,
    }));

  return {
    generatedAt: now.toISOString(),
    period,
    kpis,
    trend: trendBuckets,
    costByLevel,
    tokenBreakdown,
    topErrors,
    reliability,
    recentJobs,
  };
}

import { badRequest } from "@/lib/estimates/errors";
import {
  TAKEOFF_LEVELS,
  TAKEOFF_METRICS_PERIODS,
  type TakeoffCorrectionMetrics,
  type TakeoffCorrectionMetricsByLevel,
  type TakeoffCorrectionMetricsEventCount,
  type TakeoffCorrectionMetricsEventType,
  type TakeoffCorrectionMetricsKpis,
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

function getTrendWindowStart(
  period: TakeoffMetricsPeriod,
  days: number,
  now: Date
): Date {
  const trendStart = new Date(now);
  const offsetDays = period === "7d" ? days - 1 : days;
  trendStart.setDate(trendStart.getDate() - offsetDays);
  return trendStart;
}

type LevelAccumulator = {
  totalCostCents: number;
  totalTokens: number;
  jobCount: number;
  failedCount: number;
  durationTotalMs: number;
  durationCount: number;
  itemCount: number;
};

const CORRECTION_EVENT_LABELS: Record<TakeoffCorrectionMetricsEventType, string> = {
  item_excluded: "Items exclus",
  designation_changed: "Designations corrigees",
  quantity_changed: "Quantites corrigees",
  unit_changed: "Unites corrigees",
  manual_verification: "Verifications manuelles",
  dpgf_keep_dpgf: "DPGF conserve",
  dpgf_keep_takeoff: "Takeoff valide",
  dpgf_manual_fix: "Corrections DPGF manuelles",
  dpgf_out_of_scope: "Lignes hors scope",
};

const CORRECTION_EVENT_ORDER: TakeoffCorrectionMetricsEventType[] = [
  "item_excluded",
  "designation_changed",
  "quantity_changed",
  "unit_changed",
  "manual_verification",
  "dpgf_keep_dpgf",
  "dpgf_keep_takeoff",
  "dpgf_manual_fix",
  "dpgf_out_of_scope",
];

const MATERIAL_CORRECTION_EVENTS = new Set<TakeoffCorrectionMetricsEventType>([
  "item_excluded",
  "designation_changed",
  "quantity_changed",
  "unit_changed",
  "dpgf_keep_dpgf",
  "dpgf_manual_fix",
  "dpgf_out_of_scope",
]);

const QUICK_VALIDATION_EVENTS = new Set<TakeoffCorrectionMetricsEventType>([
  "manual_verification",
  "dpgf_keep_takeoff",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedRecord(
  value: unknown,
  key: string
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function readNestedString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" ? nested : null;
}

function readNestedBoolean(value: unknown, key: string): boolean | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "boolean" ? nested : null;
}

function mapAuditLogToCorrectionEventType(
  auditLog: TakeoffMetricsAuditLogRow
): TakeoffCorrectionMetricsEventType | null {
  if (auditLog.action === "takeoff.dpgf.review_decision") {
    const metadata = readNestedRecord(auditLog.after_data, "metadata");
    const nextDecision = readNestedString(metadata, "next_decision");
    return nextDecision ? mapReviewDecisionToCorrectionEventType(nextDecision) : null;
  }

  if (auditLog.action === "takeoff.item.excluded") {
    return "item_excluded";
  }

  if (auditLog.action !== "takeoff.item.modified") {
    return null;
  }

  const metadata = readNestedRecord(auditLog.after_data, "metadata");
  const field = readNestedString(metadata, "field");

  switch (field) {
    case "designation":
      return "designation_changed";
    case "quantity":
      return "quantity_changed";
    case "unit":
      return "unit_changed";
    case "is_verified": {
      const nextValue = readNestedBoolean(metadata, "next_value");
      return nextValue ? "manual_verification" : null;
    }
    default:
      return null;
  }
}

function mapReviewDecisionToCorrectionEventType(
  decision: string
): TakeoffCorrectionMetricsEventType | null {
  switch (decision) {
    case "keep_dpgf":
      return "dpgf_keep_dpgf";
    case "keep_takeoff":
      return "dpgf_keep_takeoff";
    case "manual_fix":
      return "dpgf_manual_fix";
    case "out_of_scope":
      return "dpgf_out_of_scope";
    default:
      return null;
  }
}

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

export type TakeoffMetricsAuditLogRow = {
  record_id: string;
  action: string;
  created_at: string;
  after_data: unknown;
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
  auditLogs?: TakeoffMetricsAuditLogRow[];
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
  const cutoffDate = getTrendWindowStart(period, days, now);

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
    const trendStart = getTrendWindowStart(period, days, now);
    return Array.from({ length: days }, (_, index) => {
      const day = new Date(trendStart);
      day.setDate(day.getDate() + index);
      const key = day.toISOString().slice(0, 10);
      const label = day.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
      });
      return { key, label, createdCount: 0, failedCount: 0 };
    });
  }

  const weekCount = Math.ceil(days / 7);
  const oldestBucketStart = getTrendWindowStart(period, days, now);

  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = new Date(oldestBucketStart);
    weekStart.setDate(weekStart.getDate() + index * 7);
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
  const auditLogs = (input.auditLogs ?? []).filter((auditLog) =>
    jobById.has(auditLog.record_id)
  );

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

  const successfulJobIds = new Set(
    jobs
      .filter((job) => job.status === "completed" || job.status === "applied")
      .map((job) => job.id)
  );
  const eventCountsMap = new Map<TakeoffCorrectionMetricsEventType, number>();
  const jobEventTypes = new Map<string, Set<TakeoffCorrectionMetricsEventType>>();

  const registerCorrectionEvent = (
    jobId: string,
    type: TakeoffCorrectionMetricsEventType
  ) => {
    eventCountsMap.set(type, (eventCountsMap.get(type) ?? 0) + 1);
    const existing = jobEventTypes.get(jobId) ?? new Set<TakeoffCorrectionMetricsEventType>();
    existing.add(type);
    jobEventTypes.set(jobId, existing);
  };

  for (const auditLog of auditLogs) {
    const eventType = mapAuditLogToCorrectionEventType(auditLog);
    if (!eventType) {
      continue;
    }
    registerCorrectionEvent(auditLog.record_id, eventType);
  }

  let correctedJobs = 0;
  let quicklyValidatedJobs = 0;
  let untouchedSuccessfulJobs = 0;
  const correctionByLevel = new Map<
    string,
    {
      successfulJobs: number;
      correctedJobs: number;
      quicklyValidatedJobs: number;
      untouchedSuccessfulJobs: number;
    }
  >();

  for (const job of jobs) {
    if (!successfulJobIds.has(job.id)) {
      continue;
    }

    const levelKey = job.level || "?";
    const levelEntry = correctionByLevel.get(levelKey) ?? {
      successfulJobs: 0,
      correctedJobs: 0,
      quicklyValidatedJobs: 0,
      untouchedSuccessfulJobs: 0,
    };
    levelEntry.successfulJobs += 1;

    const jobTypes = jobEventTypes.get(job.id) ?? new Set<TakeoffCorrectionMetricsEventType>();
    const hasCorrection = Array.from(jobTypes).some((type) =>
      MATERIAL_CORRECTION_EVENTS.has(type)
    );
    const hasQuickValidation = !hasCorrection
      ? Array.from(jobTypes).some((type) => QUICK_VALIDATION_EVENTS.has(type))
      : false;

    if (hasCorrection) {
      correctedJobs += 1;
      levelEntry.correctedJobs += 1;
    } else if (hasQuickValidation) {
      quicklyValidatedJobs += 1;
      levelEntry.quicklyValidatedJobs += 1;
    } else {
      untouchedSuccessfulJobs += 1;
      levelEntry.untouchedSuccessfulJobs += 1;
    }

    correctionByLevel.set(levelKey, levelEntry);
  }

  const successfulJobsCount = successfulJobIds.size;
  const correctionEventCounts: TakeoffCorrectionMetricsEventCount[] = CORRECTION_EVENT_ORDER
    .map((type) => ({
      type,
      label: CORRECTION_EVENT_LABELS[type],
      count: eventCountsMap.get(type) ?? 0,
    }))
    .filter((entry) => entry.count > 0);
  const correctionKpis: TakeoffCorrectionMetricsKpis = {
    totalEvents: correctionEventCounts.reduce((sum, entry) => sum + entry.count, 0),
    correctedJobs,
    quicklyValidatedJobs,
    untouchedSuccessfulJobs,
    correctionRate:
      successfulJobsCount > 0
        ? Number(((correctedJobs / successfulJobsCount) * 100).toFixed(1))
        : 0,
    quickValidationRate:
      successfulJobsCount > 0
        ? Number(((quicklyValidatedJobs / successfulJobsCount) * 100).toFixed(1))
        : 0,
  };
  const correctionsByLevel: TakeoffCorrectionMetricsByLevel[] = Array.from(
    correctionByLevel.entries()
  )
    .map(([level, data]) => ({
      level,
      correctedJobs: data.correctedJobs,
      quicklyValidatedJobs: data.quicklyValidatedJobs,
      untouchedSuccessfulJobs: data.untouchedSuccessfulJobs,
      correctionRate:
        data.successfulJobs > 0
          ? Number(((data.correctedJobs / data.successfulJobs) * 100).toFixed(1))
          : 0,
      quickValidationRate:
        data.successfulJobs > 0
          ? Number(((data.quicklyValidatedJobs / data.successfulJobs) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => a.level.localeCompare(b.level));
  const corrections: TakeoffCorrectionMetrics = {
    kpis: correctionKpis,
    eventCounts: correctionEventCounts,
    byLevel: correctionsByLevel,
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
    corrections,
    trend: trendBuckets,
    costByLevel,
    tokenBreakdown,
    topErrors,
    reliability,
    recentJobs,
  };
}

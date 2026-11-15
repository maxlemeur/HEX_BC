import { badRequest } from "@/lib/estimates/errors";
import {
  TAKEOFF_LEVELS,
  TAKEOFF_METRICS_PERIODS,
  type TakeoffCorrectionMetrics,
  type TakeoffCorrectionMetricsByLevel,
  type TakeoffCorrectionMetricsEventCount,
  type TakeoffCorrectionMetricsEventType,
  type TakeoffCorrectionMetricsKpis,
  type TakeoffAppliedScoreCalibration,
  type TakeoffLevel,
  type TakeoffMetricsCostByLevel,
  type TakeoffMetricsErrorEntry,
  type TakeoffMetricsKpis,
  type TakeoffMetricsPeriod,
  type TakeoffMetricsRecentJob,
  type TakeoffMetricsReliability,
  type TakeoffMetricsTokenBreakdown,
  type TakeoffMetricsTrendPoint,
} from "@/lib/takeoff/types";
import {
  TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE,
  TAKEOFF_HIGH_SCORE_RATE_NOTE,
  TAKEOFF_HIGH_SCORE_THRESHOLD,
  type TakeoffMetricsPilotStatsPayload,
  type TakeoffPilotGoNoGo,
  type TakeoffPilotGoNoGoCriterion,
  type TakeoffPilotGoNoGoCriterionKey,
  type TakeoffPilotGoNoGoStatus,
  type TakeoffPilotMetrics,
  type TakeoffPilotWeeklySnapshot,
} from "@/lib/takeoff/pilot-metrics";

import {
  CORRECTION_EVENT_LABELS,
  CORRECTION_EVENT_ORDER,
  formatPilotCost,
  formatPilotCount,
  formatPilotDuration,
  formatPilotPercent,
  getPilotMinVolumeJobs,
  getTrendWindowStart,
  isMaterialItemCorrection,
  mapAuditLogToCorrectionEventType,
  MATERIAL_CORRECTION_EVENTS,
  PILOT_GO_NO_GO_MAX_AVG_COST_CENTS,
  PILOT_GO_NO_GO_MAX_AVG_DURATION_MS,
  PILOT_GO_NO_GO_MAX_CORRECTION_RATE,
  PILOT_GO_NO_GO_MIN_SATISFACTION_RATE,
  PILOT_SATISFACTION_DEFINITION,
  QUICK_VALIDATION_EVENTS,
  readAuditItemId,
  TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE,
} from "@/lib/takeoff/stats-corrections";
import {
  buildRuleForcingStats,
  type RuleForcingConsumptionRow,
  type RuleForcingItemRow,
} from "@/lib/takeoff/stats-forcing";

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

type WeeklyPilotAccumulator = {
  key: string;
  label: string;
  totalJobs: number;
  successfulJobs: number;
  totalCostCents: number;
  costCount: number;
  durationTotalMs: number;
  durationCount: number;
  correctedJobs: number;
  quicklyValidatedJobs: number;
  untouchedSuccessfulJobs: number;
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
  id?: string;
  job_id: string;
  confidence?: number | null;
  evidence?: string | null;
  source_page?: number | null;
  is_excluded?: boolean;
};

export type TakeoffMetricsAuditLogRow = {
  id?: string;
  record_id: string;
  action: string;
  created_at: string;
  after_data: unknown;
};

/** TI-686 D10: a line of an applied job, with its frozen rule results (stats-forcing.ts). */
export type TakeoffMetricsRuleForcingItemRow = RuleForcingItemRow;

/** TI-686 D10 (H11): an override consumed by an application, as an administrator reads it. */
export type TakeoffMetricsOverrideConsumptionRow = RuleForcingConsumptionRow;

export type ParsedTakeoffMetricsQuery = {
  period: TakeoffMetricsPeriod;
  level: TakeoffLevel | null;
  days: number;
  cutoff: string;
};

export type BuildTakeoffMetricsStatsPayloadInput = {
  tenantId: string;
  killSwitchEnabled: boolean;
  period: TakeoffMetricsPeriod;
  jobs: TakeoffMetricsJobRow[];
  runMetrics: TakeoffMetricsRunMetricRow[];
  results: TakeoffMetricsResultRow[];
  items: TakeoffMetricsItemRow[];
  /** The correction audits, and the override audits (takeoff.apply.override) of the jobs read. */
  auditLogs?: TakeoffMetricsAuditLogRow[];
  /** The lines of the applied jobs read, with their rule results (TI-686 D10). */
  ruleForcingItems?: TakeoffMetricsRuleForcingItemRow[];
  /** The overrides consumed by those jobs (TI-686 D10). */
  overrideConsumptions?: TakeoffMetricsOverrideConsumptionRow[];
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
        "Paramètre level invalide. Valeurs autorisees: A, B, C.",
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

function buildWeeklyPilotBuckets(
  period: TakeoffMetricsPeriod,
  days: number,
  now: Date
): WeeklyPilotAccumulator[] {
  const weekCount = Math.max(1, Math.ceil(days / 7));
  const oldestBucketStart = getTrendWindowStart(period, days, now);

  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = new Date(oldestBucketStart);
    weekStart.setDate(weekStart.getDate() + index * 7);

    return {
      key: weekStart.toISOString().slice(0, 10),
      label: weekStart.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
      }),
      totalJobs: 0,
      successfulJobs: 0,
      totalCostCents: 0,
      costCount: 0,
      durationTotalMs: 0,
      durationCount: 0,
      correctedJobs: 0,
      quicklyValidatedJobs: 0,
      untouchedSuccessfulJobs: 0,
    };
  });
}

function toWeeklyPilotBucketKey(
  dateStr: string,
  buckets: WeeklyPilotAccumulator[]
): string | null {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return null;
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

function buildGoNoGoCriterion(input: {
  key: TakeoffPilotGoNoGoCriterionKey;
  label: string;
  targetLabel: string;
  actualLabel: string;
  note?: string;
  passed: boolean;
  status?: TakeoffPilotGoNoGoCriterion["status"];
}): TakeoffPilotGoNoGoCriterion {
  return {
    ...input,
    status: input.status ?? (input.passed ? "pass" : "fail"),
  };
}

type ScopedTakeoffMetricsRows = {
  jobById: Map<string, TakeoffMetricsJobRow>;
  runMetrics: TakeoffMetricsRunMetricRow[];
  results: TakeoffMetricsResultRow[];
  items: TakeoffMetricsItemRow[];
  auditLogs: TakeoffMetricsAuditLogRow[];
  ruleForcingItems: TakeoffMetricsRuleForcingItemRow[];
  overrideConsumptions: TakeoffMetricsOverrideConsumptionRow[];
};

/** What the go/no-go measures: the jobs with a cost, and the successful jobs with a duration. */
type PilotMeasurements = {
  totalJobs: number;
  hasMeasuredCost: boolean;
  avgMeasuredCostCentsPerJob: number;
  hasMeasuredDuration: boolean;
  avgDurationMs: number;
};

type CorrectionAuditSummary = {
  eventCountsByType: Map<TakeoffCorrectionMetricsEventType, number>;
  eventTypesByJob: Map<string, Set<TakeoffCorrectionMetricsEventType>>;
  materiallyCorrectedItemIds: Set<string>;
};

type JobCorrectionOutcome = "corrected" | "quicklyValidated" | "untouched";

type CorrectionOutcomeCounts = {
  correctedJobs: number;
  quicklyValidatedJobs: number;
  untouchedSuccessfulJobs: number;
};

type LevelCorrectionAccumulator = CorrectionOutcomeCounts & {
  successfulJobs: number;
};

/** A rate in percent with one decimal, and 0 without any total (stats-forcing.ts's `rate` gives null). */
function percentRateOrZero(count: number, total: number): number {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
}

/** Keeps only the rows of the jobs read, so that another tenant's or period's rows never count. */
function scopeRowsToJobs(input: BuildTakeoffMetricsStatsPayloadInput): ScopedTakeoffMetricsRows {
  const jobById = new Map(input.jobs.map((job) => [job.id, job] as const));

  return {
    jobById,
    runMetrics: input.runMetrics.filter((metric) => jobById.has(metric.job_id)),
    results: input.results.filter((result) => jobById.has(result.job_id)),
    items: input.items.filter((item) => jobById.has(item.job_id)),
    auditLogs: (input.auditLogs ?? []).filter((auditLog) =>
      jobById.has(auditLog.record_id)
    ),
    ruleForcingItems: (input.ruleForcingItems ?? []).filter((item) => jobById.has(item.job_id)),
    overrideConsumptions: (input.overrideConsumptions ?? []).filter((consumption) =>
      jobById.has(consumption.job_id)
    ),
  };
}

function countItemsByJob(items: TakeoffMetricsItemRow[]): Map<string, number> {
  const itemCountByJob = new Map<string, number>();
  for (const item of items) {
    itemCountByJob.set(item.job_id, (itemCountByJob.get(item.job_id) ?? 0) + 1);
  }
  return itemCountByJob;
}

function readConfidenceByJobId(results: TakeoffMetricsResultRow[]): Map<string, number> {
  const confidenceByJobId = new Map<string, number>();
  for (const result of results) {
    if (result.confidence != null) {
      confidenceByJobId.set(result.job_id, result.confidence);
    }
  }
  return confidenceByJobId;
}

function buildJobKpis(
  jobs: TakeoffMetricsJobRow[],
  itemCountByJob: Map<string, number>,
  confidenceByJobId: Map<string, number>
): TakeoffMetricsKpis {
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
  const totalItems = Array.from(itemCountByJob.values()).reduce(
    (sum, count) => sum + count,
    0
  );
  const confidenceValues = Array.from(confidenceByJobId.values());

  return {
    totalJobs,
    completedJobs,
    failedJobs,
    canceledJobs,
    appliedJobs,
    successRate: percentRateOrZero(completedJobs, terminalJobs),
    avgDurationMs: durationCount > 0 ? Math.round(totalDurationMs / durationCount) : 0,
    totalCostCents,
    avgCostCentsPerJob: totalJobs > 0 ? Math.round(totalCostCents / totalJobs) : 0,
    avgConfidence:
      confidenceValues.length > 0
        ? Number(
            (
              confidenceValues.reduce((sum, confidence) => sum + confidence, 0) /
              confidenceValues.length
            ).toFixed(3)
          )
        : 0,
    avgItemsPerJob: totalJobs > 0 ? Number((totalItems / totalJobs).toFixed(2)) : 0,
  };
}

/** Reads the correction events per job, and the lines of applied jobs corrected materially. */
function readCorrectionAudits(
  auditLogs: TakeoffMetricsAuditLogRow[],
  appliedJobIds: Set<string>
): CorrectionAuditSummary {
  const eventCountsByType = new Map<TakeoffCorrectionMetricsEventType, number>();
  const eventTypesByJob = new Map<string, Set<TakeoffCorrectionMetricsEventType>>();
  const materiallyCorrectedItemIds = new Set<string>();

  for (const auditLog of auditLogs) {
    const itemId = readAuditItemId(auditLog);
    if (
      appliedJobIds.has(auditLog.record_id) &&
      itemId &&
      isMaterialItemCorrection(auditLog)
    ) {
      materiallyCorrectedItemIds.add(itemId);
    }
    const eventType = mapAuditLogToCorrectionEventType(auditLog);
    if (!eventType) {
      continue;
    }
    eventCountsByType.set(eventType, (eventCountsByType.get(eventType) ?? 0) + 1);
    const jobEventTypes =
      eventTypesByJob.get(auditLog.record_id) ?? new Set<TakeoffCorrectionMetricsEventType>();
    jobEventTypes.add(eventType);
    eventTypesByJob.set(auditLog.record_id, jobEventTypes);
  }

  return { eventCountsByType, eventTypesByJob, materiallyCorrectedItemIds };
}

/** A material correction wins over a quick validation; a job with neither is untouched. */
function classifyJobCorrection(
  jobEventTypes: Set<TakeoffCorrectionMetricsEventType> | undefined
): JobCorrectionOutcome {
  const eventTypes = Array.from(jobEventTypes ?? []);
  if (eventTypes.some((type) => MATERIAL_CORRECTION_EVENTS.has(type))) {
    return "corrected";
  }
  return eventTypes.some((type) => QUICK_VALIDATION_EVENTS.has(type))
    ? "quicklyValidated"
    : "untouched";
}

function countCorrectionOutcome(
  counts: CorrectionOutcomeCounts,
  outcome: JobCorrectionOutcome
): void {
  if (outcome === "corrected") {
    counts.correctedJobs += 1;
  } else if (outcome === "quicklyValidated") {
    counts.quicklyValidatedJobs += 1;
  } else {
    counts.untouchedSuccessfulJobs += 1;
  }
}

function buildCorrectionMetrics(
  jobs: TakeoffMetricsJobRow[],
  successfulJobIds: Set<string>,
  correctionAudits: CorrectionAuditSummary
): TakeoffCorrectionMetrics {
  const totals: CorrectionOutcomeCounts = {
    correctedJobs: 0,
    quicklyValidatedJobs: 0,
    untouchedSuccessfulJobs: 0,
  };
  const correctionByLevel = new Map<string, LevelCorrectionAccumulator>();

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

    const outcome = classifyJobCorrection(correctionAudits.eventTypesByJob.get(job.id));
    countCorrectionOutcome(totals, outcome);
    countCorrectionOutcome(levelEntry, outcome);

    correctionByLevel.set(levelKey, levelEntry);
  }

  const successfulJobsCount = successfulJobIds.size;
  const eventCounts: TakeoffCorrectionMetricsEventCount[] = CORRECTION_EVENT_ORDER
    .map((type) => ({
      type,
      label: CORRECTION_EVENT_LABELS[type],
      count: correctionAudits.eventCountsByType.get(type) ?? 0,
    }))
    .filter((entry) => entry.count > 0);
  const kpis: TakeoffCorrectionMetricsKpis = {
    totalEvents: eventCounts.reduce((sum, entry) => sum + entry.count, 0),
    correctedJobs: totals.correctedJobs,
    quicklyValidatedJobs: totals.quicklyValidatedJobs,
    untouchedSuccessfulJobs: totals.untouchedSuccessfulJobs,
    correctionRate: percentRateOrZero(totals.correctedJobs, successfulJobsCount),
    quickValidationRate: percentRateOrZero(totals.quicklyValidatedJobs, successfulJobsCount),
  };
  const byLevel: TakeoffCorrectionMetricsByLevel[] = Array.from(correctionByLevel.entries())
    .map(([level, data]) => ({
      level,
      correctedJobs: data.correctedJobs,
      quicklyValidatedJobs: data.quicklyValidatedJobs,
      untouchedSuccessfulJobs: data.untouchedSuccessfulJobs,
      correctionRate: percentRateOrZero(data.correctedJobs, data.successfulJobs),
      quickValidationRate: percentRateOrZero(data.quicklyValidatedJobs, data.successfulJobs),
    }))
    .sort((a, b) => a.level.localeCompare(b.level));

  return { kpis, eventCounts, byLevel };
}

function buildAppliedScoreCalibration(input: {
  items: TakeoffMetricsItemRow[];
  jobById: Map<string, TakeoffMetricsJobRow>;
  successfulJobIds: Set<string>;
  appliedJobIds: Set<string>;
  materiallyCorrectedItemIds: Set<string>;
}): TakeoffAppliedScoreCalibration {
  const { items, jobById, successfulJobIds, appliedJobIds, materiallyCorrectedItemIds } = input;
  const successfulItems = items.filter((item) => successfulJobIds.has(item.job_id));
  const appliedItems = items.filter((item) => appliedJobIds.has(item.job_id));
  const appliedScoredItems = appliedItems.filter(
    (item) => typeof item.confidence === "number"
  );
  const appliedHighScoreItems = appliedScoredItems.filter(
    (item) => (item.confidence ?? 0) >= TAKEOFF_HIGH_SCORE_THRESHOLD
  );
  const appliedHighScoreMateriallyCorrectedItems = appliedHighScoreItems.filter(
    (item) => item.id && materiallyCorrectedItemIds.has(item.id)
  );
  const levelCIncludedItems = successfulItems.filter(
    (item) => jobById.get(item.job_id)?.level === "C" && !item.is_excluded
  );
  const levelCLocalizedProofItems = levelCIncludedItems.filter(
    (item) =>
      Boolean(item.evidence?.trim()) &&
      typeof item.source_page === "number" &&
      item.source_page >= 1
  );

  return {
    status:
      appliedHighScoreItems.length === 0
        ? "no_data"
        : appliedHighScoreItems.length < TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE
          ? "insufficient"
          : "sufficient",
    minimumSampleSize: TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE,
    appliedScoredItems: appliedScoredItems.length,
    appliedHighScoreItems: appliedHighScoreItems.length,
    appliedHighScoreMateriallyCorrectedItems:
      appliedHighScoreMateriallyCorrectedItems.length,
    appliedHighScoreMaterialCorrectionRate: percentRateOrZero(
      appliedHighScoreMateriallyCorrectedItems.length,
      appliedHighScoreItems.length
    ),
    levelCIncludedItems: levelCIncludedItems.length,
    levelCLocalizedProofItems: levelCLocalizedProofItems.length,
    levelCLocalizedProofCoverage: percentRateOrZero(
      levelCLocalizedProofItems.length,
      levelCIncludedItems.length
    ),
  };
}

function toPilotWeeklySnapshot(bucket: WeeklyPilotAccumulator): TakeoffPilotWeeklySnapshot {
  const satisfactionNumerator =
    bucket.quicklyValidatedJobs + bucket.untouchedSuccessfulJobs;

  return {
    key: bucket.key,
    label: bucket.label,
    totalJobs: bucket.totalJobs,
    successfulJobs: bucket.successfulJobs,
    avgCostCentsPerJob:
      bucket.costCount > 0 ? Math.round(bucket.totalCostCents / bucket.costCount) : 0,
    avgDurationMs:
      bucket.durationCount > 0
        ? Math.round(bucket.durationTotalMs / bucket.durationCount)
        : 0,
    correctionRate: percentRateOrZero(bucket.correctedJobs, bucket.successfulJobs),
    satisfactionRate: percentRateOrZero(satisfactionNumerator, bucket.successfulJobs),
  };
}

function buildPilotWeeklySnapshots(input: {
  jobs: TakeoffMetricsJobRow[];
  period: TakeoffMetricsPeriod;
  days: number;
  now: Date;
  successfulJobIds: Set<string>;
  eventTypesByJob: CorrectionAuditSummary["eventTypesByJob"];
}): TakeoffPilotWeeklySnapshot[] {
  const weeklyPilotBuckets = buildWeeklyPilotBuckets(input.period, input.days, input.now);
  const weeklyPilotBucketMap = new Map(
    weeklyPilotBuckets.map((bucket) => [bucket.key, bucket] as const)
  );

  for (const job of input.jobs) {
    const weeklyBucketKey = toWeeklyPilotBucketKey(job.created_at, weeklyPilotBuckets);
    if (!weeklyBucketKey) {
      continue;
    }

    const bucket = weeklyPilotBucketMap.get(weeklyBucketKey);
    if (!bucket) {
      continue;
    }

    bucket.totalJobs += 1;
    if (job.cost_cents != null) {
      bucket.totalCostCents += job.cost_cents;
      bucket.costCount += 1;
    }

    if (!input.successfulJobIds.has(job.id)) {
      continue;
    }

    bucket.successfulJobs += 1;
    if (job.duration_ms != null) {
      bucket.durationTotalMs += job.duration_ms;
      bucket.durationCount += 1;
    }

    countCorrectionOutcome(bucket, classifyJobCorrection(input.eventTypesByJob.get(job.id)));
  }

  return weeklyPilotBuckets.map(toPilotWeeklySnapshot);
}

function measurePilotJobs(
  jobs: TakeoffMetricsJobRow[],
  kpis: TakeoffMetricsKpis
): PilotMeasurements {
  const costCount = jobs.filter((job) => job.cost_cents != null).length;
  const durationCount = jobs.filter(
    (job) =>
      (job.status === "completed" || job.status === "applied") && job.duration_ms != null
  ).length;

  return {
    totalJobs: kpis.totalJobs,
    hasMeasuredCost: costCount > 0,
    avgMeasuredCostCentsPerJob: costCount > 0 ? Math.round(kpis.totalCostCents / costCount) : 0,
    hasMeasuredDuration: durationCount > 0,
    avgDurationMs: kpis.avgDurationMs,
  };
}

function buildGoNoGoCriteria(input: {
  pilotMinVolumeJobs: number;
  measurements: PilotMeasurements;
  hasSuccessfulJobs: boolean;
  correctionRate: number;
  satisfactionRate: number;
  calibration: TakeoffAppliedScoreCalibration;
}): TakeoffPilotGoNoGoCriterion[] {
  const {
    pilotMinVolumeJobs,
    measurements,
    hasSuccessfulJobs,
    correctionRate,
    satisfactionRate,
    calibration,
  } = input;
  const { totalJobs, avgMeasuredCostCentsPerJob, avgDurationMs } = measurements;
  const hasMeasuredPilotCost = measurements.hasMeasuredCost;
  const hasMeasuredPilotDuration = measurements.hasMeasuredDuration;

  return [
    buildGoNoGoCriterion({
      key: "volume",
      label: "Volume observé",
      targetLabel: `≥ ${formatPilotCount(pilotMinVolumeJobs)} dossiers`,
      actualLabel: `${formatPilotCount(totalJobs)} dossiers`,
      passed: totalJobs >= pilotMinVolumeJobs,
    }),
    buildGoNoGoCriterion({
      key: "avg_cost",
      label: "Coût moyen",
      targetLabel: `≤ ${formatPilotCost(PILOT_GO_NO_GO_MAX_AVG_COST_CENTS)}`,
      actualLabel: hasMeasuredPilotCost ? formatPilotCost(avgMeasuredCostCentsPerJob) : "-",
      passed:
        hasMeasuredPilotCost &&
        avgMeasuredCostCentsPerJob <= PILOT_GO_NO_GO_MAX_AVG_COST_CENTS,
      status: hasMeasuredPilotCost ? undefined : "inconclusive",
    }),
    buildGoNoGoCriterion({
      key: "avg_duration",
      label: "Temps moyen",
      targetLabel: `≤ ${formatPilotDuration(PILOT_GO_NO_GO_MAX_AVG_DURATION_MS)}`,
      actualLabel: hasMeasuredPilotDuration ? formatPilotDuration(avgDurationMs) : "-",
      passed:
        hasMeasuredPilotDuration && avgDurationMs <= PILOT_GO_NO_GO_MAX_AVG_DURATION_MS,
      status: hasMeasuredPilotDuration ? undefined : "inconclusive",
    }),
    buildGoNoGoCriterion({
      key: "correction_rate",
      label: "Taux de correction",
      targetLabel: `≤ ${formatPilotPercent(PILOT_GO_NO_GO_MAX_CORRECTION_RATE)}`,
      actualLabel: hasSuccessfulJobs ? formatPilotPercent(correctionRate) : "-",
      passed:
        hasSuccessfulJobs &&
        correctionRate <= PILOT_GO_NO_GO_MAX_CORRECTION_RATE,
      status: hasSuccessfulJobs ? undefined : "inconclusive",
    }),
    buildGoNoGoCriterion({
      key: "applied_high_score_correction_rate",
      label: "Corrections malgré un score élevé",
      targetLabel: `≤ ${formatPilotPercent(TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE)} sur ≥ ${formatPilotCount(TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE)} lignes appliquées`,
      // TI-681: the sample size n is always shown; the note says how to read the rate (display only).
      actualLabel:
        calibration.status === "sufficient"
          ? `${formatPilotPercent(calibration.appliedHighScoreMaterialCorrectionRate)} sur n = ${formatPilotCount(calibration.appliedHighScoreItems)} lignes (${formatPilotCount(calibration.appliedHighScoreMateriallyCorrectedItems)} corrigée${calibration.appliedHighScoreMateriallyCorrectedItems > 1 ? "s" : ""})`
          : `n = ${formatPilotCount(calibration.appliedHighScoreItems)} ligne${calibration.appliedHighScoreItems > 1 ? "s" : ""} appliquée${calibration.appliedHighScoreItems > 1 ? "s" : ""} sur ${formatPilotCount(TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE)} requises`,
      note: calibration.status === "no_data" ? undefined : TAKEOFF_HIGH_SCORE_RATE_NOTE,
      passed:
        calibration.status === "sufficient" &&
        calibration.appliedHighScoreMaterialCorrectionRate <=
          TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE,
      status:
        calibration.status === "sufficient" ? undefined : "inconclusive",
    }),
    ...(calibration.levelCIncludedItems > 0
      ? [
          buildGoNoGoCriterion({
            key: "level_c_proof_coverage",
            label: "Preuves localisées niveau C",
            targetLabel: "100 %",
            actualLabel: `${formatPilotPercent(calibration.levelCLocalizedProofCoverage)} (${formatPilotCount(calibration.levelCLocalizedProofItems)}/${formatPilotCount(calibration.levelCIncludedItems)})`,
            passed: calibration.levelCLocalizedProofCoverage === 100,
          }),
        ]
      : []),
    buildGoNoGoCriterion({
      key: "satisfaction",
      label: "Satisfaction",
      targetLabel: `≥ ${formatPilotPercent(PILOT_GO_NO_GO_MIN_SATISFACTION_RATE)}`,
      actualLabel: hasSuccessfulJobs ? formatPilotPercent(satisfactionRate) : "-",
      passed:
        hasSuccessfulJobs && satisfactionRate >= PILOT_GO_NO_GO_MIN_SATISFACTION_RATE,
      status: hasSuccessfulJobs ? undefined : "inconclusive",
    }),
  ];
}

function decidePilotGoNoGo(input: {
  criteria: TakeoffPilotGoNoGoCriterion[];
  totalJobs: number;
  hasSuccessfulJobs: boolean;
  pilotMinVolumeJobs: number;
}): TakeoffPilotGoNoGo {
  const { criteria, totalJobs, hasSuccessfulJobs, pilotMinVolumeJobs } = input;
  const failedCriteriaCount = criteria.filter(
    (criterion) => criterion.status === "fail"
  ).length;
  const hasInconclusiveCriteria = criteria.some(
    (criterion) => criterion.status === "inconclusive"
  );
  let goNoGoStatus: TakeoffPilotGoNoGoStatus = "go";
  let goNoGoLabel = "GO";
  let goNoGoSummary =
    "Les indicateurs restent compatibles avec une poursuite du pilote pour ce client.";

  if (totalJobs === 0) {
    goNoGoStatus = "inconclusive";
    goNoGoLabel = "Inconclusif";
    goNoGoSummary =
      "Aucun dossier mesuré sur la période. Le pilote n’est pas encore concluant.";
  } else if (!hasSuccessfulJobs) {
    goNoGoStatus = "inconclusive";
    goNoGoLabel = "Inconclusif";
    goNoGoSummary =
      "Aucun dossier exploitable n’a encore abouti. Le pilote reste trop immature pour conclure.";
  } else if (hasInconclusiveCriteria) {
    goNoGoStatus = "inconclusive";
    goNoGoLabel = "Inconclusif";
    goNoGoSummary =
      "Certaines mesures pilote manquent encore. Complétez les dossiers mesurés avant de décider.";
  } else if (totalJobs < pilotMinVolumeJobs) {
    goNoGoStatus = "watch";
    goNoGoLabel = "À surveiller";
    goNoGoSummary =
      "Le volume terrain reste insuffisant pour conclure un go/no-go robuste.";
  } else if (failedCriteriaCount === 0) {
    goNoGoStatus = "go";
    goNoGoLabel = "GO";
  } else if (failedCriteriaCount === 1) {
    goNoGoStatus = "watch";
    goNoGoLabel = "À surveiller";
    goNoGoSummary =
      "Un critère pilote reste fragile. Poursuivez le pilote client avant la décision finale.";
  } else {
    goNoGoStatus = "no_go";
    goNoGoLabel = "NO-GO";
    goNoGoSummary =
      "Plusieurs critères pilote sont hors cible. La généralisation doit rester bloquée.";
  }

  return {
    status: goNoGoStatus,
    label: goNoGoLabel,
    summary: goNoGoSummary,
    criteria,
  };
}

function buildPilotMetrics(input: {
  tenantId: string;
  killSwitchEnabled: boolean;
  period: TakeoffMetricsPeriod;
  days: number;
  now: Date;
  jobs: TakeoffMetricsJobRow[];
  kpis: TakeoffMetricsKpis;
  successfulJobIds: Set<string>;
  eventTypesByJob: CorrectionAuditSummary["eventTypesByJob"];
  corrections: TakeoffCorrectionMetrics;
  calibration: TakeoffAppliedScoreCalibration;
}): TakeoffPilotMetrics {
  const { period, jobs, kpis, successfulJobIds, corrections } = input;
  const weeklySnapshots = buildPilotWeeklySnapshots({
    jobs,
    period,
    days: input.days,
    now: input.now,
    successfulJobIds,
    eventTypesByJob: input.eventTypesByJob,
  });
  const successfulJobsCount = successfulJobIds.size;
  const pilotMinVolumeJobs = getPilotMinVolumeJobs(period);
  const hasSuccessfulJobs = successfulJobsCount > 0;
  const satisfactionRate = percentRateOrZero(
    corrections.kpis.quicklyValidatedJobs + corrections.kpis.untouchedSuccessfulJobs,
    successfulJobsCount
  );
  const criteria = buildGoNoGoCriteria({
    pilotMinVolumeJobs,
    measurements: measurePilotJobs(jobs, kpis),
    hasSuccessfulJobs,
    correctionRate: corrections.kpis.correctionRate,
    satisfactionRate,
    calibration: input.calibration,
  });

  return {
    tenantId: input.tenantId,
    killSwitchFlagKey: "TAKEOFF_MODULE_ENABLED",
    killSwitchEnabled: input.killSwitchEnabled,
    killSwitchLabel: input.killSwitchEnabled ? "Pilote actif" : "Pilote coupé",
    satisfactionLabel: formatPilotPercent(satisfactionRate),
    satisfactionDefinition: PILOT_SATISFACTION_DEFINITION,
    weeklySnapshots,
    goNoGo: decidePilotGoNoGo({
      criteria,
      totalJobs: kpis.totalJobs,
      hasSuccessfulJobs,
      pilotMinVolumeJobs,
    }),
  };
}

function buildTrend(
  jobs: TakeoffMetricsJobRow[],
  period: TakeoffMetricsPeriod,
  days: number,
  now: Date
): TakeoffMetricsTrendPoint[] {
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
  return trendBuckets;
}

function buildCostByLevel(
  jobs: TakeoffMetricsJobRow[],
  runMetrics: TakeoffMetricsRunMetricRow[],
  jobById: Map<string, TakeoffMetricsJobRow>,
  itemCountByJob: Map<string, number>
): TakeoffMetricsCostByLevel[] {
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
    const entry = byLevel.get(job.level || "?");
    if (!entry) {
      continue;
    }
    entry.totalTokens +=
      (metric.input_tokens ?? 0) +
      (metric.reasoning_tokens ?? 0) +
      (metric.output_tokens ?? 0);
  }

  return Array.from(byLevel.entries())
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
      failureRate: percentRateOrZero(data.failedCount, data.jobCount),
      avgItemsPerJob:
        data.jobCount > 0
          ? Number((data.itemCount / data.jobCount).toFixed(2))
          : 0,
    }))
    .sort((a, b) => a.level.localeCompare(b.level));
}

function buildTokenBreakdown(
  runMetrics: TakeoffMetricsRunMetricRow[]
): TakeoffMetricsTokenBreakdown {
  let inputTokens = 0;
  let reasoningTokens = 0;
  let outputTokens = 0;
  for (const metric of runMetrics) {
    inputTokens += metric.input_tokens ?? 0;
    reasoningTokens += metric.reasoning_tokens ?? 0;
    outputTokens += metric.output_tokens ?? 0;
  }
  return { inputTokens, reasoningTokens, outputTokens };
}

/** The ten most frequent error codes of failed jobs, with their latest occurrence. */
function buildTopErrors(jobs: TakeoffMetricsJobRow[]): TakeoffMetricsErrorEntry[] {
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
  return Array.from(errorsByCode.entries())
    .map(([errorCode, data]) => ({
      errorCode,
      count: data.count,
      lastOccurrence: data.lastOccurrence,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function buildReliability(
  jobs: TakeoffMetricsJobRow[],
  runMetrics: TakeoffMetricsRunMetricRow[]
): TakeoffMetricsReliability {
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

  return {
    timedOutCount,
    budgetExceededCount,
    totalRunMetrics: runMetrics.length,
    retriedJobs,
    retriedThenCompleted,
    retrySuccessRate: percentRateOrZero(retriedThenCompleted, retriedJobs),
  };
}

/** The fifteen most recently created jobs. */
function buildRecentJobs(
  jobs: TakeoffMetricsJobRow[],
  confidenceByJobId: Map<string, number>
): TakeoffMetricsRecentJob[] {
  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return sortedJobs
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
}

export function buildTakeoffMetricsStatsPayload(
  input: BuildTakeoffMetricsStatsPayloadInput
): TakeoffMetricsPilotStatsPayload {
  const now = input.now ?? new Date();
  const { period, jobs } = input;
  const days = PERIOD_TO_DAYS[period];

  const scoped = scopeRowsToJobs(input);
  const itemCountByJob = countItemsByJob(scoped.items);
  const confidenceByJobId = readConfidenceByJobId(scoped.results);
  const kpis = buildJobKpis(jobs, itemCountByJob, confidenceByJobId);

  const successfulJobIds = new Set(
    jobs
      .filter((job) => job.status === "completed" || job.status === "applied")
      .map((job) => job.id)
  );
  const appliedJobIds = new Set(
    jobs.filter((job) => job.status === "applied").map((job) => job.id)
  );
  const correctionAudits = readCorrectionAudits(scoped.auditLogs, appliedJobIds);
  const corrections = buildCorrectionMetrics(jobs, successfulJobIds, correctionAudits);
  const calibration = buildAppliedScoreCalibration({
    items: scoped.items,
    jobById: scoped.jobById,
    successfulJobIds,
    appliedJobIds,
    materiallyCorrectedItemIds: correctionAudits.materiallyCorrectedItemIds,
  });

  // TI-686 D10 (H19): the false positives declared at forcing per rule, over the applied jobs read.
  const ruleForcing = buildRuleForcingStats({
    jobs,
    items: scoped.ruleForcingItems,
    overrideAudits: scoped.auditLogs.filter((auditLog) => auditLog.action === "takeoff.apply.override"),
    consumptions: scoped.overrideConsumptions,
  });

  const pilot = buildPilotMetrics({
    tenantId: input.tenantId,
    killSwitchEnabled: input.killSwitchEnabled,
    period,
    days,
    now,
    jobs,
    kpis,
    successfulJobIds,
    eventTypesByJob: correctionAudits.eventTypesByJob,
    corrections,
    calibration,
  });

  return {
    generatedAt: now.toISOString(),
    period,
    kpis,
    corrections,
    calibration,
    ruleForcing,
    pilot,
    trend: buildTrend(jobs, period, days, now),
    costByLevel: buildCostByLevel(jobs, scoped.runMetrics, scoped.jobById, itemCountByJob),
    tokenBreakdown: buildTokenBreakdown(scoped.runMetrics),
    topErrors: buildTopErrors(jobs),
    reliability: buildReliability(jobs, scoped.runMetrics),
    recentJobs: buildRecentJobs(jobs, confidenceByJobId),
  };
}

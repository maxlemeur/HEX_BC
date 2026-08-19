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
  tenantId: string;
  killSwitchEnabled: boolean;
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
  passed: boolean;
  status?: TakeoffPilotGoNoGoCriterion["status"];
}): TakeoffPilotGoNoGoCriterion {
  return {
    ...input,
    status: input.status ?? (input.passed ? "pass" : "fail"),
  };
}

export function buildTakeoffMetricsStatsPayload(
  input: BuildTakeoffMetricsStatsPayloadInput
): TakeoffMetricsPilotStatsPayload {
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
  let costCount = 0;

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
      costCount += 1;
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
  const avgMeasuredCostCentsPerJob =
    costCount > 0 ? Math.round(totalCostCents / costCount) : 0;
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
  const appliedJobIds = new Set(
    jobs.filter((job) => job.status === "applied").map((job) => job.id)
  );
  const eventCountsMap = new Map<TakeoffCorrectionMetricsEventType, number>();
  const jobEventTypes = new Map<string, Set<TakeoffCorrectionMetricsEventType>>();
  const materiallyCorrectedItemIds = new Set<string>();

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

  const successfulItems = items.filter((item) =>
    successfulJobIds.has(item.job_id)
  );
  const appliedItems = items.filter((item) => appliedJobIds.has(item.job_id));
  const appliedScoredItems = appliedItems.filter(
    (item) => typeof item.confidence === "number"
  );
  const appliedHighScoreItems = appliedScoredItems.filter(
    (item) =>
      (item.confidence ?? 0) >= TAKEOFF_HIGH_SCORE_THRESHOLD
  );
  const appliedHighScoreMateriallyCorrectedItems =
    appliedHighScoreItems.filter(
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
  const calibration: TakeoffAppliedScoreCalibration = {
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
    appliedHighScoreMaterialCorrectionRate:
      appliedHighScoreItems.length > 0
        ? Number(
            (
              (appliedHighScoreMateriallyCorrectedItems.length /
                appliedHighScoreItems.length) *
              100
            ).toFixed(1)
          )
        : 0,
    levelCIncludedItems: levelCIncludedItems.length,
    levelCLocalizedProofItems: levelCLocalizedProofItems.length,
    levelCLocalizedProofCoverage:
      levelCIncludedItems.length > 0
        ? Number(
            (
              (levelCLocalizedProofItems.length / levelCIncludedItems.length) *
              100
            ).toFixed(1)
          )
        : 0,
  };

  const weeklyPilotBuckets = buildWeeklyPilotBuckets(period, days, now);
  const weeklyPilotBucketMap = new Map(
    weeklyPilotBuckets.map((bucket) => [bucket.key, bucket] as const)
  );

  for (const job of jobs) {
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

    if (!successfulJobIds.has(job.id)) {
      continue;
    }

    bucket.successfulJobs += 1;
    if (job.duration_ms != null) {
      bucket.durationTotalMs += job.duration_ms;
      bucket.durationCount += 1;
    }

    const jobTypes = jobEventTypes.get(job.id) ?? new Set<TakeoffCorrectionMetricsEventType>();
    const hasCorrection = Array.from(jobTypes).some((type) =>
      MATERIAL_CORRECTION_EVENTS.has(type)
    );
    const hasQuickValidation = !hasCorrection
      ? Array.from(jobTypes).some((type) => QUICK_VALIDATION_EVENTS.has(type))
      : false;

    if (hasCorrection) {
      bucket.correctedJobs += 1;
    } else if (hasQuickValidation) {
      bucket.quicklyValidatedJobs += 1;
    } else {
      bucket.untouchedSuccessfulJobs += 1;
    }
  }

  const weeklySnapshots: TakeoffPilotWeeklySnapshot[] = weeklyPilotBuckets.map((bucket) => {
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
      correctionRate:
        bucket.successfulJobs > 0
          ? Number(((bucket.correctedJobs / bucket.successfulJobs) * 100).toFixed(1))
          : 0,
      satisfactionRate:
        bucket.successfulJobs > 0
          ? Number(((satisfactionNumerator / bucket.successfulJobs) * 100).toFixed(1))
          : 0,
    };
  });

  const pilotMinVolumeJobs = getPilotMinVolumeJobs(period);
  const hasSuccessfulJobs = successfulJobsCount > 0;
  const hasMeasuredPilotCost = costCount > 0;
  const hasMeasuredPilotDuration = durationCount > 0;
  const satisfactionRate =
    hasSuccessfulJobs
      ? Number(
          (
            ((quicklyValidatedJobs + untouchedSuccessfulJobs) / successfulJobsCount) *
            100
          ).toFixed(1)
        )
      : 0;

  const goNoGoCriteria: TakeoffPilotGoNoGoCriterion[] = [
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
      actualLabel: hasSuccessfulJobs ? formatPilotPercent(correctionKpis.correctionRate) : "-",
      passed:
        hasSuccessfulJobs &&
        correctionKpis.correctionRate <= PILOT_GO_NO_GO_MAX_CORRECTION_RATE,
      status: hasSuccessfulJobs ? undefined : "inconclusive",
    }),
    buildGoNoGoCriterion({
      key: "applied_high_score_correction_rate",
      label: "Corrections malgré un score élevé",
      targetLabel: `≤ ${formatPilotPercent(TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE)} sur ≥ ${formatPilotCount(TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE)} lignes appliquées`,
      actualLabel:
        calibration.status === "sufficient"
          ? `${formatPilotPercent(calibration.appliedHighScoreMaterialCorrectionRate)} (${formatPilotCount(calibration.appliedHighScoreMateriallyCorrectedItems)}/${formatPilotCount(calibration.appliedHighScoreItems)})`
          : `${formatPilotCount(calibration.appliedHighScoreItems)}/${formatPilotCount(TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE)} lignes appliquées`,
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

  const failedCriteriaCount = goNoGoCriteria.filter(
    (criterion) => criterion.status === "fail"
  ).length;
  const hasInconclusiveCriteria = goNoGoCriteria.some(
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

  const goNoGo: TakeoffPilotGoNoGo = {
    status: goNoGoStatus,
    label: goNoGoLabel,
    summary: goNoGoSummary,
    criteria: goNoGoCriteria,
  };

  const pilot: TakeoffPilotMetrics = {
    tenantId: input.tenantId,
    killSwitchFlagKey: "TAKEOFF_MODULE_ENABLED",
    killSwitchEnabled: input.killSwitchEnabled,
    killSwitchLabel: input.killSwitchEnabled ? "Pilote actif" : "Pilote coupé",
    satisfactionLabel: formatPilotPercent(satisfactionRate),
    satisfactionDefinition: PILOT_SATISFACTION_DEFINITION,
    weeklySnapshots,
    goNoGo,
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
    calibration,
    pilot,
    trend: trendBuckets,
    costByLevel,
    tokenBreakdown,
    topErrors,
    reliability,
    recentJobs,
  };
}

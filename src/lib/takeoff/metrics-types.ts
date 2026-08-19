export const TAKEOFF_METRICS_PERIODS = ["7d", "30d", "90d"] as const;
export type TakeoffMetricsPeriod = (typeof TAKEOFF_METRICS_PERIODS)[number];

export type TakeoffMetricsKpis = {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  canceledJobs: number;
  appliedJobs: number;
  successRate: number;
  avgDurationMs: number;
  totalCostCents: number;
  avgCostCentsPerJob: number;
  avgConfidence: number;
  avgItemsPerJob: number;
};

export type TakeoffMetricsTrendPoint = {
  key: string;
  label: string;
  createdCount: number;
  failedCount: number;
};

export type TakeoffMetricsCostByLevel = {
  level: string;
  totalCostCents: number;
  totalTokens: number;
  jobCount: number;
  failedCount: number;
  avgDurationMs: number;
  failureRate: number;
  avgItemsPerJob: number;
};

export type TakeoffMetricsTokenBreakdown = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
};

export type TakeoffMetricsErrorEntry = {
  errorCode: string;
  count: number;
  lastOccurrence: string;
};

export type TakeoffMetricsReliability = {
  timedOutCount: number;
  budgetExceededCount: number;
  totalRunMetrics: number;
  retriedJobs: number;
  retriedThenCompleted: number;
  retrySuccessRate: number;
};

export type TakeoffMetricsRecentJob = {
  id: string;
  status: string;
  level: string;
  model: string | null;
  durationMs: number | null;
  costCents: number | null;
  confidence: number | null;
  errorCode: string | null;
  createdAt: string;
};

export type TakeoffCorrectionMetricsEventType =
  | "item_excluded"
  | "designation_changed"
  | "quantity_changed"
  | "unit_changed"
  | "manual_verification"
  | "dpgf_keep_dpgf"
  | "dpgf_keep_takeoff"
  | "dpgf_manual_fix"
  | "dpgf_out_of_scope";

export type TakeoffCorrectionMetricsKpis = {
  totalEvents: number;
  correctedJobs: number;
  quicklyValidatedJobs: number;
  untouchedSuccessfulJobs: number;
  correctionRate: number;
  quickValidationRate: number;
};

export type TakeoffCorrectionMetricsEventCount = {
  type: TakeoffCorrectionMetricsEventType;
  label: string;
  count: number;
};

export type TakeoffCorrectionMetricsByLevel = {
  level: string;
  correctedJobs: number;
  quicklyValidatedJobs: number;
  untouchedSuccessfulJobs: number;
  correctionRate: number;
  quickValidationRate: number;
};

export type TakeoffCorrectionMetrics = {
  kpis: TakeoffCorrectionMetricsKpis;
  eventCounts: TakeoffCorrectionMetricsEventCount[];
  byLevel: TakeoffCorrectionMetricsByLevel[];
};

export type TakeoffAppliedScoreCalibrationStatus =
  | "no_data"
  | "insufficient"
  | "sufficient";

export type TakeoffAppliedScoreCalibration = {
  status: TakeoffAppliedScoreCalibrationStatus;
  minimumSampleSize: number;
  appliedScoredItems: number;
  appliedHighScoreItems: number;
  appliedHighScoreMateriallyCorrectedItems: number;
  appliedHighScoreMaterialCorrectionRate: number;
  levelCIncludedItems: number;
  levelCLocalizedProofItems: number;
  levelCLocalizedProofCoverage: number;
};

export type TakeoffMetricsStatsPayload = {
  generatedAt: string;
  period: TakeoffMetricsPeriod;
  kpis: TakeoffMetricsKpis;
  corrections: TakeoffCorrectionMetrics;
  calibration: TakeoffAppliedScoreCalibration;
  trend: TakeoffMetricsTrendPoint[];
  costByLevel: TakeoffMetricsCostByLevel[];
  tokenBreakdown: TakeoffMetricsTokenBreakdown;
  topErrors: TakeoffMetricsErrorEntry[];
  reliability: TakeoffMetricsReliability;
  recentJobs: TakeoffMetricsRecentJob[];
};

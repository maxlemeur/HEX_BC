import type { TakeoffRuleId } from "@/lib/takeoff/rules/types";

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

/** TI-686 D10 (H19): one rule's failures on the applied lines, and the false positives declared at forcing. */
export type TakeoffRuleForcingRow = {
  rule: TakeoffRuleId;
  label: string;
  /**
   * N: the applied lines (not excluded) the rule fails, its failures left out by their partners aside; a failure a
   * verification (V) accepted is counted, only n leaves it out.
   */
  failedLines: number;
  /** The forced lines whose failure of this rule blocked them (a quantity warning never does, TI-681). */
  forcedLines: number;
  /** n: those the administrator declared a false positive of this rule when forcing them (never a V). */
  falsePositiveLines: number;
  /** n / N in percent, one decimal; null when N = 0 or when the rule cannot block (canBlock false). */
  falsePositiveRate: number | null;
  /**
   * Whether a failure of the rule blocks a line, so that it can be forced: false for a rule whose failures are all
   * quantity warnings (TI-681) and that forced no line on the period; it has no rate (« Sans objet »).
   */
  canBlock: boolean;
};

/** How to read the per-rule rates (TI-686 D10): what n and N count, shown above the table. */
export const TAKEOFF_RULE_FORCING_GUIDE = "Faux positifs déclarés par un administrateur en forçant une ligne bloquée (n), "
  + "sur les lignes appliquées de la période où la règle échoue (N), y compris celles dont une vérification a accepté "
  + "l’échec : une vérification ne compte jamais comme faux positif. Une règle qui ne fait qu’avertir sur la quantité ne "
  + "bloque jamais l’application : son taux est sans objet.";

/** How to read a rule's observed rate (TI-686 D10): shown under the table, never part of a decision. */
export const TAKEOFF_RULE_FORCING_RATE_NOTE =
  "Taux observé sur l’effectif affiché : un indicateur, pas une borne de fiabilité.";

export type TakeoffRuleForcingMetrics = {
  /** Every line of the overrides consumed on the period, whatever kept it blocked. */
  forcedLines: number;
  rows: TakeoffRuleForcingRow[];
};

export type TakeoffMetricsStatsPayload = {
  generatedAt: string;
  period: TakeoffMetricsPeriod;
  kpis: TakeoffMetricsKpis;
  corrections: TakeoffCorrectionMetrics;
  calibration: TakeoffAppliedScoreCalibration;
  ruleForcing: TakeoffRuleForcingMetrics;
  trend: TakeoffMetricsTrendPoint[];
  costByLevel: TakeoffMetricsCostByLevel[];
  tokenBreakdown: TakeoffMetricsTokenBreakdown;
  topErrors: TakeoffMetricsErrorEntry[];
  reliability: TakeoffMetricsReliability;
  recentJobs: TakeoffMetricsRecentJob[];
};

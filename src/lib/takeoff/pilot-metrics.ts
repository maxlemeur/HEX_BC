import type { TakeoffMetricsStatsPayload } from "@/lib/takeoff/types";

export const TAKEOFF_HIGH_SCORE_THRESHOLD = 0.8;
export const TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE = 5;
/**
 * TI-681 (decision D18e): the high-score correction rate is observed over every plan together; the GO reads it as is,
 * but the display must not present it as a reliability bound. Shown only when there is a rate (n > 0).
 */
export const TAKEOFF_HIGH_SCORE_RATE_NOTE =
  "Taux observé, tous plans confondus : indicateur, pas une borne de fiabilité.";

export type TakeoffPilotWeeklySnapshot = {
  key: string;
  label: string;
  totalJobs: number;
  successfulJobs: number;
  avgCostCentsPerJob: number;
  avgDurationMs: number;
  correctionRate: number;
  satisfactionRate: number;
};

export type TakeoffPilotGoNoGoCriterionKey =
  | "volume"
  | "avg_cost"
  | "avg_duration"
  | "correction_rate"
  | "applied_high_score_correction_rate"
  | "level_c_proof_coverage"
  | "satisfaction";

export type TakeoffPilotGoNoGoCriterion = {
  key: TakeoffPilotGoNoGoCriterionKey;
  label: string;
  targetLabel: string;
  actualLabel: string;
  /** How to read the observed value, shown under the criterion; never part of the decision. */
  note?: string;
  passed: boolean;
  status: "pass" | "fail" | "inconclusive";
};

export type TakeoffPilotGoNoGoStatus = "go" | "watch" | "no_go" | "inconclusive";

export type TakeoffPilotGoNoGo = {
  status: TakeoffPilotGoNoGoStatus;
  label: string;
  summary: string;
  criteria: TakeoffPilotGoNoGoCriterion[];
};

export type TakeoffPilotMetrics = {
  tenantId: string;
  killSwitchFlagKey: string;
  killSwitchEnabled: boolean;
  killSwitchLabel: string;
  satisfactionLabel: string;
  satisfactionDefinition: string;
  weeklySnapshots: TakeoffPilotWeeklySnapshot[];
  goNoGo: TakeoffPilotGoNoGo;
};

export type TakeoffMetricsPilotStatsPayload = TakeoffMetricsStatsPayload & {
  pilot: TakeoffPilotMetrics;
};

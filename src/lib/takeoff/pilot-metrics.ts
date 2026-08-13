import type { TakeoffMetricsStatsPayload } from "@/lib/takeoff/types";

export const TAKEOFF_HIGH_SCORE_THRESHOLD = 0.8;
export const TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE = 5;

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

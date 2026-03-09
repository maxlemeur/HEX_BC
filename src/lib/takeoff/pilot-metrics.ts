import type { TakeoffMetricsStatsPayload } from "@/lib/takeoff/types";

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
  | "satisfaction";

export type TakeoffPilotGoNoGoCriterion = {
  key: TakeoffPilotGoNoGoCriterionKey;
  label: string;
  targetLabel: string;
  actualLabel: string;
  passed: boolean;
};

export type TakeoffPilotGoNoGoStatus = "go" | "watch" | "no_go";

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

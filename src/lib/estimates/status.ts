import type { Database } from "@/types/database";

export type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

export const ESTIMATE_STATUS_VALUES = [
  "draft",
  "sending",
  "sent",
  "accepted",
  "archived",
] as const satisfies readonly EstimateStatus[];

const ESTIMATE_STATUS_SET = new Set<string>(ESTIMATE_STATUS_VALUES);

export function isEstimateStatus(value: string): value is EstimateStatus {
  return ESTIMATE_STATUS_SET.has(value);
}

/**
 * Leaf module: takeoff enum constants shared by schemas, types and routes.
 * Keep it import-free so `schemas.ts` can validate against the canonical
 * value lists without creating a runtime cycle through `types.ts`.
 */
export const TAKEOFF_LEVELS = ["A", "B", "C"] as const;
export type TakeoffLevel = (typeof TAKEOFF_LEVELS)[number];

export const TAKEOFF_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "canceled",
  "applied",
] as const;
export type TakeoffJobStatus = (typeof TAKEOFF_JOB_STATUSES)[number];

export const TAKEOFF_JOB_LIST_PERIODS = ["7d", "30d", "90d"] as const;
export type TakeoffJobListPeriod = (typeof TAKEOFF_JOB_LIST_PERIODS)[number];

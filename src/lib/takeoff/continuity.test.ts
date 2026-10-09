import { describe, expect, it } from "vitest";

import { buildTakeoffContinuitySnapshot } from "@/lib/takeoff/continuity";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

function makeJob(
  overrides?: Partial<TakeoffActivityCenterJobRow>
): TakeoffActivityCenterJobRow {
  return {
    jobId: "job-1",
    estimateVersionId: "version-1",
    versionLabel: "V1",
    lotLabel: null,
    planSetLabel: "Plans principaux",
    levelLabel: "Standard",
    processingStrategy: "sync",
    providerBatchState: null,
    providerBatchUpdatedAt: null,
    providerReconcileDueAt: null,
    providerReconcileLeaseExpiresAt: null,
    statusLabel: "Analyse terminée",
    statusRaw: "completed",
    technicalStatusRaw: "completed",
    operatorState: "none",
    operatorStateLabel: null,
    canReconcile: false,
    canCancel: false,
    canResubmit: false,
    itemCount: 12,
    coveragePercent: 86,
    exceptionCount: 0,
    confidenceLabel: "Élevée",
    appliedCount: 1,
    createdAt: "2026-03-11T10:00:00.000Z",
    carriedOverFrom: null,
    neverApplied: false,
    retryCount: 0,
    ...overrides,
  };
}

describe("buildTakeoffContinuitySnapshot", () => {

  it("keeps the latest status separate from older waiting or failed history", () => {
    const snapshot = buildTakeoffContinuitySnapshot({
      jobs: [
        makeJob({
          jobId: "job-completed",
          versionLabel: "V5",
          statusLabel: "Analyse terminée",
          statusRaw: "completed",
          technicalStatusRaw: "completed",
          createdAt: "2026-03-11T14:00:00.000Z",
        }),
        makeJob({
          jobId: "job-pending",
          versionLabel: "V4",
          statusLabel: "En attente provider",
          statusRaw: "provider_pending",
          technicalStatusRaw: "processing",
          createdAt: "2026-03-11T13:00:00.000Z",
        }),
        makeJob({
          jobId: "job-failed",
          versionLabel: "V3",
          statusLabel: "Échec à corriger",
          statusRaw: "action_required",
          technicalStatusRaw: "failed",
          createdAt: "2026-03-11T12:00:00.000Z",
        }),
      ],
      latestJobId: "job-completed",
    });

    expect(snapshot).toMatchObject({
      title: "Statuts précédents conserves",
      latestStatusRaw: "completed",
      acquiredCount: 1,
      waitingCount: 1,
      actionRequiredCount: 1,
    });
  });
});

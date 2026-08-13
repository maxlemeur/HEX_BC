import { describe, expect, it } from "vitest";

import {
  buildTakeoffMetricsStatsPayload,
  parseTakeoffMetricsQuery,
} from "@/lib/takeoff/stats";

describe("parseTakeoffMetricsQuery", () => {
  it("defaults to 30d with no level filter", () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    const parsed = parseTakeoffMetricsQuery(new URLSearchParams(), now);

    expect(parsed.period).toBe("30d");
    expect(parsed.level).toBeNull();
    expect(parsed.days).toBe(30);

    const expectedCutoff = new Date(now);
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    expect(parsed.cutoff).toBe(expectedCutoff.toISOString());
  });

  it("throws when level filter is invalid", () => {
    expect(() =>
      parseTakeoffMetricsQuery(new URLSearchParams("level=Z"))
    ).toThrow(/Parametre level invalide/);
  });

  it("uses a 6-day cutoff for 7d to align with daily trend buckets", () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    const parsed = parseTakeoffMetricsQuery(new URLSearchParams("period=7d"), now);

    const expectedCutoff = new Date(now);
    expectedCutoff.setDate(expectedCutoff.getDate() - 6);

    expect(parsed.cutoff).toBe(expectedCutoff.toISOString());
  });
});

describe("buildTakeoffMetricsStatsPayload", () => {
  it("computes KPI and level aggregates with tenant-scope filtering by job id", () => {
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      period: "7d",
      now: new Date("2026-03-01T10:00:00.000Z"),
      jobs: [
        {
          id: "job-a-1",
          status: "completed",
          level: "A",
          model: "gemini-3-flash-preview",
          duration_ms: 1_000,
          cost_cents: 10,
          retry_count: 0,
          error_code: null,
          created_at: "2026-02-28T10:00:00.000Z",
        },
        {
          id: "job-c-1",
          status: "failed",
          level: "C",
          model: "gemini-3-flash-preview",
          duration_ms: null,
          cost_cents: 5,
          retry_count: 1,
          error_code: "AI_TIMEOUT",
          created_at: "2026-02-27T10:00:00.000Z",
        },
        {
          id: "job-c-2",
          status: "applied",
          level: "C",
          model: "gemini-3-pro-preview",
          duration_ms: 2_000,
          cost_cents: 20,
          retry_count: 1,
          error_code: null,
          created_at: "2026-02-26T10:00:00.000Z",
        },
      ],
      runMetrics: [
        {
          job_id: "job-a-1",
          input_tokens: 10,
          reasoning_tokens: 5,
          output_tokens: 5,
          timed_out: false,
          budget_exceeded: false,
        },
        {
          job_id: "job-c-1",
          input_tokens: 20,
          reasoning_tokens: 10,
          output_tokens: 10,
          timed_out: true,
          budget_exceeded: true,
        },
        {
          job_id: "job-outside-scope",
          input_tokens: 999,
          reasoning_tokens: 999,
          output_tokens: 999,
          timed_out: true,
          budget_exceeded: true,
        },
      ],
      results: [
        { job_id: "job-a-1", confidence: 0.9 },
        { job_id: "job-c-2", confidence: 0.6 },
        { job_id: "job-outside-scope", confidence: 0.1 },
      ],
      items: [
        { id: "item-a-high", job_id: "job-a-1", confidence: 0.9 },
        { id: "item-a-low", job_id: "job-a-1", confidence: 0.4 },
        { id: "item-c-failed-1", job_id: "job-c-1", confidence: 0.9 },
        { id: "item-c-failed-2", job_id: "job-c-1", confidence: 0.9 },
        { id: "item-c-failed-3", job_id: "job-c-1", confidence: 0.9 },
        { id: "item-c-failed-4", job_id: "job-c-1", confidence: 0.9 },
        {
          id: "item-c-high",
          job_id: "job-c-2",
          confidence: 0.92,
          evidence: "Repère C-12",
          source_page: 2,
          is_excluded: false,
        },
        {
          id: "item-c-low",
          job_id: "job-c-2",
          confidence: 0.3,
          evidence: null,
          source_page: null,
          is_excluded: false,
        },
        { id: "item-outside", job_id: "job-outside-scope", confidence: 0.99 },
      ],
      auditLogs: [
        {
          record_id: "job-a-1",
          action: "takeoff.item.modified",
          created_at: "2026-02-28T11:00:00.000Z",
          after_data: {
            metadata: {
              item_id: "item-a-high",
              field: "quantity",
              next_value: 14,
            },
          },
        },
        {
          record_id: "job-c-2",
          action: "takeoff.item.modified",
          created_at: "2026-02-26T11:00:00.000Z",
          after_data: {
            metadata: {
              item_id: "item-c-high",
              field: "is_verified",
              next_value: true,
            },
          },
        },
        {
          record_id: "job-c-2",
          action: "takeoff.dpgf.review_decision",
          created_at: "2026-02-26T11:30:00.000Z",
          after_data: {
            metadata: {
              next_decision: "keep_takeoff",
            },
          },
        },
        {
          record_id: "job-outside-scope",
          action: "takeoff.item.modified",
          created_at: "2026-02-26T11:00:00.000Z",
          after_data: {
            metadata: {
              item_id: "item-outside",
              field: "designation",
              next_value: "ignore",
            },
          },
        },
      ],
    });

    expect(payload.period).toBe("7d");
    expect(payload.kpis).toMatchObject({
      totalJobs: 3,
      completedJobs: 2,
      failedJobs: 1,
      canceledJobs: 0,
      appliedJobs: 1,
      successRate: 66.7,
      avgDurationMs: 1_500,
      totalCostCents: 35,
      avgCostCentsPerJob: 12,
      avgConfidence: 0.75,
      avgItemsPerJob: 2.67,
    });
    expect(payload.tokenBreakdown).toEqual({
      inputTokens: 30,
      reasoningTokens: 15,
      outputTokens: 15,
    });
    expect(payload.reliability).toEqual({
      timedOutCount: 1,
      budgetExceededCount: 1,
      totalRunMetrics: 2,
      retriedJobs: 2,
      retriedThenCompleted: 1,
      retrySuccessRate: 50,
    });
    expect(payload.topErrors).toEqual([
      {
        errorCode: "AI_TIMEOUT",
        count: 1,
        lastOccurrence: "2026-02-27T10:00:00.000Z",
      },
    ]);
    expect(payload.costByLevel).toEqual([
      {
        level: "A",
        totalCostCents: 10,
        totalTokens: 20,
        jobCount: 1,
        failedCount: 0,
        avgDurationMs: 1_000,
        failureRate: 0,
        avgItemsPerJob: 2,
      },
      {
        level: "C",
        totalCostCents: 25,
        totalTokens: 40,
        jobCount: 2,
        failedCount: 1,
        avgDurationMs: 2_000,
        failureRate: 50,
        avgItemsPerJob: 3,
      },
    ]);
    expect(payload.recentJobs.map((job) => job.id)).toEqual([
      "job-a-1",
      "job-c-1",
      "job-c-2",
    ]);
    expect(payload.corrections).toEqual({
      kpis: {
        totalEvents: 3,
        correctedJobs: 1,
        quicklyValidatedJobs: 1,
        untouchedSuccessfulJobs: 0,
        correctionRate: 50,
        quickValidationRate: 50,
      },
      eventCounts: [
        {
          type: "quantity_changed",
          label: "Quantités corrigées",
          count: 1,
        },
        {
          type: "manual_verification",
          label: "Vérifications manuelles",
          count: 1,
        },
        {
          type: "dpgf_keep_takeoff",
          label: "Métré validé",
          count: 1,
        },
      ],
      byLevel: [
        {
          level: "A",
          correctedJobs: 1,
          quicklyValidatedJobs: 0,
          untouchedSuccessfulJobs: 0,
          correctionRate: 100,
          quickValidationRate: 0,
        },
        {
          level: "C",
          correctedJobs: 0,
          quicklyValidatedJobs: 1,
          untouchedSuccessfulJobs: 0,
          correctionRate: 0,
          quickValidationRate: 100,
        },
      ],
    });
    expect(payload.calibration).toEqual({
      status: "insufficient",
      minimumSampleSize: 20,
      appliedScoredItems: 2,
      appliedHighScoreItems: 1,
      appliedHighScoreMateriallyCorrectedItems: 0,
      appliedHighScoreMaterialCorrectionRate: 0,
      levelCIncludedItems: 2,
      levelCLocalizedProofItems: 1,
      levelCLocalizedProofCoverage: 50,
    });
    expect(payload.trend).toHaveLength(7);
    expect(payload.pilot).toMatchObject({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      killSwitchLabel: "Pilote actif",
      satisfactionLabel: "50 %",
      goNoGo: {
        status: "inconclusive",
      },
    });
    expect(payload.pilot.goNoGo.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "applied_high_score_correction_rate",
          status: "inconclusive",
          passed: false,
        }),
        expect.objectContaining({
          key: "level_c_proof_coverage",
          status: "fail",
          passed: false,
        }),
      ])
    );
    expect(payload.pilot.weeklySnapshots[0]).toMatchObject({
      totalJobs: 3,
      correctionRate: 50,
      satisfactionRate: 50,
    });
  });

  it.each([
    {
      period: "30d" as const,
      nowIso: "2026-03-31T12:00:00.000Z",
      oldestJobAt: "2026-03-01T12:00:00.000Z",
      oldestBucketKey: "2026-03-01",
    },
    {
      period: "90d" as const,
      nowIso: "2026-03-31T12:00:00.000Z",
      oldestJobAt: "2025-12-31T12:00:00.000Z",
      oldestBucketKey: "2025-12-31",
    },
  ])(
    "keeps weekly trend totals aligned with KPI totals for $period",
    ({ period, nowIso, oldestJobAt, oldestBucketKey }) => {
      const now = new Date(nowIso);
      const nextJobAt = new Date(oldestJobAt);
      nextJobAt.setDate(nextJobAt.getDate() + 1);

      const payload = buildTakeoffMetricsStatsPayload({
        tenantId: "tenant-pilot",
        killSwitchEnabled: true,
        period,
        now,
        jobs: [
          {
            id: `job-${period}-oldest`,
            status: "failed",
            level: "A",
            model: "gemini-3-flash-preview",
            duration_ms: null,
            cost_cents: 0,
            retry_count: 0,
            error_code: "AI_TIMEOUT",
            created_at: oldestJobAt,
          },
          {
            id: `job-${period}-next`,
            status: "completed",
            level: "A",
            model: "gemini-3-flash-preview",
            duration_ms: 500,
            cost_cents: 0,
            retry_count: 0,
            error_code: null,
            created_at: nextJobAt.toISOString(),
          },
        ],
        runMetrics: [],
        results: [],
        items: [],
      });

      expect(payload.trend[0]?.key).toBe(oldestBucketKey);
      expect(payload.trend[0]?.createdCount).toBe(2);
      expect(payload.trend[0]?.failedCount).toBe(1);

      const trendCreatedTotal = payload.trend.reduce(
        (sum, bucket) => sum + bucket.createdCount,
        0
      );
      const trendFailedTotal = payload.trend.reduce(
        (sum, bucket) => sum + bucket.failedCount,
        0
      );

      expect(trendCreatedTotal).toBe(payload.kpis.totalJobs);
      expect(trendFailedTotal).toBe(payload.kpis.failedJobs);
    }
  );

  it("keeps daily trend totals aligned with KPI totals for 7d", () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      period: "7d",
      now,
      jobs: [
        {
          id: "job-7d-oldest",
          status: "failed",
          level: "A",
          model: "gemini-3-flash-preview",
          duration_ms: null,
          cost_cents: 0,
          retry_count: 0,
          error_code: "AI_TIMEOUT",
          created_at: "2026-03-04T12:00:00.000Z",
        },
        {
          id: "job-7d-today",
          status: "completed",
          level: "A",
          model: "gemini-3-flash-preview",
          duration_ms: 500,
          cost_cents: 0,
          retry_count: 0,
          error_code: null,
          created_at: "2026-03-10T12:00:00.000Z",
        },
      ],
      runMetrics: [],
      results: [],
      items: [],
    });

    expect(payload.trend[0]?.key).toBe("2026-03-04");
    expect(payload.trend[0]?.createdCount).toBe(1);
    expect(payload.trend[0]?.failedCount).toBe(1);

    const trendCreatedTotal = payload.trend.reduce(
      (sum, bucket) => sum + bucket.createdCount,
      0
    );
    const trendFailedTotal = payload.trend.reduce(
      (sum, bucket) => sum + bucket.failedCount,
      0
    );

    expect(trendCreatedTotal).toBe(payload.kpis.totalJobs);
    expect(trendFailedTotal).toBe(payload.kpis.failedJobs);
  });

  it("counts repeated DPGF transitions from audit history and keeps the job corrected", () => {
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: false,
      period: "30d",
      now: new Date("2026-03-10T12:00:00.000Z"),
      jobs: [
        {
          id: "job-dpgf-history",
          status: "completed",
          level: "C",
          model: "gemini-3-pro-preview",
          duration_ms: 1_000,
          cost_cents: 15,
          retry_count: 0,
          error_code: null,
          created_at: "2026-03-08T10:00:00.000Z",
        },
      ],
      runMetrics: [],
      results: [],
      items: [],
      auditLogs: [
        {
          record_id: "job-dpgf-history",
          action: "takeoff.dpgf.review_decision",
          created_at: "2026-03-08T10:10:00.000Z",
          after_data: {
            metadata: {
              next_decision: "manual_fix",
            },
          },
        },
        {
          record_id: "job-dpgf-history",
          action: "takeoff.dpgf.review_decision",
          created_at: "2026-03-08T10:20:00.000Z",
          after_data: {
            metadata: {
              next_decision: "keep_takeoff",
            },
          },
        },
      ],
    });

    expect(payload.corrections.kpis).toMatchObject({
      totalEvents: 2,
      correctedJobs: 1,
      quicklyValidatedJobs: 0,
      untouchedSuccessfulJobs: 0,
      correctionRate: 100,
      quickValidationRate: 0,
    });
    expect(payload.corrections.eventCounts).toEqual([
      {
        type: "dpgf_keep_takeoff",
        label: "Métré validé",
        count: 1,
      },
      {
        type: "dpgf_manual_fix",
        label: "Corrections DPGF manuelles",
        count: 1,
      },
    ]);
    expect(payload.corrections.byLevel).toEqual([
      {
        level: "C",
        correctedJobs: 1,
        quicklyValidatedJobs: 0,
        untouchedSuccessfulJobs: 0,
        correctionRate: 100,
        quickValidationRate: 0,
      },
    ]);
    expect(payload.pilot.killSwitchLabel).toBe("Pilote coupé");
  });

  it("returns a GO decision when pilot thresholds are met with enough volume", () => {
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      period: "30d",
      now: new Date("2026-03-10T12:00:00.000Z"),
      jobs: Array.from({ length: 8 }, (_, index) => ({
        id: `job-go-${index}`,
        status: "applied",
        level: "B",
        model: "gemini-3-flash-preview",
        duration_ms: 120_000,
        cost_cents: 200,
        retry_count: 0,
        error_code: null,
        created_at: `2026-03-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      })),
      runMetrics: [],
      results: [],
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `item-go-${index}`,
        job_id: `job-go-${index % 8}`,
        confidence: 0.9,
      })),
      auditLogs: [],
    });

    expect(payload.pilot.goNoGo.status).toBe("go");
    expect(payload.pilot.goNoGo.label).toBe("GO");
    expect(payload.pilot.goNoGo.criteria.every((criterion) => criterion.passed)).toBe(
      true
    );
  });

  it("does not issue a GO when applied high-score lines exceed the correction target", () => {
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      period: "30d",
      now: new Date("2026-03-10T12:00:00.000Z"),
      jobs: Array.from({ length: 8 }, (_, index) => ({
        id: `job-calibration-${index}`,
        status: "applied",
        level: "B",
        model: "gemini-3-flash-preview",
        duration_ms: 120_000,
        cost_cents: 200,
        retry_count: 0,
        error_code: null,
        created_at: `2026-03-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      })),
      runMetrics: [],
      results: [],
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `item-calibration-${index}`,
        job_id: `job-calibration-${index % 8}`,
        confidence: 0.9,
      })),
      auditLogs: [0, 1].map((index) => ({
        record_id: `job-calibration-${index}`,
        action: "takeoff.item.modified",
        created_at: `2026-03-0${index + 1}T11:00:00.000Z`,
        after_data: {
          metadata: {
            item_id: `item-calibration-${index}`,
            field: "quantity",
            next_value: 12,
          },
        },
      })),
    });

    expect(payload.calibration).toMatchObject({
      status: "sufficient",
      appliedHighScoreItems: 20,
      appliedHighScoreMateriallyCorrectedItems: 2,
      appliedHighScoreMaterialCorrectionRate: 10,
    });
    expect(payload.pilot.goNoGo.status).toBe("watch");
    expect(payload.pilot.goNoGo.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "applied_high_score_correction_rate",
          actualLabel: "10 % (2/20)",
          status: "fail",
          passed: false,
        }),
      ])
    );
  });

  it("returns an inconclusive pilot decision when no successful jobs are available", () => {
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      period: "30d",
      now: new Date("2026-03-10T12:00:00.000Z"),
      jobs: Array.from({ length: 8 }, (_, index) => ({
        id: `job-failed-${index}`,
        status: "failed",
        level: "B",
        model: "gemini-3-flash-preview",
        duration_ms: null,
        cost_cents: null,
        retry_count: 0,
        error_code: "AI_TIMEOUT",
        created_at: `2026-03-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      })),
      runMetrics: [],
      results: [],
      items: [],
      auditLogs: [],
    });

    expect(payload.pilot.goNoGo.status).toBe("inconclusive");
    expect(payload.pilot.goNoGo.label).toBe("Inconclusif");
    expect(payload.pilot.goNoGo.summary).toMatch(/Aucun dossier exploitable/);
    expect(payload.pilot.goNoGo.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "volume",
          passed: true,
          status: "pass",
        }),
        expect.objectContaining({
          key: "avg_cost",
          actualLabel: "-",
          passed: false,
          status: "inconclusive",
        }),
        expect.objectContaining({
          key: "correction_rate",
          actualLabel: "-",
          passed: false,
          status: "inconclusive",
        }),
      ])
    );
  });

  it("uses measured jobs for the pilot average cost criterion", () => {
    const payload = buildTakeoffMetricsStatsPayload({
      tenantId: "tenant-pilot",
      killSwitchEnabled: true,
      period: "30d",
      now: new Date("2026-03-10T12:00:00.000Z"),
      jobs: [
        {
          id: "job-expensive-1",
          status: "applied",
          level: "B",
          model: "gemini-3-flash-preview",
          duration_ms: 120_000,
          cost_cents: 1_500,
          retry_count: 0,
          error_code: null,
          created_at: "2026-03-01T10:00:00.000Z",
        },
        {
          id: "job-expensive-2",
          status: "applied",
          level: "B",
          model: "gemini-3-flash-preview",
          duration_ms: 120_000,
          cost_cents: 1_500,
          retry_count: 0,
          error_code: null,
          created_at: "2026-03-02T10:00:00.000Z",
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `job-pending-${index}`,
          status: "pending",
          level: "B",
          model: "gemini-3-flash-preview",
          duration_ms: null,
          cost_cents: null,
          retry_count: 0,
          error_code: null,
          created_at: `2026-03-${String(index + 3).padStart(2, "0")}T10:00:00.000Z`,
        })),
      ],
      runMetrics: [],
      results: [],
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `item-expensive-${index}`,
        job_id: `job-expensive-${index % 2 + 1}`,
        confidence: 0.9,
      })),
      auditLogs: [],
    });

    const avgCostCriterion = payload.pilot.goNoGo.criteria.find(
      (criterion) => criterion.key === "avg_cost"
    );

    expect(avgCostCriterion?.actualLabel).toMatch(/15,00/);
    expect(avgCostCriterion).toMatchObject({
      passed: false,
      status: "fail",
    });
    expect(payload.pilot.goNoGo.status).toBe("watch");
  });
});

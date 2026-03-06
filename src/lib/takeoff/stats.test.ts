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
        { job_id: "job-a-1" },
        { job_id: "job-a-1" },
        { job_id: "job-c-1" },
        { job_id: "job-c-1" },
        { job_id: "job-c-1" },
        { job_id: "job-c-1" },
        { job_id: "job-c-2" },
        { job_id: "job-c-2" },
        { job_id: "job-outside-scope" },
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
    expect(payload.trend).toHaveLength(7);
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
});

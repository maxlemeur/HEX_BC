import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("swr", () => ({
  default: vi.fn(),
}));

import useSWR from "swr";

import { TakeoffMetricsDashboard } from "@/components/takeoff/TakeoffMetricsDashboard";
import type { TakeoffMetricsPilotStatsPayload } from "@/lib/takeoff/pilot-metrics";

const DASHBOARD_PAYLOAD: TakeoffMetricsPilotStatsPayload = {
  generatedAt: "2026-03-09T10:00:00.000Z",
  period: "30d",
  kpis: {
    totalJobs: 12,
    completedJobs: 9,
    failedJobs: 2,
    canceledJobs: 1,
    appliedJobs: 4,
    successRate: 75,
    avgDurationMs: 180000,
    totalCostCents: 2400,
    avgCostCentsPerJob: 200,
    avgConfidence: 0.82,
    avgItemsPerJob: 14.5,
  },
  corrections: {
    kpis: {
      totalEvents: 7,
      correctedJobs: 3,
      quicklyValidatedJobs: 4,
      untouchedSuccessfulJobs: 2,
      correctionRate: 33.3,
      quickValidationRate: 44.4,
    },
    eventCounts: [
      { type: "quantity_changed", label: "Quantites corrigees", count: 2 },
    ],
    byLevel: [
      {
        level: "B",
        correctedJobs: 2,
        quicklyValidatedJobs: 2,
        untouchedSuccessfulJobs: 1,
        correctionRate: 40,
        quickValidationRate: 40,
      },
    ],
  },
  pilot: {
    tenantId: "tenant-1",
    killSwitchFlagKey: "TAKEOFF_MODULE_ENABLED",
    killSwitchEnabled: true,
    killSwitchLabel: "Pilote actif",
    satisfactionLabel: "66,7 %",
    satisfactionDefinition:
      "Proxy calcule sur les jobs exploitables valides rapidement ou sans retouche explicite.",
    weeklySnapshots: [
      {
        key: "2026-03-03",
        label: "03 mars",
        totalJobs: 5,
        successfulJobs: 4,
        avgCostCentsPerJob: 220,
        avgDurationMs: 120000,
        correctionRate: 25,
        satisfactionRate: 75,
      },
    ],
    goNoGo: {
      status: "watch",
      label: "A surveiller",
      summary: "Un critere pilote reste fragile. Continuez le tenant pilote avant decision finale.",
      criteria: [
        {
          key: "volume",
          label: "Volume observe",
          targetLabel: ">= 8 dossiers",
          actualLabel: "12 dossiers",
          passed: true,
          status: "pass",
        },
      ],
    },
  },
  trend: [
    { key: "2026-03-03", label: "03 mars", createdCount: 5, failedCount: 1 },
  ],
  costByLevel: [
    {
      level: "B",
      totalCostCents: 2400,
      totalTokens: 12000,
      jobCount: 12,
      failedCount: 2,
      avgDurationMs: 180000,
      failureRate: 16.7,
      avgItemsPerJob: 14.5,
    },
  ],
  tokenBreakdown: {
    inputTokens: 10000,
    reasoningTokens: 1000,
    outputTokens: 1000,
  },
  topErrors: [
    { errorCode: "AI_TIMEOUT", count: 2, lastOccurrence: "2026-03-08T10:00:00.000Z" },
  ],
  reliability: {
    timedOutCount: 2,
    budgetExceededCount: 0,
    totalRunMetrics: 12,
    retriedJobs: 1,
    retriedThenCompleted: 1,
    retrySuccessRate: 100,
  },
  recentJobs: [
    {
      id: "job-1",
      status: "completed",
      level: "B",
      model: "gemini-3-flash-preview",
      durationMs: 120000,
      costCents: 220,
      confidence: 0.81,
      errorCode: null,
      createdAt: "2026-03-08T10:00:00.000Z",
    },
  ],
};

describe("TakeoffMetricsDashboard", () => {
  it("renders pilot monitoring, weekly tracking and go/no-go criteria", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: DASHBOARD_PAYLOAD,
      error: undefined,
      isLoading: false,
    } as never);

    render(<TakeoffMetricsDashboard tenantId="tenant-1" />);

    expect(screen.getByText("Pilote tenant")).toBeInTheDocument();
    expect(screen.getByText("Pilote actif")).toBeInTheDocument();
    expect(screen.getByText("Decision go/no-go")).toBeInTheDocument();
    expect(screen.getByText("A surveiller")).toBeInTheDocument();
    expect(screen.getByText("Suivi hebdo pilote")).toBeInTheDocument();
    expect(screen.getAllByText("03 mars").length).toBeGreaterThan(0);
    expect(screen.getByText("TAKEOFF_MODULE_ENABLED")).toBeInTheDocument();
  });
});

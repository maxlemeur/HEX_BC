import { act, cleanup, render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TakeoffActivityCenterJobRow, TakeoffActivityCenterResponse } from "@/lib/takeoff/types";

// The real SWR hook: only the list's transport and the page's neighbours are replaced.
const fetchTakeoffActivityCenter = vi.hoisted(() => vi.fn());
vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffActivityCenter,
  isTakeoffApiError: () => false,
  cancelTakeoffJob: vi.fn(),
  resubmitTakeoffJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires/project-1/takeoff",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/affaires/LaunchMetreDialog", () => ({ LaunchMetreDialog: () => null }));
vi.mock("./TakeoffExceptionsTab", () => ({ default: () => null }));
vi.mock("./TakeoffApplicationHistoryTab", () => ({ default: () => null }));

import TakeoffActivityCenter from "./TakeoffActivityCenter";

function row(resume: TakeoffActivityCenterJobRow["resume"]): TakeoffActivityCenterJobRow {
  return {
    jobId: "11111111-1111-4111-8111-111111111111", analysisCompletion: null, estimateVersionId: null, versionLabel: "Sans devis",
    lotLabel: null, planSetLabel: null, levelLabel: "Détaillé", processingStrategy: "sync", providerBatchState: null,
    providerBatchUpdatedAt: null, statusLabel: "Échec à corriger", statusRaw: "action_required", technicalStatusRaw: "failed",
    canCancel: false, canResubmit: false, resume, errorCode: "AI_TIMEOUT", nextRetryAt: resume?.availableAt ?? null, itemCount: 0,
    coveragePercent: null, exceptionCount: 0, confidenceLabel: "Faible", appliedCount: 0, createdAt: "2026-11-20T07:00:00.000Z",
    carriedOverFrom: null, neverApplied: false, retryCount: 1,
  };
}

function answer(jobs: TakeoffActivityCenterJobRow[]): TakeoffActivityCenterResponse {
  return { counters: { technicalJobs: 0, usableJobs: 0, blockingExceptionsJobs: 0 }, jobs, analysisCompletions: [], analysisCompletionsHasOlder: false,
    pagination: { limit: 10, offset: 0, total: jobs.length } };
}

// Fix round 2, point 3: with an empty cache, the first answer has a row that waits (here an overdue scheduled retry): the
// list keeps being read while it waits, and stops once the decision no longer waits.
describe("TakeoffActivityCenter polling", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps reading the list while a row waits, from the first answer, and stops after", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    let waits = true;
    fetchTakeoffActivityCenter.mockImplementation(async () => answer([row(waits
      ? { action: "wait_retry", reason: "retry_scheduled", availableAt: "2026-11-21T09:00:00.000Z" }
      : { action: "new_analysis", reason: "analysis_closed", availableAt: null })]));

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const first = fetchTakeoffActivityCenter.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(20_500); });
    const polled = fetchTakeoffActivityCenter.mock.calls.length;
    expect(polled).toBeGreaterThan(first);

    waits = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_500); });
    const settled = fetchTakeoffActivityCenter.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchTakeoffActivityCenter.mock.calls.length).toBe(settled);
  });
});

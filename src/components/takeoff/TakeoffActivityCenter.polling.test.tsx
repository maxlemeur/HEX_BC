import { act, cleanup, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TakeoffApiError } from "@/lib/takeoff/client-http";
import type { TakeoffRequestActivityResponse } from "@/lib/takeoff/request-activity-contracts";
import { fixtureActivityResponse, fixtureThreePlans } from "@/lib/takeoff/request-activity.test-fixtures";
import type { TakeoffActivityCenterJobRow, TakeoffActivityCenterResponse } from "@/lib/takeoff/types";

// The real SWR hook: only the transports and the page's neighbours are replaced.
const fetchTakeoffActivityCenter = vi.hoisted(() => vi.fn());
const fetchTakeoffRequestActivity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffActivityCenter,
  isTakeoffApiError: () => false,
  cancelTakeoffJob: vi.fn(),
  resubmitTakeoffJob: vi.fn(),
}));
vi.mock("@/lib/takeoff/request-activity-client", () => ({ fetchTakeoffRequestActivity }));
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({ assumeTakeoffLaunchRequestAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires/project-1/takeoff",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/affaires/LaunchMetreDialog", () => ({ LaunchMetreDialog: () => null }));
vi.mock("./TakeoffExceptionsTab", () => ({ default: () => null }));
vi.mock("./TakeoffApplicationHistoryTab", () => ({ default: () => null }));
// The table of items has its own tests (item-table/TakeoffItemTable.test.tsx).
vi.mock("./item-table/TakeoffItemTable", () => ({ TakeoffItemTable: () => null }));

import TakeoffActivityCenter from "./TakeoffActivityCenter";

const EMPTY_LIST: TakeoffActivityCenterResponse = {
  counters: { technicalJobs: 0, usableJobs: 0, blockingExceptionsJobs: 0 }, jobs: [], analysisCompletions: [],
  analysisCompletionsHasOlder: false, pagination: { limit: 20, offset: 0, total: 0 },
};

/** An analysis without a request waits for its scheduled retry, then its retry ran: the light read tells both. */
function light(waiting: boolean, signature: string): TakeoffRequestActivityResponse {
  return {
    view: "current", observedAt: new Date().toISOString(), live: waiting, signature, current: null, history: [],
    historyHasOlder: false, historyOffset: 0, standalone: { running: 0, waiting: waiting ? 1 : 0 },
    elsewhere: { running: false, waiting: false }, currentIsLatest: false, inFlightJobIds: [],
    reused: { dossierPosition: null, dossier: false, actionKey: null, action: false },
  };
}

/** A row of the list of analyses: a job without a request, running when `technicalStatusRaw` says so. */
function row(jobId: string, technicalStatusRaw: string, planSetLabel = "Plans du membre 1"): TakeoffActivityCenterJobRow {
  const canceled = technicalStatusRaw === "canceled";
  return {
    jobId, launchRequestId: null, analysisCompletion: null, estimateVersionId: null, versionLabel: "Sans devis", lotLabel: null,
    planSetLabel, levelLabel: "Détaillé", processingStrategy: "sync", providerBatchState: null, providerBatchUpdatedAt: null,
    statusLabel: canceled ? "Annulé" : "En traitement", statusRaw: canceled ? "canceled" : "processing", technicalStatusRaw,
    canCancel: false, canResubmit: false,
    resume: { action: "none", reason: "not_stopped", availableAt: null }, errorCode: null, nextRetryAt: null, itemCount: 0,
    coveragePercent: null, exceptionCount: 0, confidenceLabel: "Faible", appliedCount: 0, createdAt: "2026-11-21T09:00:00.000Z",
    carriedOverFrom: null, neverApplied: false, retryCount: 0,
  };
}
const listOf = (jobs: TakeoffActivityCenterJobRow[]): TakeoffActivityCenterResponse => ({ ...EMPTY_LIST, jobs,
  counters: { technicalJobs: jobs.length, usableJobs: 0, blockingExceptionsJobs: 0 }, pagination: { limit: 20, offset: 0, total: jobs.length } });
const JOB = "70000000-0000-4000-8000-000000000001";

const currentReads = () => fetchTakeoffRequestActivity.mock.calls.filter(([, query]) => query.view === "current").length;

describe("TakeoffActivityCenter polling", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Lot 3 PR 4: one poll per page. The light read is polled while something can change by itself (here every 30 s while
  // an analysis waits for its retry) and stops after; the list of analyses is read again only when its signature moves.
  it("polls the light read alone, reads the list again on a transition only, and stops when nothing can change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    let answer = light(true, "waiting");
    fetchTakeoffRequestActivity.mockImplementation(async () => answer);
    fetchTakeoffActivityCenter.mockImplementation(async () => EMPTY_LIST);

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey="tenant-1:member-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(currentReads()).toBe(1);
    const listReads = fetchTakeoffActivityCenter.mock.calls.length;
    expect(listReads).toBeGreaterThan(0);

    // Nothing moved: the light read is read again, the list is not.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_500); });
    expect(currentReads()).toBe(2);
    expect(fetchTakeoffActivityCenter.mock.calls.length).toBe(listReads);

    // The retry ran: the signature moved, the list is read again once, and the poll stops.
    answer = light(false, "retried");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_500); });
    expect(currentReads()).toBe(3);
    expect(fetchTakeoffActivityCenter.mock.calls.length).toBeGreaterThan(listReads);
    const settled = [currentReads(), fetchTakeoffActivityCenter.mock.calls.length];
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect([currentReads(), fetchTakeoffActivityCenter.mock.calls.length]).toEqual(settled);
  });

  // Review finding 2: SWR suspends its interval while an error is cached; the failed read is tried again 30 s later.
  it("reads again 30 s after a failed read while a plan is read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    const running = { ...light(true, "running"), standalone: { running: 1, waiting: 0 } };
    let fail = false;
    fetchTakeoffRequestActivity.mockImplementation(async () => {
      if (fail) throw new Error("network");
      return { ...running, observedAt: new Date().toISOString() };
    });
    fetchTakeoffActivityCenter.mockImplementation(async () => EMPTY_LIST);
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey="tenant-1:member-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(currentReads()).toBe(1);
    fail = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(currentReads()).toBe(2);
    fail = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(currentReads()).toBe(2);
    // 30 s after the failure the read is tried again (here the suspended interval may read at the same moment: the page's
    // own deduplication merges them; this test sets none).
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    const retried = currentReads();
    expect(retried).toBeGreaterThanOrEqual(3);
    // Read again, it follows the plan being read every 5 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(currentReads()).toBeGreaterThan(retried);
  });

  it("keys the reads by member, so that another member's answer is never served", async () => {
    fetchTakeoffRequestActivity.mockImplementation(async () => light(false, "s"));
    fetchTakeoffActivityCenter.mockImplementation(async () => EMPTY_LIST);
    const cache = new Map();
    const page = (viewerKey: string) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey={viewerKey} versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>
    );
    const { rerender } = render(page("tenant-1:member-1"));
    await act(async () => { await Promise.resolve(); });
    rerender(page("tenant-1:member-2"));
    await act(async () => { await Promise.resolve(); });
    expect([...cache.keys()].filter((key) => String(key).includes("takeoff-request-activity") && String(key).includes("current")))
      .toHaveLength(2);
  });

  // Fix round 1, point 1: while another member's answers load, nothing of the first member's is on screen.
  it("never shows a member's answers to the next member while theirs load", async () => {
    fetchTakeoffRequestActivity.mockImplementation(async () => fixtureActivityResponse(fixtureThreePlans()));
    fetchTakeoffActivityCenter.mockImplementation(async () => listOf([row(JOB, "processing")]));
    const page = (viewerKey: string) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey={viewerKey} versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>
    );
    const { rerender } = render(page("tenant-1:member-1"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByText("Plan A — niveau 1.pdf").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plans du membre 1").length).toBeGreaterThan(0);
    // The second member's reads never answer during this test.
    fetchTakeoffRequestActivity.mockImplementation(() => new Promise(() => undefined));
    fetchTakeoffActivityCenter.mockImplementation(() => new Promise(() => undefined));
    rerender(page("tenant-1:member-2"));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("Plan A — niveau 1.pdf")).toBeNull();
    expect(screen.queryByText("Plans du membre 1")).toBeNull();
  });

  it("withdraws what was shown when the reads are refused, and reads nothing more", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T09:06:00.000Z"));
    let refused = false;
    const refusal = () => new TakeoffApiError("Accès refusé à cette affaire.", 403, null, "FORBIDDEN");
    fetchTakeoffRequestActivity.mockImplementation(async () => {
      if (refused) throw refusal();
      return { ...fixtureActivityResponse(fixtureThreePlans()), observedAt: new Date().toISOString() };
    });
    fetchTakeoffActivityCenter.mockImplementation(async () => { if (refused) throw refusal(); return EMPTY_LIST; });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey="tenant-1:member-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getAllByText("Plan A — niveau 1.pdf").length).toBeGreaterThan(0);
    refused = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(screen.queryByText("Plan A — niveau 1.pdf")).toBeNull();
    expect(screen.queryByText(/Dernier état connu/)).toBeNull();
    expect(screen.getByTestId("takeoff-request-refused")).toBeTruthy();
    const settled = currentReads();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(currentReads()).toBe(settled);
  });

  // Closing round, point 2: a refusal of the light read alone withdraws the summary and the list it had loaded too.
  it("withdraws the summary and the list already loaded when the light read is refused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T09:06:00.000Z"));
    let refused = false;
    fetchTakeoffRequestActivity.mockImplementation(async () => {
      if (refused) throw new TakeoffApiError("Accès refusé à cette affaire.", 403, null, "FORBIDDEN");
      return { ...fixtureActivityResponse(fixtureThreePlans()), observedAt: new Date().toISOString() };
    });
    // The list and the summary keep answering: only the light read is refused.
    fetchTakeoffActivityCenter.mockImplementation(async () => listOf([row(JOB, "processing")]));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey="tenant-1:member-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getAllByText("Plans du membre 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plan A — niveau 1.pdf").length).toBeGreaterThan(0);
    refused = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(screen.getByTestId("takeoff-request-refused")).toBeTruthy();
    expect(screen.queryAllByText("Plan A — niveau 1.pdf")).toHaveLength(0);
    expect(screen.queryAllByText("Plans du membre 1")).toHaveLength(0);
    expect(screen.queryAllByText("Suivi des analyses")).toHaveLength(0);
  });

  // Fix round 1, point 3: the list shows an analysis running that the light answer no longer sees in flight (another tab
  // stopped it between the two reads): both are read again, once, and the page settles.
  it("reads the list again when its first answer shows in flight an analysis the light answer does not", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    // Its first answer shows it running; once stopped, every later read shows it canceled.
    let listed = 0;
    fetchTakeoffActivityCenter.mockImplementation(async () => listOf([row(JOB, listed++ === 0 ? "processing" : "canceled")]));
    fetchTakeoffRequestActivity.mockImplementation(async () => light(false, "stopped"));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey="tenant-1:member-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    const listReads = () => fetchTakeoffActivityCenter.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // The light answer has nothing in flight and no interval: the list is read again because of the difference alone.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(listReads()).toBeGreaterThanOrEqual(2);
    expect(currentReads()).toBeGreaterThanOrEqual(2);
    // Closing round, point 6: the member sees the analysis stopped, not running.
    const statuses = () => [...document.querySelectorAll(".status-badge")].map((badge) => badge.textContent);
    expect(statuses()).toContain("Annulé");
    expect(statuses()).not.toContain("En traitement");
    const settled = [listReads(), currentReads()];
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect([listReads(), currentReads()]).toEqual(settled);
  });

  it("does not try a failed read again in a tab hidden meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    fetchTakeoffActivityCenter.mockImplementation(async () => EMPTY_LIST);
    fetchTakeoffRequestActivity.mockImplementation(async () => { throw new TakeoffApiError("Indisponible.", 503, null, "INTERNAL_ERROR"); });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TakeoffActivityCenter projectId="project-1" viewerKey="tenant-1:member-1" versions={[]} planSets={[]} launchContext={null} />
      </SWRConfig>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const first = currentReads();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
      expect(currentReads()).toBe(first);
    } finally {
      visibility.mockRestore();
    }
  });
});

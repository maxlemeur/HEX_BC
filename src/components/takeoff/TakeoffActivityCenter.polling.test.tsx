import { act, cleanup, render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TakeoffRequestActivityResponse } from "@/lib/takeoff/request-activity-contracts";
import type { TakeoffActivityCenterResponse } from "@/lib/takeoff/types";

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
  };
}

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
});

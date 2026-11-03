// Failure cases written before the fix (Codex review of PR #143, P2):
// 1. A statistics request for the previous selection resolves after the request
//    for the new selection: its counts must not replace the current ones.
// 2. The previous request fails after the current one succeeded: its error must
//    not cover the current statistics.
// 3. A bench report requested before the selected one resolves last: its
//    markdown must not replace the selected report's (Codex, second review).
// The army journey cannot order two responses deterministically, so this check
// holds the two requests and resolves them in the wrong order.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LabState, LabStats } from "@/lib/takeoff/lab/contracts";

const { statsMock, benchReportsMock, benchReportMock } = vi.hoisted(() => ({ statsMock: vi.fn(), benchReportsMock: vi.fn(), benchReportMock: vi.fn() }));

vi.mock("@/components/takeoff/lab/lab-api", async (importActual) => {
  const actual = await importActual<typeof import("@/components/takeoff/lab/lab-api")>();
  return {
    ...actual,
    labApi: { ...actual.labApi, stats: statsMock, benchReports: benchReportsMock, benchReport: benchReportMock },
  };
});

const STATE = {
  configured: true,
  message: null,
  documents: [],
  tasks: [],
  decisions: { available: false, message: "", model: "gpt-6-luna", budget: { limit: 0, used: 0, remaining: 0, calls_without_usage: 0 } },
  chatgpt: { connected: false, model: null, reasoning_effort: null, message: null },
  campaigns: ["campagne-a", "campagne-b"],
  latest_campaign: "campagne-a",
} as unknown as LabState;

vi.mock("@/components/takeoff/lab/TakeoffLabShell", () => ({
  useTakeoffLab: () => ({ state: STATE, refresh: vi.fn(), refreshError: null }),
}));

import { LabStatsScreen } from "@/components/takeoff/lab/LabStatsScreen";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const stats = (runs: number, verdicts: number): LabStats => ({ groups: [], runs, verdicts });

beforeEach(() => {
  statsMock.mockReset();
  benchReportsMock.mockReset().mockResolvedValue([]);
  benchReportMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("LabStatsScreen", () => {
  it("keeps the statistics of the current selection when an older request resolves last", async () => {
    const previous = deferred<LabStats>();
    const current = deferred<LabStats>();
    statsMock.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);

    render(<LabStatsScreen />);
    expect(statsMock).toHaveBeenLastCalledWith({ campaign: "campagne-a", task: null });
    fireEvent.change(screen.getByLabelText("Campagne"), { target: { value: "campagne-b" } });
    await waitFor(() => expect(statsMock).toHaveBeenLastCalledWith({ campaign: "campagne-b", task: null }));

    current.resolve(stats(7, 9));
    await screen.findByText("7 essais · 9 verdicts");
    previous.resolve(stats(1, 1));
    await previous.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText("7 essais · 9 verdicts")).toBeTruthy();
    expect(screen.queryByText("1 essai · 1 verdict")).toBeNull();
  });

  it("does not show the error of an older request over the current statistics", async () => {
    const previous = deferred<LabStats>();
    const current = deferred<LabStats>();
    statsMock.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);

    render(<LabStatsScreen />);
    fireEvent.change(screen.getByLabelText("Campagne"), { target: { value: "campagne-b" } });
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(2));

    current.resolve(stats(7, 9));
    await screen.findByText("7 essais · 9 verdicts");
    previous.reject(new Error("Sélection précédente indisponible"));
    await previous.promise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Sélection précédente indisponible")).toBeNull();
    expect(screen.getByText("7 essais · 9 verdicts")).toBeTruthy();
  });

  it("shows the selected bench report when a report opened before it resolves last", async () => {
    statsMock.mockResolvedValue(stats(0, 0));
    const report = (name: string) => ({ name, started_at: null, commit: null, dataset_sha256: null, status: "complete", couples: [] });
    benchReportsMock.mockResolvedValue([report("takeoff-bench-a"), report("takeoff-bench-b")]);
    const first = deferred<string>();
    const second = deferred<string>();
    benchReportMock.mockImplementation((name: string) => (name === "takeoff-bench-a" ? first.promise : second.promise));

    render(<LabStatsScreen />);
    const [openA, openB] = await screen.findAllByRole("button", { name: "Lire" });
    fireEvent.click(openA);
    await waitFor(() => expect(benchReportMock).toHaveBeenCalledWith("takeoff-bench-a"));
    fireEvent.click(openB);
    await waitFor(() => expect(benchReportMock).toHaveBeenCalledWith("takeoff-bench-b"));

    second.resolve("Rapport B");
    await screen.findByText("Rapport B");
    first.resolve("Rapport A");
    await first.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Rapport A")).toBeNull();
    expect(screen.getByText("Rapport B")).toBeTruthy();
  });
});

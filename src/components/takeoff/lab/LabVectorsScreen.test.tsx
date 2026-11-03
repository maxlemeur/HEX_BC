// Failure cases written before the fix (TI-662 review, P3):
// 1. « Afficher » in « Historique et comparaison » loads the run, then compares
//    its document with the one selected at the click. When the user picks
//    document B before the run answers, run A is applied to B: the page reads
//    B with run A (« Cet essai porte sur une autre page ou un autre document. »),
//    the layers stay empty and run A's Decisions panel shows over B.
// 2. The selection must stay on B and B must never be read with run A.
// 3. A click answered on an unchanged selection still shows the run: its page is
//    read with it and its row is the one highlighted.
// The army journey cannot hold the run's request while it changes the document,
// so this check holds it.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LabRun, LabRunSummary, LabState, LabVectorPage } from "@/lib/takeoff/lab/contracts";

const { vectorsMock, runsMock, runMock } = vi.hoisted(() => ({ vectorsMock: vi.fn(), runsMock: vi.fn(), runMock: vi.fn() }));

vi.mock("@/components/takeoff/lab/lab-api", async (importActual) => {
  const actual = await importActual<typeof import("@/components/takeoff/lab/lab-api")>();
  return { ...actual, labApi: { ...actual.labApi, vectors: vectorsMock, runs: runsMock, run: runMock } };
});
vi.mock("@/components/takeoff/lab/LabPdfCanvas", () => ({ LabPdfCanvas: () => null }));

const DOC_A = "fixture-plan-a";
const DOC_B = "fixture-plan-b";
const STATE = {
  configured: true,
  message: null,
  documents: [
    { id: DOC_A, source: "fixture", label: "Plan A", pages: 1, truth: null },
    { id: DOC_B, source: "fixture", label: "Plan B", pages: 1, truth: null },
  ],
  tasks: [],
  decisions: { available: false, message: "", model: "gpt-6-luna", budget: { cap: null, used: 0, remaining: null, calls_without_usage: 0 } },
  chatgpt: { connected: false, model: null, reasoning_effort: null, message: null },
  campaigns: [],
  latest_campaign: null,
} as unknown as LabState;

vi.mock("@/components/takeoff/lab/TakeoffLabShell", () => ({
  useTakeoffLab: () => ({ state: STATE, refresh: vi.fn().mockResolvedValue(STATE), refreshError: null }),
}));

import { LabApiError } from "@/components/takeoff/lab/lab-api";
import { LabVectorsScreen } from "@/components/takeoff/lab/LabVectorsScreen";

const RUN_A = {
  schema_version: 1, id: "run-a", created_at: "2026-11-03T10:00:00.000Z", author: { user_id: "u", email: null }, campaign: "campagne-a",
  task: { id: "classe-de-calque", kind: "choice", label: "Classe de calque" },
  document: { id: DOC_A, source: "fixture", sha256: "a".repeat(64), pages: 1 }, crop: null,
  prompt: { text: "", base: "takeoff-vector-groups-v1", sha256: "b".repeat(64), version: `takeoff-vector-groups-v1+${"c".repeat(64)}` },
  status: "complete", stop: null, configs: [],
} as unknown as LabRun;
const SUMMARY_A = {
  id: RUN_A.id, created_at: RUN_A.created_at, campaign: RUN_A.campaign, task: RUN_A.task, document: RUN_A.document, crop: null,
  prompt_version: RUN_A.prompt.version, status: "complete", configs: [],
} as unknown as LabRunSummary;

function reading(documentId: string, page: number, runId: string | null): LabVectorPage {
  return {
    document: { id: documentId, sha256: "a".repeat(64), pages: 1 }, page, mode: "layers", size_pt: [100, 100],
    scale: { status: "format", reason: null, denominator: 50, cartouche: null, cotes: 0, consistent_cotes: 0 }, detection: null, groups: [],
    segments: { total: 0, shown: 0, cap: 20_000, capped: false }, networks: [], surfaces: [],
    run: runId ? { id: runId, campaign: RUN_A.campaign, created_at: RUN_A.created_at, answers: 0, applied: 0 } : null,
    timings: { extraction_ms: 0, reading_ms: 0 },
  } as LabVectorPage;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  // As the server does: an essai is read only with its own document and page.
  vectorsMock.mockReset().mockImplementation((documentId: string, page: number, runId?: string | null) => (
    runId && (runId !== RUN_A.id || documentId !== RUN_A.document.id || page !== 1)
      ? Promise.reject(new LabApiError("Cet essai porte sur une autre page ou un autre document.", 400))
      : Promise.resolve(reading(documentId, page, runId ?? null))));
  runsMock.mockReset().mockResolvedValue([SUMMARY_A]);
  runMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LabVectorsScreen", () => {
  it("shows a run from the history only on the selection it was clicked on", async () => {
    const answer = deferred<LabRun>();
    runMock.mockReturnValueOnce(answer.promise).mockResolvedValueOnce(RUN_A);

    render(<LabVectorsScreen />);
    await waitFor(() => expect(vectorsMock).toHaveBeenCalledWith(DOC_A, 1, null));
    fireEvent.click(await screen.findByRole("button", { name: /^Historique et comparaison · 1 rapport$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Afficher" }));
    expect(runMock).toHaveBeenLastCalledWith(RUN_A.id);

    // Document B is picked before run A answers.
    fireEvent.change(screen.getByLabelText("Document"), { target: { value: DOC_B } });
    await waitFor(() => expect(vectorsMock).toHaveBeenLastCalledWith(DOC_B, 1, null));
    await screen.findByText("Aucun classement de ce document.");
    await act(async () => {
      answer.resolve(RUN_A);
      await answer.promise;
    });
    await act(async () => {});

    expect(vectorsMock.mock.calls.filter(([, , runId]) => runId === RUN_A.id)).toEqual([]);
    expect((screen.getByLabelText("Document") as HTMLSelectElement).value).toBe(DOC_B);
    expect(screen.queryByText("Cet essai porte sur une autre page ou un autre document.")).toBeNull();
    expect(screen.getByRole("region", { name: "Classement Decisions" }).textContent).not.toContain("takeoff-vector-groups-v1");

    // Back on A, a click answered on an unchanged selection shows the run.
    fireEvent.change(screen.getByLabelText("Document"), { target: { value: DOC_A } });
    fireEvent.click(await screen.findByRole("button", { name: "Afficher" }));
    await waitFor(() => expect(vectorsMock).toHaveBeenLastCalledWith(DOC_A, 1, RUN_A.id));
    await waitFor(() => expect(screen.getByRole("region", { name: "Classement Decisions" }).textContent).toContain("takeoff-vector-groups-v1"));
    expect(screen.getByRole("button", { name: "Afficher" }).closest("tr")?.className).toContain("bg-primary/5");
    expect(screen.queryByText("Cet essai porte sur une autre page ou un autre document.")).toBeNull();
  });
});

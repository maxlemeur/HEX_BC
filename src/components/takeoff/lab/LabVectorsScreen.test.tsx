// Failure cases written before the fix (TI-662 review, P3):
// 1. « Afficher » in « Historique et comparaison » loads the run, then compares
//    its document with the one selected at the click. When the user picks
//    document B before the run answers, run A is applied to B: the page reads
//    B with run A (« Cet essai porte sur une autre page ou un autre document. »),
//    the layers stay empty and run A's Decisions panel shows over B.
// 2. The selection must stay on B and B must never be read with run A.
// 3. A click answered on an unchanged selection still shows the run: its page is
//    read with it and its row is the one highlighted.
// Failure cases written before the fix (TI-662 Codex review on PR #156, P2):
// 4. On page 1 with its reading shown, « Afficher » on a history run of page 2
//    switches the page and the Decisions panel but keeps page 1's reading: its
//    groups, lengths, scale and detection badges stay over page 2 while page 2 is
//    read, and for good when that reading fails.
// 5. Meanwhile « Copier la sélection » stays enabled and exports page 1's groups
//    under the run of page 2, page 1's copy notice stays, and once page 2's
//    reading failed « Classer avec Decisions » is enabled again on page 1's count.
// 6. Expected: as soon as the asked (document, page, run) changes, nothing of the
//    previous reading is shown (« Lecture vectorielle » instead) and the actions
//    on the reading are unavailable; a failed reading shows its error and nothing
//    else; only the matching answer shows page 2's reading and enables them again.
// The army journey cannot hold the run's or the reading's request while it changes
// the selection, so this check holds them.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    { id: DOC_A, source: "fixture", label: "Plan A", pages: 2, truth: null },
    { id: DOC_B, source: "fixture", label: "Plan B", pages: 1, truth: null },
  ],
  tasks: [{ id: "classe-de-calque", kind: "choice", screen: "vectors", label: "Classe de calque", description: "", providers: ["decisions"],
    defaultPrompt: "", promptBase: "takeoff-vector-groups-v1", promptMax: 4000, question: null }],
  decisions: { available: true, message: "", model: "gpt-6-luna", budget: { cap: null, used: 0, remaining: null, calls_without_usage: 0 } },
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Page 1 read by keywords, page 2 read with its Decisions run: their groups, lengths and badges differ.
const RUN_P2 = { ...RUN_A, id: "run-p2", campaign: "campagne-p2", crop: { page: 2, box: null } } as unknown as LabRun;
const SUMMARY_P2 = { ...SUMMARY_A, id: RUN_P2.id, campaign: RUN_P2.campaign, crop: RUN_P2.crop } as unknown as LabRunSummary;

function group(id: string, name: string, cls: string, source: "keyword" | "decisions", metres: number) {
  return { id, name, layer: name, colors: ["#0000ff"], width: 0.5, dash: null, visible: true, near_white: false, grey: false,
    class: cls, source, confidence: source === "decisions" ? 0.8 : null, candidates: [], keyword: { class: source === "keyword" ? cls : null, source: null },
    length_pt: metres * 100, length_m: metres, segments: 1, geometry: [0, 0, 10, 0], geometry_capped: false };
}

const PAGE_1 = {
  ...reading(DOC_A, 1, null), detection: 0.78, groups: [group("g-ef", "FICTIF_EF_PAGE_1", "EF", "keyword", 5)],
  scale: { status: "verified", reason: null, denominator: 50, cartouche: null, cotes: 1, consistent_cotes: 1 },
  networks: [{ network: "EF", material: null, dn: null, runs: 1, length_pt: 500, length_m: 5 }],
} as LabVectorPage;
const PAGE_2 = {
  ...reading(DOC_A, 2, RUN_P2.id), detection: 1,
  groups: [group("g-eu", "FICTIF_EU_PAGE_2", "EU", "decisions", 3), group("g-cote", "FICTIF_COTE_PAGE_2", "cotation", "keyword", 1)],
  scale: { status: "format", reason: null, denominator: 100, cartouche: null, cotes: 0, consistent_cotes: 0 },
  networks: [{ network: "EU", material: null, dn: null, runs: 1, length_pt: 300, length_m: 3 }],
} as LabVectorPage;

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
  Reflect.deleteProperty(navigator, "clipboard");
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

  it("shows and acts on a page's reading only once the asked document, page and run answered", async () => {
    const held = deferred<LabVectorPage>();
    let pageTwoAsks = 0;
    vectorsMock.mockReset().mockImplementation((documentId: string, page: number, runId?: string | null) => {
      if (documentId === DOC_A && page === 1 && !runId) return Promise.resolve(PAGE_1);
      if (documentId === DOC_A && page === 2 && runId === RUN_P2.id) return pageTwoAsks++ === 0 ? held.promise : Promise.resolve(PAGE_2);
      return Promise.reject(new LabApiError("Cet essai porte sur une autre page ou un autre document.", 400));
    });
    runsMock.mockReset().mockResolvedValue([SUMMARY_A, SUMMARY_P2]);
    runMock.mockImplementation((id: string) => Promise.resolve(id === RUN_P2.id ? RUN_P2 : RUN_A));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<LabVectorsScreen />);
    const copy = () => screen.getByRole("button", { name: "Copier la sélection" });
    const classify = () => screen.getByRole("button", { name: "Classer avec Decisions" });
    const lengths = () => screen.getByRole("list", { name: "Longueurs mesurées" });
    // What of page 1's reading is on screen.
    const pageOneShown = () => Object.entries({
      group: screen.queryByRole("checkbox", { name: "Afficher FICTIF_EF_PAGE_1" }), scale: screen.queryByText("Échelle 1/50 vérifiée par une cote"),
      detection: screen.queryByText("Détection 78 %"), count: screen.queryByText("1 / 1 éléments affichés"),
      length: lengths().textContent?.includes("EF") ? lengths() : null, copied: screen.queryByText(/^Sélection copiée/),
    }).filter(([, node]) => node !== null).map(([name]) => name);
    const historyRow = (campaign: string) => within(screen.getByText(campaign).closest("tr")!).getByRole("button", { name: "Afficher" });

    // Page 1 read, its selection copied: everything acts on page 1.
    await screen.findByRole("checkbox", { name: "Afficher FICTIF_EF_PAGE_1" });
    expect(lengths().textContent).toBe("EF 5,00 m");
    expect(pageOneShown()).toEqual(["group", "scale", "detection", "count", "length"]);
    await waitFor(() => expect(classify()).toBeEnabled());
    fireEvent.click(copy());
    await screen.findByText("Sélection copiée : 1 groupe (truth/groups).");
    expect(pageOneShown()).toEqual(["group", "scale", "detection", "count", "length", "copied"]);

    // « Afficher » on the run of page 2 while page 2's reading is held: nothing of page 1 is left, nothing acts.
    fireEvent.click(await screen.findByRole("button", { name: /^Historique et comparaison · 2 rapports$/ }));
    fireEvent.click(historyRow(RUN_P2.campaign));
    await waitFor(() => expect(vectorsMock).toHaveBeenLastCalledWith(DOC_A, 2, RUN_P2.id));
    expect((screen.getByLabelText("Page") as HTMLSelectElement).value).toBe("2");
    expect(pageOneShown()).toEqual([]);
    expect(screen.getByRole("status", { name: "Lecture vectorielle" })).toBeTruthy();
    expect(copy()).toBeDisabled();
    expect(classify()).toBeDisabled();

    // The held reading fails: its error alone, the actions stay unavailable.
    await act(async () => {
      held.reject(new LabApiError("Lecture vectorielle impossible.", 500));
      await held.promise.catch(() => undefined);
    });
    expect(screen.getByRole("alert").textContent).toBe("Lecture vectorielle impossible.");
    expect(screen.queryByRole("status", { name: "Lecture vectorielle" })).toBeNull();
    expect(pageOneShown()).toEqual([]);
    expect(copy()).toBeDisabled();
    expect(classify()).toBeDisabled();

    // Back on page 1, then « Afficher » again: page 2's reading answers, shows and is what the actions use.
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "1" } });
    await screen.findByRole("checkbox", { name: "Afficher FICTIF_EF_PAGE_1" });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(historyRow(RUN_P2.campaign));
    await screen.findByRole("checkbox", { name: "Afficher FICTIF_EU_PAGE_2" });
    expect(pageOneShown()).toEqual([]);
    expect(lengths().textContent).toBe("EU 3,00 m");
    expect(screen.getByText("Échelle 1/100 format conforme")).toBeTruthy();
    expect(screen.getByText("2 / 2 éléments affichés")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(classify()).toBeEnabled());
    fireEvent.click(copy());
    await screen.findByText("Sélection copiée : 2 groupes (truth/groups).");
    expect(JSON.parse(writeText.mock.lastCall![0] as string)).toEqual({
      schema_version: 1, document: DOC_A, groups: [{ page: 2, group: "g-eu", class: "EU" }, { page: 2, group: "g-cote", class: "cotation" }],
    });
  });
});

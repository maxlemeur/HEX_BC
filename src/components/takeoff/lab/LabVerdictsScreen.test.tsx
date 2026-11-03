// Failure cases written before the fix (Codex review of PR #143, P2):
// 1. While the newly selected campaign loads, the previous campaign's element
//    stays on screen: a keyboard verdict (G/B) would send the new campaign's
//    name with the old element's id.
// 2. During that load, Échap / « Annuler » would delete the new campaign's
//    latest verdict while the old campaign is still displayed.
// 3. The verdict buttons must stay disabled until the selected campaign's
//    elements are displayed, then work on them.
// The army journey cannot hold a campaign request open, so this check does.
//
// Failure cases written before the TI-674 fix (CI once dropped the G pressed on B):
// 4. The document keydown listener is registered by a passive effect, so after a
//    render it keeps the previous render's handlers until that effect runs. A key
//    pressed right after campaign B appears still sees « loading » and the
//    verdict is dropped without a message.
// 5. A key pressed right after a verdict moved the screen to the next element is
//    handled with the element just judged: the second verdict overwrites the
//    first one and the element on screen stays unjudged.
// The army journey cannot press a key between a commit and its effects either;
// beforePassiveEffectsOf replays that ordering on every run.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LabCampaign, LabCampaignElement, LabState } from "@/lib/takeoff/lab/contracts";
import { beforePassiveEffectsOf } from "@/test/before-passive-effects";

const { campaignMock, judgeMock, undoMock } = vi.hoisted(() => ({ campaignMock: vi.fn(), judgeMock: vi.fn(), undoMock: vi.fn() }));

vi.mock("@/components/takeoff/lab/lab-api", async (importActual) => {
  const actual = await importActual<typeof import("@/components/takeoff/lab/lab-api")>();
  return { ...actual, labApi: { ...actual.labApi, campaign: campaignMock, judge: judgeMock, undo: undoMock } };
});
vi.mock("@/components/takeoff/lab/LabPdfCanvas", () => ({ LabPdfCanvas: () => null }));

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

import { LabVerdictsScreen } from "@/components/takeoff/lab/LabVerdictsScreen";

function element(id: string, label: string): LabCampaignElement {
  return {
    id, kind: "item", key: 0, label, detail: null, source_page: 1, evidence: null, schema_error: false, answer: null, json: {},
    run_id: "run-1", run_created_at: "2026-11-03T10:00:00.000Z", config_id: "A", provider: "chatgpt", model: "army-plan-model",
    reasoning_effort: "low", config_status: "ok", config_message: null, task: { id: "extraction", kind: "extraction", label: "Extraction" },
    document: { id: "fixture-plan", sha256: "0".repeat(64), pages: 1 }, crop: null, prompt_version: "takeoff-c-v1+12345678",
    verdict: null, verdict_at: null, verdict_author: null,
  } as unknown as LabCampaignElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const ID_A = "a".repeat(64);
const ID_A2 = "c".repeat(64);
const ID_B = "b".repeat(64);

beforeEach(() => {
  campaignMock.mockReset();
  judgeMock.mockReset().mockResolvedValue({});
  undoMock.mockReset().mockResolvedValue({ element_id: ID_B, verdict: "good" });
});

afterEach(() => {
  cleanup();
});

describe("LabVerdictsScreen", () => {
  it("does not judge or undo while the selected campaign is still loading", async () => {
    const campaignB = deferred<LabCampaign>();
    campaignMock.mockImplementation((name: string) => name === "campagne-a"
      ? Promise.resolve({ campaign: "campagne-a", elements: [element(ID_A, "Élément de A")] })
      : campaignB.promise);

    render(<LabVerdictsScreen />);
    await screen.findAllByText(/Élément de A/);
    fireEvent.change(screen.getByLabelText("Campagne"), { target: { value: "campagne-b" } });
    await waitFor(() => expect(campaignMock).toHaveBeenLastCalledWith("campagne-b"));

    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(judgeMock).not.toHaveBeenCalled();
    expect(undoMock).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/Élément de A/)).toHaveLength(0);
    expect((screen.getByRole("button", { name: /^Bon/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^Annuler/ }) as HTMLButtonElement).disabled).toBe(true);

    const pressed = beforePassiveEffectsOf(() => screen.queryAllByText(/Élément de B/).length > 0, () => fireEvent.keyDown(document.body, { key: "g" }));
    campaignB.resolve({ campaign: "campagne-b", elements: [element(ID_B, "Élément de B")] });
    await pressed.done();
    expect(judgeMock).toHaveBeenCalledTimes(1);
    expect(judgeMock).toHaveBeenCalledWith("campagne-b", ID_B, "good");
  });

  it("applies a key pressed right after a verdict to the element now shown", async () => {
    campaignMock.mockResolvedValue({ campaign: "campagne-a", elements: [element(ID_A, "Premier élément"), element(ID_A2, "Second élément")] });
    const firstVerdict = deferred<unknown>();
    judgeMock.mockReturnValueOnce(firstVerdict.promise);

    render(<LabVerdictsScreen />);
    await screen.findAllByText(/Premier élément/);
    fireEvent.click(screen.getByRole("button", { name: /^Bon/ }));
    expect(judgeMock).toHaveBeenLastCalledWith("campagne-a", ID_A, "good");

    const pressed = beforePassiveEffectsOf(() => screen.queryAllByText(/Second élément/).length > 0, () => fireEvent.keyDown(document.body, { key: "b" }));
    firstVerdict.resolve({});
    await pressed.done();
    expect(judgeMock).toHaveBeenCalledTimes(2);
    expect(judgeMock).toHaveBeenLastCalledWith("campagne-a", ID_A2, "bad");
  });
});

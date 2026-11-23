// Failure case written before the fix (TI-673, LAB02 seen failing on PR #145): with a Decisions
// configuration, `launch` refuses to start until the canvas has loaded the PDF (Decisions reads a
// rendered page), yet « Lancer » stayed enabled meanwhile. A click during the load sent nothing and
// only showed « Le plan n'est pas encore chargé ». The button must stay disabled, with its reason,
// until the plan is loaded, then enable. The army journey only hits this when the PDF loads slowly.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LabState } from "@/lib/takeoff/lab/contracts";

const canvas = vi.hoisted(() => ({ onDocument: undefined as ((pdf: PDFDocumentProxy | null) => void) | undefined }));

vi.mock("@/components/takeoff/lab/LabPdfCanvas", () => ({
  LabPdfCanvas: (props: { onDocument?: (pdf: PDFDocumentProxy | null) => void }) => {
    canvas.onDocument = props.onDocument;
    return null;
  },
}));
vi.mock("@/components/takeoff/lab/lab-pdf", () => ({ renderDecisionsImage: vi.fn() }));
vi.mock("@/components/takeoff/lab/lab-api", async (importActual) => {
  const actual = await importActual<typeof import("@/components/takeoff/lab/lab-api")>();
  return { ...actual, labApi: { ...actual.labApi, models: vi.fn().mockResolvedValue({ models: [] }), runs: vi.fn().mockResolvedValue([]), launch: vi.fn() } };
});

const shell = vi.hoisted(() => ({ state: null as unknown }));
const STATE = {
  configured: true,
  message: null,
  documents: [{ id: "fixture-army-chatgpt-plan", source: "fixture", label: "Plan fictif", pages: 1, truth: null }],
  tasks: [{ id: "tri-de-page", kind: "choice", label: "Tri de page", description: "", providers: ["decisions"], defaultPrompt: "Quel type de page ?", promptMax: 8000 }],
  decisions: { available: true, message: "", model: "gpt-6-luna", budget: { limit: 100000, used: 0, remaining: 100000, calls_without_usage: 0 } },
  chatgpt: { connected: false, model: null, reasoning_effort: null, message: "Connectez ChatGPT." },
  api_key: { status: "empty", provider: "openai", suffix: null, place_label: "Sur ce Mac", message: "Ajoutez votre clé API OpenAI dans Mon profil.",
    ceiling_nano_usd: 1_000_000_000 },
  campaigns: [],
  latest_campaign: null,
} as unknown as LabState;

vi.mock("@/components/takeoff/lab/TakeoffLabShell", () => ({
  useTakeoffLab: () => ({ state: shell.state ?? STATE, refresh: vi.fn().mockResolvedValue(shell.state ?? STATE), refreshError: null }),
}));

const TERRA = { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium", verified: true };
const WITH_KEY = {
  ...STATE,
  tasks: [{ id: "extraction-niveau-c", kind: "extraction", screen: "essai", label: "Extraction des quantités (niveau C)", description: "",
    providers: ["chatgpt", "api_key"], defaultPrompt: "Extrais les quantités.", promptMax: 50_000 }],
  chatgpt: { connected: true, model: "army-plan-model", reasoning_effort: null, message: null },
  api_key: { status: "saved", provider: "openai", suffix: "7K2F", place_label: "Sur ce Mac", message: null, ceiling_nano_usd: 1_000_000_000,
    connection_id: "8c3e2b1a-4d5f-4a6b-9c7d-0e1f2a3b4c5d", models: [TERRA] },
} as unknown as LabState;

import { LabEssaiScreen } from "@/components/takeoff/lab/LabEssaiScreen";
import { labApi } from "@/components/takeoff/lab/lab-api";

beforeEach(() => {
  shell.state = null;
  canvas.onDocument = undefined;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LabEssaiScreen", () => {
  it("keeps « Lancer » disabled for a Decisions configuration until the plan is loaded", async () => {
    render(<LabEssaiScreen />);
    const launch = await screen.findByRole("button", { name: /^Lancer/ });
    await waitFor(() => expect(canvas.onDocument).toBeTypeOf("function"));

    expect((launch as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Le plan se charge…")).toBeTruthy();

    act(() => canvas.onDocument?.({ numPages: 1 } as unknown as PDFDocumentProxy));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Lancer/ }) as HTMLButtonElement).disabled).toBe(false));

    act(() => canvas.onDocument?.(null));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Lancer/ }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("shows an unavailable ChatGPT model and requires a new choice to launch", async () => {
    shell.state = { ...WITH_KEY, analysis_defaults: {
      source: "chatgpt_plan", chatgpt: { model: "previous-account-model", reasoningEffort: "high" }, apiKey: null,
    } };
    vi.mocked(labApi.models).mockResolvedValueOnce({
      models: [{ id: "army-plan-model", name: "Army plan model", reasoningEfforts: ["medium"], defaultReasoningEffort: "medium" }],
      profile: { model: "army-plan-model", reasoning_effort: "medium" },
    });
    render(<LabEssaiScreen />);
    const launch = await screen.findByRole<HTMLButtonElement>("button", { name: /^Lancer/ });
    const unavailable = await screen.findByRole<HTMLOptionElement>("option", { name: "previous-account-model · indisponible" });
    expect(unavailable.disabled).toBe(true);
    expect(launch.disabled).toBe(true);
    expect(screen.getByText("Le modèle ChatGPT choisi est indisponible. Choisissez un autre modèle.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Modèle"), { target: { value: "army-plan-model" } });
    await waitFor(() => expect(launch.disabled).toBe(false));
  });

  it("requires a new effort choice when the current ChatGPT model no longer supports the previous effort", async () => {
    shell.state = { ...WITH_KEY, analysis_defaults: {
      source: "chatgpt_plan", chatgpt: { model: "army-plan-model", reasoningEffort: "high" }, apiKey: null,
    } };
    vi.mocked(labApi.models).mockResolvedValueOnce({
      models: [{ id: "army-plan-model", name: "Army plan model", reasoningEfforts: ["medium"], defaultReasoningEffort: "medium" }],
      profile: { model: "army-plan-model", reasoning_effort: "medium" },
    });
    render(<LabEssaiScreen />);
    const launch = await screen.findByRole<HTMLButtonElement>("button", { name: /^Lancer/ });
    const unavailable = await screen.findByRole<HTMLOptionElement>("option", { name: "Élevé · indisponible" });
    expect(unavailable.disabled).toBe(true);
    expect(launch.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "auto" } });
    await waitFor(() => expect(launch.disabled).toBe(false));
  });

  // Review item 8: a saved key changes nothing while ChatGPT is the selected source.
  it("draws the lab with a saved key without any request for it, and launches the key configuration with the version it showed", async () => {
    shell.state = WITH_KEY;
    const fetchSpy = vi.fn(() => { throw new Error("No request may leave the lab page here."); });
    vi.stubGlobal("fetch", fetchSpy);
    vi.mocked(labApi.launch).mockResolvedValue(null as never);
    render(<LabEssaiScreen />);
    const provider = await screen.findByLabelText("Fournisseur");
    expect((provider as HTMLSelectElement).value).toBe("chatgpt");
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(provider, { target: { value: "api_key" } });
    await waitFor(() => expect((screen.getByLabelText("Modèle") as HTMLSelectElement).value).toBe("gpt-6.1-terra"));
    expect([...(screen.getByLabelText("Effort") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      "Automatique", "Sans raisonnement", "Faible", "Moyen", "Élevé", "Très élevé", "Maximum"]);
    expect(screen.getByRole("status", { name: "Plafond de la clé API" }).textContent).toBe(
      "Clé API OpenAI · facturé sur votre compte · plafond 1,00 $ US. OpenAI compte l’entrée avant l’analyse ; la sortie est limitée à ce qui reste sous le plafond.");
    fireEvent.click(screen.getByRole("button", { name: /^Lancer/ }));
    await waitFor(() => expect(labApi.launch).toHaveBeenCalled());
    expect(vi.mocked(labApi.launch).mock.calls[0][0].configs).toEqual([
      { provider: "api_key", apiProvider: "openai", model: "gpt-6.1-terra", reasoningEffort: null, connectionId: "8c3e2b1a-4d5f-4a6b-9c7d-0e1f2a3b4c5d" }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

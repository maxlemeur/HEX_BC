// Failure case written before the fix (TI-673, LAB02 seen failing on PR #145): with a Decisions
// configuration, `launch` refuses to start until the canvas has loaded the PDF (Decisions reads a
// rendered page), yet « Lancer » stayed enabled meanwhile. A click during the load sent nothing and
// only showed « Le plan n'est pas encore chargé ». The button must stay disabled, with its reason,
// until the plan is loaded, then enable. The army journey only hits this when the PDF loads slowly.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

const STATE = {
  configured: true,
  message: null,
  documents: [{ id: "fixture-army-chatgpt-plan", source: "fixture", label: "Plan fictif", pages: 1, truth: null }],
  tasks: [{ id: "tri-de-page", kind: "choice", label: "Tri de page", description: "", providers: ["decisions"], defaultPrompt: "Quel type de page ?", promptMax: 8000 }],
  decisions: { available: true, message: "", model: "gpt-6-luna", budget: { limit: 100000, used: 0, remaining: 100000, calls_without_usage: 0 } },
  chatgpt: { connected: false, model: null, reasoning_effort: null, message: "Connectez ChatGPT." },
  campaigns: [],
  latest_campaign: null,
} as unknown as LabState;

vi.mock("@/components/takeoff/lab/TakeoffLabShell", () => ({
  useTakeoffLab: () => ({ state: STATE, refresh: vi.fn().mockResolvedValue(STATE), refreshError: null }),
}));

import { LabEssaiScreen } from "@/components/takeoff/lab/LabEssaiScreen";

beforeEach(() => {
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
});

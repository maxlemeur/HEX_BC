import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { loadPhotoAnalysisModelOptions } from "@/app/dashboard/_actions/chatgpt";
import type { MaterialRequestFile } from "@/lib/material-requests/contracts";
import { compareMaterialRequestQuoteFile } from "@/lib/material-requests/client";

import { MaterialRequestQuoteComparison } from "./MaterialRequestQuoteComparison";

vi.mock("@/app/dashboard/_actions/chatgpt", () => ({ loadPhotoAnalysisModelOptions: vi.fn() }));

vi.mock("@/lib/material-requests/client", () => ({ compareMaterialRequestQuoteFile: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

function file(id: string, name: string): MaterialRequestFile {
  return {
    id, request_id: "request", file_name: name, quote_id: "quote",
    mime_type: "application/pdf", byte_size: 500, rotation: 0, created_at: "2026-01-01T00:00:00Z",
  };
}

it("prefills the API key's photo preferences, compares the selected revision and keeps the result when switching", async () => {
  const user = userEvent.setup();
  const preferences = { model: "demo", reasoningEffort: "medium" } as const;
  vi.mocked(loadPhotoAnalysisModelOptions).mockResolvedValue({
    billingSource: "personal_api_key", connectionId: "fixture-connection", preferences,
    models: [{ id: "demo", name: "Démo API", reasoningEfforts: ["medium"], defaultReasoningEffort: "medium", verified: true }],
  });
  const compared = {
    complete: true,
    model: "demo",
    reference: "DEMO-R2",
    revision: null,
    date: null,
    total_ht: null,
    commercial_notes: null,
    unmatched_request: [],
    unmatched_offers: [],
    lines: [{
      requested: [{ text: "100 u Rondelle M8", quantity: 100, unit: "u" }],
      offered: [{
        text: "BTE 50 RONDELLES M8 · 1 UN", page: 2, row: 1, quantity: 1, unit: "UN",
        pack_quantity: 50, pack_unit: "u", requested_group: 1, technical: "compatible" as const,
        observation: null, price: "4,20 € HT / boîte", delay: null,
      }],
      status: "short" as const, requested_quantity: 100, offered_quantity: 50, difference: -50, unit: "u",
    }],
  };
  vi.mocked(compareMaterialRequestQuoteFile).mockResolvedValue({ ...compared, file_id: "revision" });

  render(<MaterialRequestQuoteComparison projectId="project" requestId="request" quoteId="quote"
    files={[file("initial", "Devis.pdf"), file("revision", "Devis révisé.pdf")]}
    availability={{ status: "available", message: "" }} visible />);

  await screen.findByText(/Clé API OpenAI/);
  expect(screen.getByRole("combobox", { name: "Modèle d’analyse" })).toHaveValue("demo");
  expect(screen.getByRole("combobox", { name: "Effort de raisonnement" })).toHaveValue("medium");
  const select = screen.getByRole("combobox", { name: "Pièce à comparer" });
  await user.selectOptions(select, "revision");
  await user.click(screen.getByRole("button", { name: "Comparer le devis à la demande" }));
  expect(compareMaterialRequestQuoteFile).toHaveBeenCalledWith(
    "project", "request", "quote", "revision", {
      billingSource: "personal_api_key", connectionId: "fixture-connection", preferences,
    }, expect.any(AbortSignal),
  );
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Quantité insuffisante")).toBeInTheDocument();
  expect(within(table).getByText("· p. 2")).toBeInTheDocument();
  expect(within(table).getByText(/50 u \/ 100 u/)).toBeInTheDocument();
  await user.selectOptions(select, "initial");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await user.selectOptions(select, "revision");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(compareMaterialRequestQuoteFile).toHaveBeenCalledTimes(1);
});

it("prefills the plan's photo preferences and sends new choices when comparing and relaunching", async () => {
  const user = userEvent.setup();
  const preferences = { model: "demo-plan", reasoningEffort: "high" } as const;
  vi.mocked(loadPhotoAnalysisModelOptions).mockResolvedValue({
    billingSource: "chatgpt_plan", connectionId: null, preferences,
    models: [
      { id: "demo-plan", name: "Démo Forfait", reasoningEfforts: ["high"], defaultReasoningEffort: "high" },
      { id: "demo-compact", name: "Démo Compact", reasoningEfforts: ["low"], defaultReasoningEffort: "low" },
    ],
  });
  vi.mocked(compareMaterialRequestQuoteFile).mockResolvedValue({
    complete: true, file_id: "initial", model: "demo-compact", reference: null, revision: null, date: null,
    total_ht: null, commercial_notes: null, unmatched_request: [], unmatched_offers: [], lines: [],
  });
  render(<MaterialRequestQuoteComparison projectId="project" requestId="request" quoteId="quote"
    files={[file("initial", "Devis.pdf")]} availability={{ status: "available", message: "" }} visible />);

  await screen.findByText("Abonnement ChatGPT");
  const model = screen.getByRole("combobox", { name: "Modèle d’analyse" });
  const effort = screen.getByRole("combobox", { name: "Effort de raisonnement" });
  expect(model).toHaveValue("demo-plan");
  expect(effort).toHaveValue("high");

  await user.selectOptions(model, "demo-compact");
  expect(effort).toHaveValue("auto");
  expect(within(effort).queryByRole("option", { name: "Élevé" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Comparer le devis à la demande" }));
  expect(compareMaterialRequestQuoteFile).toHaveBeenNthCalledWith(1, "project", "request", "quote", "initial", {
    billingSource: "chatgpt_plan", connectionId: undefined, preferences: { model: "demo-compact", reasoningEffort: null },
  }, expect.any(AbortSignal));

  const relaunch = await screen.findByRole("button", { name: "Relancer la comparaison" });
  await user.selectOptions(effort, "low");
  await user.click(relaunch);
  expect(compareMaterialRequestQuoteFile).toHaveBeenNthCalledWith(2, "project", "request", "quote", "initial", {
    billingSource: "chatgpt_plan", connectionId: undefined, preferences: { model: "demo-compact", reasoningEffort: "low" },
  }, expect.any(AbortSignal));
  expect(preferences).toEqual({ model: "demo-plan", reasoningEffort: "high" });
});

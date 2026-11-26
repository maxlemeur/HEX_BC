import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { launchAffaireIntakeAnalysis, readAffaireIntakeAiOptions } from "@/app/dashboard/affaires/_actions/intake";
import type { IntakeAiOptions } from "@/lib/affaires/intake-ai-settings";
import { IntakeAnalysisRetryDialog } from "./IntakeAiControls";
import { IntakeAnalysisLaunch } from "./IntakeAnalysisLaunch";

vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  launchAffaireIntakeAnalysis: vi.fn(), readAffaireIntakeAiOptions: vi.fn(),
}));

const options: IntakeAiOptions = {
  defaultSource: "personal_api_key", planConnectionId: "a".repeat(64), keyConnectionId: "connexion-fictive", decisionsSelected: false,
  sources: {
    personal_api_key: {
      available: true, message: "Disponible",
      models: [{ id: "gpt-6.1-terra", name: "Terra", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }],
      preferences: { model: "gpt-6.1-terra", reasoningEffort: "low" },
    },
    chatgpt_plan: {
      available: true, message: "Disponible",
      models: [{ id: "gpt-6.2-sol", name: "Sol", reasoningEfforts: ["medium", "high"], defaultReasoningEffort: "medium" }],
      preferences: { model: "gpt-6.2-sol", reasoningEffort: "medium" },
    },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readAffaireIntakeAiOptions).mockResolvedValue(options);
  vi.mocked(launchAffaireIntakeAnalysis).mockResolvedValue({ message: "Analyse lancée." });
});

it("shows the default key, its batch ceiling and the adjustable effort before launching", async () => {
  const user = userEvent.setup();
  render(<IntakeAnalysisLaunch canManage onReload={vi.fn()} workspace={{
    projectId: "affaire-fictive", uploadId: "lot-fictif", documents: [], briefPreparationDue: true, missingPieces: [], briefDraft: null,
  }} />);
  const source = await screen.findByLabelText("Source de l’IA");
  expect(source).toHaveValue("personal_api_key");
  expect(source).toHaveAccessibleDescription(/2,00 \$ US pour tout le lot/);
  expect(screen.getByLabelText("Modèle")).toHaveValue("gpt-6.1-terra");
  expect(screen.getByLabelText("Effort de raisonnement")).toHaveValue("low");
  expect(screen.getByText(/GPT‑6.1 Terra avec un effort élevé/)).toBeVisible();
  expect(launchAffaireIntakeAnalysis).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("Effort de raisonnement"), "high");
  await user.click(screen.getByRole("button", { name: "Lancer l’analyse" }));
  expect(launchAffaireIntakeAnalysis).toHaveBeenCalledExactlyOnceWith("affaire-fictive", {
    source: "personal_api_key", model: "gpt-6.1-terra", effort: "high", expectedConnectionId: "connexion-fictive",
  });
});

it("shows one selection for the entire retry and explains the independent Decisions classification", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  vi.mocked(readAffaireIntakeAiOptions).mockResolvedValue({ ...options, defaultSource: "chatgpt_plan", decisionsSelected: true });
  render(<IntakeAnalysisRetryDialog projectId="affaire-fictive" count={3} onClose={vi.fn()} onSubmit={submit} />);
  const dialog = within(await screen.findByRole("dialog", { name: "Relancer l’analyse" }));
  expect(dialog.getByText(/3 pièces à réanalyser/)).toBeVisible();
  const source = await dialog.findByLabelText("Source de l’IA");
  expect(source).toHaveValue("chatgpt_plan");
  expect(dialog.getByText(/classement des pièces utilise l’API Decisions/)).toBeVisible();
  await user.selectOptions(source, "personal_api_key");
  expect(source).toHaveAccessibleDescription(/2,00 \$ US/);
  expect(submit).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "Démarrer la relance" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    source: "personal_api_key", model: "gpt-6.1-terra", effort: "low", expectedConnectionId: "connexion-fictive",
  });
});

it("submits the displayed plan grant with the confirmed retry settings", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  vi.mocked(readAffaireIntakeAiOptions).mockResolvedValue({ ...options, defaultSource: "chatgpt_plan" });
  render(<IntakeAnalysisRetryDialog projectId="affaire-fictive" count={1} onClose={vi.fn()} onSubmit={submit} />);
  const dialog = within(await screen.findByRole("dialog", { name: "Relancer l’analyse" }));
  await dialog.findByLabelText("Source de l’IA");
  await user.selectOptions(dialog.getByLabelText("Effort de raisonnement"), "high");
  await user.click(dialog.getByRole("button", { name: "Démarrer la relance" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    source: "chatgpt_plan", model: "gpt-6.2-sol", effort: "high", expectedConnectionId: options.planConnectionId,
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { readGeneratedOuvrageAiOptions } from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import { GeneratedOuvrageSourceForm } from "./GeneratedOuvrageSourceForm";

vi.mock("@/app/dashboard/affaires/_actions/generated-ouvrages", () => ({
  readGeneratedOuvrageAiOptions: vi.fn(),
}));

type Options = Extract<Awaited<ReturnType<typeof readGeneratedOuvrageAiOptions>>, { ok: true }>["data"];
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const OPTIONS: Options = {
  defaultSource: "personal_api_key",
  keyConnectionId: "connexion-de-test",
  sources: {
    chatgpt_plan: {
      available: true, message: "Forfait connecté.",
      models: [{ id: "plan", name: "GPT du forfait", reasoningEfforts: ["low"], defaultReasoningEffort: "low" }],
      preferences: { model: "plan", reasoningEffort: "low" },
    },
    personal_api_key: {
      available: true, message: "Clé enregistrée.",
      models: [
        { id: "key-default", name: "GPT du profil", reasoningEfforts: ["medium"], defaultReasoningEffort: "medium" },
        { id: "key-other", name: "Autre GPT", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" },
      ],
      preferences: { model: "key-default", reasoningEffort: "medium" },
    },
  },
};

describe("GeneratedOuvrageSourceForm", () => {
  it("shows the profile choice and ceiling before submitting, forwards edits and locks the controls during generation", async () => {
    vi.mocked(readGeneratedOuvrageAiOptions).mockResolvedValue({ ok: true, data: OPTIONS });
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const props = { versionId: VERSION_ID, existingSections: [], onGenerate, errorMessage: null };
    const { rerender } = render(<GeneratedOuvrageSourceForm {...props} isGenerating={false} />);

    const source = await screen.findByLabelText("Source d’IA");
    const model = screen.getByLabelText("Modèle");
    const effort = screen.getByLabelText("Effort de raisonnement");
    expect(readGeneratedOuvrageAiOptions).toHaveBeenCalledWith(VERSION_ID);
    expect(source).toHaveValue("personal_api_key");
    expect(source).toHaveAccessibleDescription(/1,00 \$ US au plus par demande/);
    expect(model).toHaveValue("key-default");
    expect(effort).toHaveValue("medium");
    expect(onGenerate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Texte source"), "Pose de 120 m² de dalles acoustiques.");
    await user.selectOptions(model, "key-other");
    await user.selectOptions(effort, "high");
    const submit = screen.getByRole("button", { name: "Générer des propositions" });
    await user.click(submit);
    expect(onGenerate).toHaveBeenLastCalledWith({
      ai: { source: "personal_api_key", model: "key-other", effort: "high", expectedConnectionId: "connexion-de-test" },
      sourceKind: "free_text", sourceText: "Pose de 120 m² de dalles acoustiques.", preferredLotId: null,
    });

    await user.selectOptions(source, "chatgpt_plan");
    expect(source).toHaveAccessibleDescription("Forfait connecté.");
    expect(model).toHaveValue("plan");
    expect(effort).toHaveValue("low");
    await user.click(submit);
    expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ ai: { source: "chatgpt_plan", model: "plan", effort: "low" } }));

    rerender(<GeneratedOuvrageSourceForm {...props} isGenerating />);
    expect(source).toBeDisabled();
    expect(model).toBeDisabled();
    expect(effort).toBeDisabled();
    expect(screen.getByRole("button", { name: "Génération…" })).toBeDisabled();
  });

  it("does not select the other payer when the saved payer is unavailable", async () => {
    vi.mocked(readGeneratedOuvrageAiOptions).mockResolvedValue({ ok: true, data: {
      ...OPTIONS,
      keyConnectionId: null,
      sources: { ...OPTIONS.sources, personal_api_key: { available: false, message: "Clé indisponible.", models: [], preferences: null } },
    } });
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GeneratedOuvrageSourceForm versionId={VERSION_ID} existingSections={[]} isGenerating={false}
      errorMessage="Ce modèle n’est pas proposé par la source d’IA choisie." onGenerate={onGenerate} />);

    const source = await screen.findByLabelText("Source d’IA");
    expect(source).toHaveValue("");
    expect(source).toHaveAccessibleDescription("Source par défaut indisponible : Clé indisponible.");
    expect(screen.getByText("Ce modèle n’est pas proposé par la source d’IA choisie.")).toBeVisible();
    await user.type(screen.getByLabelText("Texte source"), "Pose de 120 m² de dalles acoustiques.");
    expect(screen.getByRole("button", { name: "Générer des propositions" })).toBeDisabled();
    expect(onGenerate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Générer sans IA" }));
    expect(onGenerate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ai: { source: "fallback" } }));
  });
});

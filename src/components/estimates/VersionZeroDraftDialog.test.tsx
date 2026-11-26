import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { loadEstimateDraftAiOptions } from "@/app/dashboard/estimates/_actions/draft-ai-settings";
import { VersionZeroDraftDialog } from "@/components/estimates/VersionZeroDraftDialog";
import { generateVersionZeroDraft } from "@/lib/estimates/version-zero-drafts-client";

vi.mock("@/app/dashboard/estimates/_actions/draft-ai-settings", () => ({
  loadEstimateDraftAiOptions: vi.fn(),
}));
vi.mock("@/lib/estimates/version-zero-drafts-client", () => ({
  generateVersionZeroDraft: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("prefills the profile model, waits for a click, and submits the chosen effort and lots", async () => {
  const user = userEvent.setup();
  vi.mocked(loadEstimateDraftAiOptions).mockResolvedValue({
    defaultSource: "chatgpt_plan",
    keyConnectionId: null,
    sources: {
      chatgpt_plan: {
        available: true,
        message: "Forfait disponible",
        models: [{
          id: "plan-model",
          name: "Modèle de test",
          reasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "low",
        }],
        preferences: { model: "plan-model", reasoningEffort: "high" },
      },
      personal_api_key: { available: false, message: "Clé indisponible", models: [], preferences: null },
    },
  });
  vi.mocked(generateVersionZeroDraft).mockRejectedValue(new Error("Demande simulée."));
  render(
    <VersionZeroDraftDialog
      isOpen
      versionId="version-1"
      summary={{
        versionId: "version-1",
        projectId: "project-1",
        confirmedBriefId: "brief-1",
        hasConfirmedBrief: true,
        isVersionEmpty: true,
        canGenerate: true,
        availableLots: ["Peinture", "Menuiserie"],
        activeDraft: null,
      }}
      isMutationBlocked={false}
      mutationBlockedMessage=""
      ensureMutationCanProceed={vi.fn()}
      onClose={vi.fn()}
    />
  );

  expect(await screen.findByRole("combobox", { name: "Source d’IA" })).toHaveValue("chatgpt_plan");
  expect(screen.getByRole("combobox", { name: "Modèle" })).toHaveValue("plan-model");
  const effort = screen.getByRole("combobox", { name: "Effort de raisonnement" });
  expect(effort).toHaveValue("high");
  expect(generateVersionZeroDraft).not.toHaveBeenCalled();

  await user.selectOptions(effort, "low");
  await user.click(screen.getByRole("checkbox", { name: "Menuiserie" }));
  await user.click(screen.getByRole("button", { name: "Générer V0" }));
  await waitFor(() => expect(generateVersionZeroDraft).toHaveBeenCalledExactlyOnceWith("version-1", {
    briefId: "brief-1",
    selectedLots: ["Peinture"],
    ai: { source: "chatgpt_plan", model: "plan-model", effort: "low" },
  }));
  expect(await screen.findByText("Demande simulée.")).toBeVisible();
});

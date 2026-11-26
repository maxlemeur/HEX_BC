import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/app/dashboard/_actions/assistant", () => ({
  loadAssistantAiOptions: vi.fn(),
  loadAssistantThread: vi.fn(),
  loadAssistantThreads: vi.fn(async () => ({ ok: true, data: [] })),
  removeAssistantThread: vi.fn(),
  startAssistantThread: vi.fn(async () => ({ ok: true, data: { id: "fixture-thread" } })),
}));

import { loadAssistantAiOptions } from "@/app/dashboard/_actions/assistant";
import AssistantPanel from "@/components/assistant/AssistantPanel";

const connectionId = "11111111-1111-4111-8111-111111111111";
const key = {
  available: true, message: "Clé enregistrée.", preferences: { model: "fixture-key", reasoningEffort: "low" },
  models: [{ id: "fixture-key", name: "Modèle de test", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }],
} as const;
const options = { defaultSource: "personal_api_key" as const, keyConnectionId: connectionId,
  sources: { personal_api_key: { ...key, models: key.models.map((model) => ({ ...model, reasoningEfforts: [...model.reasoningEfforts] })) } } };

function panel() {
  render(<SWRConfig value={{ provider: () => new Map() }}>
    <AssistantPanel scope={{ projectId: "fixture-project", screen: { screen: "affaire" } }} activeThreadId={null}
      onActiveThreadChange={vi.fn()} onClose={vi.fn()} />
  </SWRConfig>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows the profile selection and ceiling before sending a starter with the edited settings", async () => {
  const user = userEvent.setup();
  vi.mocked(loadAssistantAiOptions).mockResolvedValue({ ok: true, data: options });
  // jsdom has no scroll implementation.
  Object.defineProperty(HTMLDivElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  const post = vi.fn<typeof fetch>(async () => Response.json(
    { error: { message: "Demande de test refusée." } }, { status: 409 },
  ));
  vi.stubGlobal("fetch", post);
  panel();

  const source = await screen.findByLabelText("Source IA");
  expect(source).toHaveValue("personal_api_key");
  expect(source).toHaveAccessibleDescription(/0,50 \$ US par message, lectures comprises/);
  expect(screen.getByLabelText("Modèle")).toHaveValue("fixture-key");
  await user.selectOptions(screen.getByLabelText("Effort de raisonnement"), "high");
  await user.click(screen.getByRole("button", { name: "Quels devis existent sur cette affaire ?" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(post.mock.calls[0]?.[1]?.body))).toMatchObject({
    aiSettings: { source: "personal_api_key", model: "fixture-key", effort: "high", connectionId },
  });
  expect(await screen.findByTestId("assistant-error")).toHaveTextContent("Demande de test refusée.");
});

it("disables the composer and its shortcuts when the preferred source is unavailable", async () => {
  vi.mocked(loadAssistantAiOptions).mockResolvedValue({ ok: true, data: { ...options, defaultSource: "chatgpt_plan",
    sources: { ...options.sources, chatgpt_plan: { available: false, message: "Reconnectez le forfait." } } } });
  panel();
  const source = await screen.findByLabelText("Source IA");
  expect(source).toHaveValue("");
  expect(source).toHaveAccessibleDescription(/Reconnectez le forfait/);
  expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Quels devis existent sur cette affaire ?" })).toBeDisabled();
});

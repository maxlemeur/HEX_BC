import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "127.0.0.1:3159" }) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  assertLocalChatGptHost: (host: string | null) => {
    if (host !== "127.0.0.1:3159") throw new Error("Non-local host");
  },
  isLocalChatGptEnabled: () => true,
  getLocalChatGptCredential: vi.fn(),
}));
vi.mock("@/lib/ai/access/openai-api", () => ({ openAiApiKeyAccess: () => ({
  state: vi.fn(async () => ({
    status: "saved", connection: { connectionId: "11111111-1111-4111-8111-111111111111", version: 3,
      offeredModels: [{ id: "gpt-6.2-sol", name: "Sol", reasoningEfforts: ["low"], defaultReasoningEffort: "low" }] },
    analysisPreferences: { billingSource: "personal_api_key", apiModel: "gpt-6.2-sol", apiReasoningEffort: "low" },
  })),
}) }));
vi.mock("@/lib/assistant/threads-server", () => ({ readAssistantThread: vi.fn(), appendAssistantMessage: vi.fn() }));
vi.mock("@/lib/assistant/tools", () => ({ buildAssistantTools: vi.fn() }));

import { appendAssistantMessage, readAssistantThread } from "@/lib/assistant/threads-server";
import { notFound } from "@/lib/http/api-response";
import { POST } from "./route";

const threadId = "22222222-2222-4222-8222-222222222222";
const model = { source: "personal_api_key", model: "gpt-6.2-sol", effort: "low" };
const connectionId = "11111111-1111-4111-8111-111111111111";
const provider = vi.fn(() => { throw new Error("Unexpected provider call"); });

function send(aiSettings?: unknown, host = "127.0.0.1:3159") {
  return POST(new Request(`http://${host}/api/assistant/threads/${threadId}/messages`, {
    method: "POST", headers: { host, "content-type": "application/json" },
    body: JSON.stringify({ content: "Quel est le total ?", aiSettings }),
  }), { params: Promise.resolve({ threadId }) });
}

describe("assistant message refusals before dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MERGEONE_ASSISTANT", "1");
    vi.stubGlobal("fetch", provider);
    vi.mocked(readAssistantThread).mockResolvedValue({
      context: { userId: "fixture-user", tenantId: "fixture-tenant" }, thread: { id: threadId }, messages: [],
    } as never);
  });
  afterEach(() => {
    expect(provider).not.toHaveBeenCalled();
    expect(appendAssistantMessage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects a non-local request before reading a conversation", async () => {
    expect((await send({ ...model, connectionId }, "example.test")).status).toBe(404);
    expect(readAssistantThread).not.toHaveBeenCalled();
  });

  it("rejects an unknown conversation before opening the selected source", async () => {
    vi.mocked(readAssistantThread).mockRejectedValueOnce(notFound("Conversation introuvable."));
    expect((await send({ ...model, connectionId })).status).toBe(404);
  });

  it.each([
    ["an implicit key", undefined, "CONNECTION_CHANGED"],
    ["a key without its connection", model, "CONNECTION_CHANGED"],
    ["a changed key", { ...model, connectionId: threadId }, "CONNECTION_CHANGED"],
    ["an unoffered model", { ...model, connectionId, model: "fixture-unknown" }, "MODEL_UNAVAILABLE"],
    ["an incompatible effort", { ...model, connectionId, effort: "high" }, "EFFORT_UNAVAILABLE"],
  ])("rejects %s without touching the provider or saving the question", async (_name, settings, code) => {
    const response = await send(settings);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: `ASSISTANT_AI_${code}` } });
  });
});
